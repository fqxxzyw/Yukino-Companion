const fs = require('node:fs/promises');
const path = require('node:path');
const {sha256} = require('./verify-offline-package.cjs');
const LIMIT = 2 * 1024 ** 3;
async function verifyReleaseAssets(directory) {
  const names = (await fs.readdir(directory)).filter(name => name.endsWith('.exe')).sort();
  if (!names.length) throw Error('未找到待发布的 EXE');
  const files = [];
  for (const name of names) {
    const file = path.join(directory, name), stat = await fs.stat(file);
    if (!stat.isFile() || stat.size < 1024 * 1024) throw Error(`EXE 产物无效：${name}`);
    if (stat.size >= LIMIT) throw Error(`EXE ${name} 已达到 GitHub 单文件 2 GiB 上限。不要发布残缺文件；请使用 CPU 完整版，或把可选 CUDA 运行环境独立分发。`);
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
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), files.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
  await fs.writeFile(path.join(directory, 'release-assets.json'), JSON.stringify({schemaVersion:1,files},null,2)+'\n');
  return files;
}
if (require.main === module) verifyReleaseAssets(path.resolve(process.argv[2] || 'release'))
  .then(result => console.log(JSON.stringify(result,null,2)))
  .catch(error => {console.error(error.message);process.exitCode=1;});
module.exports = {verifyReleaseAssets, LIMIT};
