'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const {constants, createReadStream} = require('node:fs');
const {createHash} = require('node:crypto');
const {gunzipSync} = require('node:zlib');
const {execFileSync} = require('node:child_process');
const {setTimeout:delay} = require('node:timers/promises');
const yaml = require('js-yaml');
const {build, Platform, Arch} = require('electron-builder');

async function digest(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

async function requireNewOutput(output) {
  try { await fs.lstat(output); }
  catch (error) { if(error.code==='ENOENT') return; throw error; }
  throw Error('Release output already exists: '+output);
}

async function finalizeDirectory(ready, output) {
  const deadline = Date.now()+20000;
  let pause = 200;
  for (;;) {
    await requireNewOutput(output);
    try { await fs.rename(ready,output); return; }
    catch(error) {
      if (!['EPERM','EACCES','EBUSY'].includes(error.code) || Date.now()>=deadline) throw error;
      await delay(pause);
      pause = Math.min(2000,pause*2);
    }
  }
}

async function verifyPackagedResources(resources) {
  const required = [
    'runtime-catalog.json',
    'voice-presets/yukino-default.json',
    'voice-presets/yukino-reference.wav',
    'aria2/aria2c.exe',
    'aria2/COPYING',
    'aria2/LICENSE.OpenSSL',
    'aria2/aria2-1.37.0.tar.xz',
    'inference/worker.py',
    'translation/worker.py',
    'local-chat/desktop_worker.py',
    'live2d/index.html',
  ];
  for (const file of required) {
    await fs.access(path.join(resources, file));
  }
  const catalog = JSON.parse(await fs.readFile(path.join(resources, 'runtime-catalog.json'), 'utf8'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.variants?.cpu?.parts) || !catalog.variants.cpu.parts.length) {
    throw Error('Packaged runtime-catalog.json is missing CPU runtime download entries');
  }
}

async function ensureAria2(root) {
  const target = path.join(root, 'build', 'aria2', 'aria2c.exe');
  try { await fs.access(target); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  execFileSync('python', [path.join(root, 'scripts', 'prepare-aria2.py')], {cwd: root, stdio: 'inherit'});
  await fs.access(target);
}

async function main() {
  const version = require('../package.json').version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Expected a stable version');
  const root = path.resolve(__dirname, '..');
  await ensureAria2(root);
  const parent = path.join(root,'release'), buildParent = path.join(root,'build'), output = path.join(parent,version);
  await Promise.all([fs.mkdir(parent,{recursive:true}), fs.mkdir(buildParent,{recursive:true})]);
  await requireNewOutput(output);
  // QA can open win-unpacked in place. Its handles never block publication.
  const stage = await fs.mkdtemp(path.join(buildParent,'windows-'+version+'-'));
  console.log('Windows build and QA files: '+stage);
  const config = {directories:{output:stage}};
  const cachedElectron = process.env.YUKINO_ELECTRON_ZIP;
  if (cachedElectron) {
    const zipName = 'electron-v'+require('electron/package.json').version+'-win32-x64.zip';
    const checksum = require('electron/checksums.json')[zipName];
    if (path.basename(cachedElectron)!==zipName || !checksum || await digest(cachedElectron,'sha256','hex')!==checksum) {
      throw Error('Cached Electron archive does not match the locked Windows x64 runtime');
    }
    config.electronDist = path.resolve(cachedElectron);
  }
  await build({projectDir:root, targets:Platform.WINDOWS.createTarget(['nsis','portable'], Arch.x64), publish:'never', config});
  await verifyPackagedResources(path.join(stage, 'win-unpacked', 'resources'));
  const prefix = 'Yukino-Companion-'+version, installer = prefix+'-Base-Setup.exe', portable = prefix+'-Portable.exe';
  const model = prefix+'-Live2D-Model.zip';
  execFileSync(require('7zip-bin').path7za,['a','-tzip',path.join(stage,model),'.'],{cwd:path.join(stage,'win-unpacked/resources/live2d'),stdio:'ignore'});
  const names = [installer,installer+'.blockmap',portable,'latest.yml',model];
  const ready = await fs.mkdtemp(path.join(parent,'.ready-'+version+'-'));
  for (const name of names) {
    await fs.copyFile(path.join(stage,name), path.join(ready,name), constants.COPYFILE_EXCL);
  }
  // Verify the actual distribution bytes, independent of future edits to QA files.
  const manifest = yaml.load(await fs.readFile(path.join(ready,'latest.yml'),'utf8'));
  const file = manifest.files?.find(item=>item.url===installer);
  const size = (await fs.stat(path.join(ready,installer))).size;
  if (manifest.version!==version || manifest.path!==installer || file?.size!==size || file.sha512!==manifest.sha512 ||
      file.sha512!==await digest(path.join(ready,installer),'sha512','base64')) throw Error('Installer does not match generated latest.yml');
  const map = JSON.parse(gunzipSync(await fs.readFile(path.join(ready,installer+'.blockmap'))));
  if (!map.files?.length || !map.files.every(f=>f.sizes.length===f.checksums.length) ||
      Math.max(...map.files.map(f=>f.offset+f.sizes.reduce((a,b)=>a+b,0)))!==size) throw Error('Blockmap does not cover installer');
  const sums = [];
  for (const name of names) {
    sums.push(await digest(path.join(ready,name),'sha256','hex')+' *'+name);
  }
  await fs.writeFile(path.join(ready,'SHA256SUMS-'+version+'.txt'),sums.join('\n')+'\n',{flag:'wx'});
  await finalizeDirectory(ready,output);
  console.log(output);
}

main().catch(error=>{console.error(error);process.exitCode=1});
