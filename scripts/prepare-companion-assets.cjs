'use strict';
// Fetch the pinned, digest-checked source artwork and original OGG voice library.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../electron/companion-view/assets/provenance.json');
const root = path.resolve(__dirname, '../electron/companion-view');
async function valid(file, entry) {
  try { const data = await fs.readFile(file); return data.length === entry.bytes && crypto.createHash('sha256').update(data).digest('hex') === entry.sha256; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function prepare() {
  for (const entry of manifest.files) {
    if (!/^assets\/[a-z-]+\.png$/.test(entry.path)) continue;
    const target = path.join(root, entry.path);
    if (await valid(target, entry)) { console.log(`Verified ${entry.path}`); continue; }
    const response = await fetch(`https://raw.githubusercontent.com/fqxxzyw/yukino_desktop_pet/${manifest.revision}/src/YukinoPet/${entry.path}`, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw Error(`Artwork download failed (${response.status}): ${entry.path}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== entry.bytes || crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256) throw Error(`Artwork digest mismatch: ${entry.path}`);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(`${target}.tmp`, data); await fs.rename(`${target}.tmp`, target);
    console.log(`Prepared ${entry.path}`);
  }
  await prepareVoices();
}
async function prepareVoices() {
  const archiveSha='7b8b150e6b2593b43dd44bf476348b7a44ea0ab6c90d9bddc6a31cce1e2cb6bc';
  const voices=path.join(root,'assets/voices'), index=path.join(root,'assets/voices.json');
  try {
    const cached=JSON.parse(await fs.readFile(index,'utf8'));
    if(cached.archiveSha256===archiveSha&&cached.count===2391&&cached.files.length===2391) {
      let complete=true;
      for(const item of cached.files){if(!/^[A-Za-z0-9_-]+\.ogg$/.test(item.file)||!await valid(path.join(voices,item.file),item)){complete=false;break;}}
      if(complete){console.log('Verified 2391 original desktop-pet voice clips');return;}
    }
  }catch(error){if(error.code!=='ENOENT')console.warn('Rebuilding desktop pet voice resources');}
  const directory=path.resolve(__dirname,'../build'),archive=path.join(directory,'pet-voices.zip');
  await fs.mkdir(directory,{recursive:true});
  if(!await valid(archive,{bytes:80380288,sha256:archiveSha})){
    const response=await fetch(`https://raw.githubusercontent.com/fqxxzyw/yukino_desktop_pet/${manifest.revision}/src/YukinoPet/voice/YukinoVoices.zip`,{signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error(`Desktop pet voice download failed (${response.status})`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length!==80380288||crypto.createHash('sha256').update(bytes).digest('hex')!==archiveSha)throw Error('Desktop pet voice archive checksum mismatch');
    await fs.writeFile(archive,bytes);
  }
  const {spawnSync}=require('node:child_process');
  const result=spawnSync(process.env.YUKINO_BUILD_PYTHON||(process.platform==='win32'?'python':'python3'),[path.join(__dirname,'prepare-pet-voices.py'),archive,voices],{stdio:'inherit',shell:false});
  if(result.error||result.status!==0)throw result.error||Error('Desktop pet voice extraction failed');
}
if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare, valid, prepareVoices };
