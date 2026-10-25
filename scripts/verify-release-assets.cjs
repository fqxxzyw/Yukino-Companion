const fs = require('node:fs/promises');
const path = require('node:path');
const {createReadStream} = require('node:fs');
const crypto = require('node:crypto');
const {sha256} = require('./verify-offline-package.cjs');
const LIMIT = 2 * 1024 ** 3;
async function verifyReleaseAssets(directory, {requirePayload=false}={}) {
  const names = (await fs.readdir(directory)).filter(name => name.endsWith('.exe')).sort();
  if (!names.length) throw Error('未找到待发布的 EXE');
  const files = [];
  for (const name of names) {
    const file = path.join(directory, name), stat = await fs.stat(file);
    if (!stat.isFile() || stat.size < 128 * 1024) throw Error(`EXE 产物无效：${name}`);
    if (stat.size >= LIMIT) throw Error(`EXE ${name} 已达到 GitHub 单文件 2 GiB 上限；请使用小型安装器和完整模型分卷。`);
    const handle = await fs.open(file, 'r');
    try {
      const dos = Buffer.alloc(64), signature = Buffer.alloc(4);
      await handle.read(dos, 0, dos.length, 0);
      const offset = dos.readUInt32LE(60);
      if (dos.toString('ascii', 0, 2) !== 'MZ' || offset < 64 || offset > stat.size - 4) throw Error(`EXE 格式无效：${name}`);
      await handle.read(signature, 0, signature.length, offset);
      if (signature.toString('hex') !== '50450000') throw Error(`EXE PE 签名无效：${name}`);
    } finally { await handle.close(); }
    files.push({name, bytes:stat.size, sha256:await sha256(file)});
  }
  let payload;
  try {payload=JSON.parse(await fs.readFile(path.join(directory,'app-payload.json'),'utf8'));}
  catch(error){if(requirePayload||error.code!=='ENOENT')throw error;}
  if(payload){
    if(payload.schemaVersion!==1||payload.version!=='0.4.0'||!Array.isArray(payload.parts)||!payload.parts.length||!/^[a-f0-9]{64}$/.test(payload.archiveSha256||''))throw Error('应用分卷清单无效');
    const archive=crypto.createHash('sha256');let total=0;
    for(const [index,part] of payload.parts.entries()){
      const expected=`Yukino-Companion-0.4.0-windows-x64.zip.part${String(index+1).padStart(3,'0')}`;
      if(part.path!==expected||part.algorithm!=='sha256'||!/^[a-f0-9]{64}$/.test(part.digest||'')||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>900*1024**2)throw Error('应用分卷清单不完整');
      const file=path.join(directory,part.path),stat=await fs.stat(file),hash=crypto.createHash('sha256');
      if(!stat.isFile()||stat.size!==part.bytes)throw Error('应用分卷长度不符');
      for await(const block of createReadStream(file)){hash.update(block);archive.update(block);}
      const digest=hash.digest('hex');if(digest!==part.digest)throw Error('应用分卷校验失败');
      files.push({name:part.path,bytes:stat.size,sha256:digest});total+=stat.size;
    }
    if(total!==payload.bytes||archive.digest('hex')!==payload.archiveSha256)throw Error('完整应用 ZIP 校验失败');
    const file=path.join(directory,'app-payload.json');files.push({name:'app-payload.json',bytes:(await fs.stat(file)).size,sha256:await sha256(file)});
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), files.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
  await fs.writeFile(path.join(directory, 'release-assets.json'), JSON.stringify({schemaVersion:1,files},null,2)+'\n');
  return files;
}
if (require.main === module) verifyReleaseAssets(path.resolve(process.argv[2] || 'release'),{requirePayload:true})
  .then(result => console.log(JSON.stringify(result,null,2)))
  .catch(error => {console.error(error.message);process.exitCode=1;});
module.exports = {verifyReleaseAssets, LIMIT};
