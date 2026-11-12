const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const REPO='https://github.com/fqxxzyw/Yukino-Companion';
const API='https://api.github.com/repos/fqxxzyw/Yukino-Companion/releases?per_page=30';
function version(value){const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value||'');return m&&m.slice(1).map(Number)}
function newer(a,b){const x=version(a),y=version(b);if(!x||!y)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]}return false}
function trustedAsset(asset){try{const u=new URL(asset.browser_download_url);return u.protocol==='https:'&&u.hostname==='github.com'&&u.pathname.startsWith('/fqxxzyw/Yukino-Companion/releases/download/')&&Number.isSafeInteger(asset.size)&&asset.size>0&&asset.size<2*1024**3}catch{return false}}
async function get(url,timeout=30000){const response=await fetch(url,{headers:{'User-Agent':'Yukino-Companion','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(timeout)});if(!response.ok)throw Error('GitHub 请求失败：'+response.status);return response}
function createUpdater({app,dialog,shell,send}){
 let selected=null,downloading=false;
 async function check(){const releases=await (await get(API)).json();if(!Array.isArray(releases))throw Error('GitHub 发行信息无效');const candidates=releases.filter(r=>!r.draft&&!r.prerelease&&newer(r.tag_name,app.getVersion())).sort((a,b)=>newer(a.tag_name,b.tag_name)?-1:1);selected=null;const r=candidates[0];if(r){const asset=(r.assets||[]).find(a=>a.name===`Yukino-Companion-${r.tag_name.replace(/^v/,'')}-Base-Setup.exe`&&trustedAsset(a));selected={tag:r.tag_name,asset,checksums:(r.assets||[]).find(a=>a.name==='SHA256SUMS.txt'&&a.size<=100000&&trustedAsset(a))}}return selected?{version:selected.tag,downloadable:!!selected.asset}:null}
 async function download(){if(downloading)throw Error('更新包正在下载');if(!selected)throw Error('请先检查更新');if(!selected.asset)throw Error('当前发行版没有可下载的基础安装包，请前往 GitHub。');const chosen=selected;const result=await dialog.showSaveDialog({title:'保存更新安装包',defaultPath:path.join(app.getPath('downloads'),chosen.asset.name),filters:[{name:'Windows 安装程序',extensions:['exe']}]});if(result.canceled||!result.filePath)return {cancelled:true};downloading=true;let temp=result.filePath+'.'+randomUUID()+'.part';try{
  let expected=/^sha256:([a-f0-9]{64})$/i.exec(chosen.asset.digest||'')?.[1]?.toLowerCase();
  if(!expected&&chosen.checksums){const data=await (await get(chosen.checksums.browser_download_url)).text();if(data.length>100000)throw Error('校验文件过大');for(const line of data.split(/\r?\n/)){const match=/^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line);if(match&&match[2]===chosen.asset.name)expected=match[1].toLowerCase()}}
  if(!expected)throw Error('发行版没有可用的 SHA-256 校验值，请前往 GitHub 更新。');
  const response=await get(chosen.asset.browser_download_url,30*60*1000),hash=createHash('sha256');let bytes=0,last=0;
  const counter=new Transform({transform(chunk,enc,cb){bytes+=chunk.length;if(bytes>chosen.asset.size)return cb(Error('安装包大小不符'));hash.update(chunk);if(Date.now()-last>250){send('app-update-progress',{bytes,total:chosen.asset.size});last=Date.now()}cb(null,chunk)}});
  await pipeline(Readable.fromWeb(response.body),counter,fs.createWriteStream(temp,{flags:'wx'}));if(bytes!==chosen.asset.size||hash.digest('hex')!==expected)throw Error('安装包校验失败，请重试或前往 GitHub 更新。');await fsp.rename(temp,result.filePath);temp=null;shell.showItemInFolder(result.filePath);return {saved:true};
 }finally{downloading=false;if(temp)await fsp.rm(temp,{force:true}).catch(()=>{})}}
 return {check,download,open:()=>shell.openExternal(REPO+'/releases')};
}
module.exports={createUpdater,newer,trustedAsset};
