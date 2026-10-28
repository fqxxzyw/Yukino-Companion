'use strict';
// Bind every installed payload file to the bytes produced by this source build.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createReadStream}=require('node:fs');
async function digest(file){const hash=crypto.createHash('sha256');for await(const data of createReadStream(file))hash.update(data);return hash.digest('hex');}
async function record(directory){
  const files=[];
  async function visit(relative){
    for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})){
      const name=path.posix.join(relative,entry.name),file=path.join(directory,name);
      if(entry.isSymbolicLink())throw Error('Payload links are forbidden');
      if(entry.isDirectory())await visit(name);
      else if(entry.isFile())files.push({path:name,bytes:(await fs.stat(file)).size,sha256:await digest(file)});
      else throw Error('Unexpected payload entry');
    }
  }
  await visit('');files.sort((a,b)=>a.path.localeCompare(b.path));
  if(!files.length)throw Error('Empty payload');
  return {schemaVersion:1,files};
}
async function verify(directory,manifest){
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Invalid payload manifest');
  const seen=new Set();
  for(const item of manifest.files){
    if(typeof item.path!=='string'||!item.path||item.path.includes('\\')||item.path.includes(':')||path.posix.isAbsolute(item.path)||item.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(item.path.toLowerCase())||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid payload entry');
    seen.add(item.path.toLowerCase());
    // Check every ancestor as well as the file, so a directory link cannot escape.
    let cursor=directory;
    for(const part of item.path.split('/')){cursor=path.join(cursor,part);if((await fs.lstat(cursor)).isSymbolicLink())throw Error('Payload links are forbidden');}
    const stat=await fs.lstat(cursor);
    if(!stat.isFile()||stat.size!==item.bytes||await digest(cursor)!==item.sha256)throw Error('Installed payload mismatch: '+item.path);
  }
  return {verifiedFiles:seen.size};
}
if(require.main===module)(async()=>{
  const [mode,directory,manifestFile]=process.argv.slice(2);
  if(!directory||!manifestFile||!['record','verify'].includes(mode))throw Error('Usage: node scripts/base-payload.cjs record|verify DIRECTORY MANIFEST');
  if(mode==='record')await fs.writeFile(manifestFile,JSON.stringify(await record(directory),null,2)+'\n');
  else console.log(await verify(directory,JSON.parse(await fs.readFile(manifestFile,'utf8'))));
})().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={record,verify};
