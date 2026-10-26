'use strict';
// A private child process, never an aria2 RPC server. Importing this module does not download.
const fs = require('node:fs/promises');
const {createReadStream} = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const active = new Set();

function check(signal) { signal?.throwIfAborted(); }
function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('资源下载地址必须是没有账号密码的 HTTPS 地址');
  url.hash = ''; return url.href;
}
function normalizeSources(sources, url) {
  const entries = sources === undefined ? [url] : sources;
  if (!Array.isArray(entries) || !entries.length || entries.length > 8) throw Error('资源下载源清单无效');
  const seen = new Set();
  return entries.map(entry => {
    const address = httpsUrl(typeof entry === 'string' ? entry : entry?.url);
    const label = typeof entry?.label === 'string' ? entry.label.replace(/[\x00-\x1f]/g, '').slice(0, 100) : new URL(address).hostname;
    return {url:address,label};
  }).filter(entry => { if (seen.has(entry.url)) return false; seen.add(entry.url); return true; });
}
async function regular(file) {
  try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('下载目标不是普通文件'); return stat; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function verify(file, bytes, sha256, signal) {
  check(signal); const stat = await regular(file); if (!stat || stat.size !== bytes) return false;
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) { check(signal); hash.update(chunk); }
  check(signal); return hash.digest('hex') === sha256;
}
function defaultAria2Path() {
  return process.resourcesPath ? path.join(process.resourcesPath,'aria2','aria2c.exe') : path.join(__dirname,'..','build','aria2','aria2c.exe');
}
function buildAria2Args({url, temporary, sha256, timeoutMs=30000}) {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  // --max-redirect is NOT an aria2 1.37 option. Invalid flags silently defeat acceleration.
  return ['--no-conf=true','--no-netrc=true','--enable-rpc=false','--check-certificate=true',
    '--follow-metalink=false','--follow-torrent=false','--enable-dht=false','--enable-dht6=false','--bt-enable-lpd=false',
    '--max-connection-per-server=8','--split=8','--min-split-size=8M','--continue=true','--check-integrity=true',
    '--auto-save-interval=1','--file-allocation=none','--allow-overwrite=true','--auto-file-renaming=false',
    '--max-tries=2','--retry-wait=2',`--connect-timeout=${Math.min(15,seconds)}`,`--timeout=${seconds}`,
    '--summary-interval=1','--human-readable=false','--enable-color=false','--console-log-level=warn',
    '--show-console-readout=true','--download-result=hide',`--checksum=sha-256=${sha256}`,
    `--dir=${path.dirname(temporary)}`,`--out=${path.basename(temporary)}`,'--',url];
}
function parseProgress(text,total) {
  const matches = [...text.matchAll(/\[#\w+\s+(\d+(?:\.\d+)?)(B|KiB|MiB|GiB)?\/(\d+(?:\.\d+)?)(B|KiB|MiB|GiB)?[^\r\n]*?DL:(\d+(?:\.\d+)?)(B|KiB|MiB|GiB)?/g)];
  if (!matches.length) return null;
  const row = matches.at(-1), units={B:1,KiB:1024,MiB:1024**2,GiB:1024**3};
  return {received:Math.min(total,Number(row[1])*(units[row[2]]||1)),total,speedBytesPerSecond:Number(row[5])*(units[row[6]]||1)};
}
async function runAria2({executable,url,temporary,sha256,bytes,timeoutMs,signal,emit,spawnProcess}) {
  check(signal);
  await new Promise((resolve,reject) => {
    let child, killTimer, finished=false, buffer='';
    function finish(error) { if(finished)return; finished=true; clearTimeout(killTimer); signal?.removeEventListener('abort',cancel); error?reject(error):resolve(); }
    function cancel() {
      // Do not return until close, so extraction/cleanup cannot race Windows file handles.
      child?.kill('SIGINT'); killTimer=setTimeout(()=>child?.kill('SIGKILL'),3000); killTimer.unref?.();
    }
    try { child=spawnProcess(executable,buildAria2Args({url,temporary,sha256,timeoutMs}),{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']}); }
    catch(error) { finish(error); return; }
    child.stdout?.on('data',chunk=>{buffer=(buffer+String(chunk)).slice(-16384); const value=parseProgress(buffer,bytes); if(value)emit(value);});
    child.stderr?.on('data',()=>{}); // Drain, but never display redirect URLs, proxy credentials, or raw process logs.
    child.once('error',finish);
    child.once('close',code=>{if(signal?.aborted)finish(signal.reason||Error('已取消下载'));else finish(code===0?null:Error('多连接下载未完成'));});
    signal?.addEventListener('abort',cancel,{once:true}); if(signal?.aborted)cancel();
  });
}
function abortable(promise,signal) {
  check(signal);
  return new Promise((resolve,reject)=>{
    const aborted=()=>reject(signal.reason||Error('已取消下载'));
    signal.addEventListener('abort',aborted,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));
    if(signal.aborted)aborted();
  });
}
async function downloadHttps({url,temporary,bytes,signal:outerSignal,timeoutMs,emit,fetcher}) {
  const idle=new AbortController();
  const signal=outerSignal?AbortSignal.any([outerSignal,idle.signal]):idle.signal;
  let timer, response, reader, output, received=0, previous=0, tick=Date.now(), lastEmit=0;
  const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>idle.abort(Error('下载源长时间没有响应')),timeoutMs);};
  try {
    const stat=await regular(temporary); let offset=stat?.size||0;
    if(offset>=bytes){await fs.rm(temporary,{force:true});offset=0;}
    const headers={'Accept-Encoding':'identity',...(offset?{Range:`bytes=${offset}-`}:{})};
    for(let redirects=0;;redirects++) {
      check(signal); reset();
      response=await abortable(fetcher(httpsUrl(url),{signal,headers,redirect:'manual'}),signal);
      if(![301,302,303,307,308].includes(response.status))break;
      const target=response.headers.get('location'); await response.body?.cancel();
      if(!target||redirects>=10)throw Error('下载源重定向无效');
      url=httpsUrl(new URL(target,url).href);
    }
    if(![200,206].includes(response.status)||!response.body)throw Error(`下载源返回 HTTP ${response.status}`);
    if(response.status===206) {
      const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
      if(!range||Number(range[1])!==offset||Number(range[2])!==bytes-1||Number(range[3])!==bytes)throw Error('下载源返回的断点范围不正确');
    } else offset=0; // Servers may ignore Range. Restart instead of appending duplicate data.
    const declared=response.headers.get('content-length');
    if(declared&&Number(declared)!==bytes-offset)throw Error('下载源文件长度与资源清单不符');
    check(signal); output=await fs.open(temporary,offset?'a':'w');
    reader=response.body.getReader();received=offset;previous=offset;
    emit({received,total:bytes,speedBytesPerSecond:0});
    while(true) {
      reset();const {done,value}=await abortable(reader.read(),signal);if(done)break;
      check(signal);if(received+value.length>bytes)throw Error('下载内容超过资源清单大小');
      let written=0;
      while(written<value.length){check(signal);const part=await output.write(value,written,value.length-written);if(!part.bytesWritten)throw Error('下载文件写入失败');written+=part.bytesWritten;}
      received+=value.length;const now=Date.now();
      if(now-lastEmit>=200||received===bytes){emit({received,total:bytes,speedBytesPerSecond:(received-previous)*1000/Math.max(1,now-tick)});lastEmit=now;}
      if(now-tick>=1000){previous=received;tick=now;}
    }
    check(signal);if(received!==bytes)throw Error('下载未完成，可重试继续');
    await output.sync();
  } finally {
    clearTimeout(timer);
    if(reader){try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}
    else try{await response?.body?.cancel();}catch{}
    await output?.close();
  }
}

async function downloadResource({url,sources,dest,bytes,sha256,onProgress=()=>{},signal,
  aria2Path=defaultAria2Path(),fetcher=globalThis.fetch,spawnProcess=spawn,timeoutMs=30000}={}) {
  check(signal);const candidates=normalizeSources(sources,url);
  if(!path.isAbsolute(dest||'')||!Number.isSafeInteger(bytes)||bytes<1||!/^[a-f0-9]{64}$/.test(sha256||'')||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>1800000)throw Error('资源下载清单无效');
  dest=path.resolve(dest);if(active.has(dest))throw Error('该资源已经在下载');active.add(dest);
  const sparse=dest+'.aria2.partial',continuous=dest+'.https.partial';
  const notify=progress=>{try{onProgress(progress);}catch{}};
  try {
    await fs.mkdir(path.dirname(dest),{recursive:true});check(signal);
    if(await verify(dest,bytes,sha256,signal))return{path:dest,engine:'cache',source:null,resumed:false};
    await regular(sparse);await regular(sparse+'.aria2');await regular(continuous);
    const hasAria2=Boolean(aria2Path&&await regular(aria2Path));
    for(let index=0;index<candidates.length;index++) {
      check(signal);const source=candidates[index];
      const progress=(engine,extra={})=>notify({phase:'downloading',received:0,total:bytes,engine,sourceIndex:index,sourceCount:candidates.length,sourceLabel:source.label,...extra});
      if(index)progress(hasAria2?'aria2':'https',{sourceSwitch:true});
      for(const engine of hasAria2?['aria2','https']:['https']) {
        const temporary=engine==='aria2'?sparse:continuous;
        let resumed=Boolean(await regular(temporary));
        try {
          check(signal);progress(engine);
          for(let integrityAttempt=0;integrityAttempt<2;integrityAttempt++) {
            if(engine==='aria2')await runAria2({executable:aria2Path,url:source.url,temporary,sha256,bytes,timeoutMs,signal,emit:value=>progress(engine,value),spawnProcess});
            else if(!await verify(temporary,bytes,sha256,signal))await downloadHttps({url:source.url,temporary,bytes,signal,timeoutMs,emit:value=>progress(engine,value),fetcher});
            progress(engine,{phase:'checking',received:bytes});
            if(await verify(temporary,bytes,sha256,signal))break;
            await fs.rm(temporary,{force:true});if(engine==='aria2')await fs.rm(temporary+'.aria2',{force:true});
            // A previous failed source may have left a corrupt prefix. Give the
            // current HTTPS source one clean retry instead of blaming that mirror.
            if(engine==='https'&&resumed&&integrityAttempt===0){resumed=false;progress(engine,{retrying:true});continue;}
            throw Error('下载文件完整性校验失败');
          }
          check(signal);await fs.rename(temporary,dest);
          await Promise.all([sparse,sparse+'.aria2',continuous].map(file=>fs.rm(file,{force:true}).catch(()=>{})));
          progress(engine,{phase:'complete',received:bytes});
          return{path:dest,engine,source:{index,label:source.label},resumed};
        } catch(error) {
          check(signal);
          if(engine==='https'&&['EACCES','EPERM','ENOSPC','EROFS','EIO'].includes(error.code))throw Error('无法写入下载目录，请检查磁盘空间与文件权限。');
          // Sparse aria2 data must never be resumed as contiguous HTTPS bytes.
          progress(engine,{phase:'downloading',retrying:true});
        }
      }
    }
    throw Error('所有下载源均暂时不可用，或文件校验未通过。请重试，或打开“无法下载，寻求帮助”。');
  } finally {active.delete(dest);}
}
module.exports={downloadResource,defaultAria2Path,buildAria2Args,parseProgress,normalizeSources};
