'use strict';
// Exercise the production planner and stream writer over real HTTP ranges
// using a pair of electron-builder release artifacts. Nothing is installed.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {once} = require('node:events');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const {planDownload, transfer, verifyFile} = require('../electron/update-blockmap.cjs');

async function main(previous, releaseDirectory) {
  const manifest = yaml.load(await fsp.readFile(path.join(releaseDirectory,'latest.yml'),'utf8'));
  const target = manifest.files.find(f=>f.url === 'Yukino-Companion-'+manifest.version+'-Base-Setup.exe');
  if (!target) throw Error('Missing base installer metadata');
  const file = path.join(releaseDirectory,target.url);
  let payloadBytes = 0, mapBytes = 0, ranges = 0;
  const server = http.createServer((req, res)=>{
    if (req.url === '/map') {
      const map = fs.readFileSync(file+'.blockmap'); mapBytes+=map.length; res.end(map);return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (!match) {res.writeHead(416);res.end();return;}
    const start = Number(match[1]), end = Number(match[2]);
    ranges++; payloadBytes += end + 1 - start;
    res.writeHead(206, {'content-range':'bytes '+start+'-'+end+'/'+target.size,'content-length':end+1-start});
    fs.createReadStream(file,{start,end}).pipe(res);
  });
  const cache = await fsp.mkdtemp(path.join(os.tmpdir(),'yukino-release-delta-'));
  try {
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    await fsp.copyFile(previous,path.join(cache,'installer.exe'));
    await fsp.copyFile(previous+'.blockmap',path.join(cache,'current.blockmap'));
    const url = 'http://127.0.0.1:'+server.address().port, signal = AbortSignal.timeout(10*60*1000);
    const release = {...target, url, mapUrl:url+'/map'};
    const plan = await planDownload({cache,release,get:fetch,signal});
    const part = path.join(cache,'rebuilt.exe.part');
    const result = await transfer({part,plan,release,get:fetch,signal,progress(){}});
    await verifyFile(part,release);
    assert.equal(result.bytes,payloadBytes);assert.ok(payloadBytes+mapBytes < target.size);
    console.log(JSON.stringify({old:path.basename(previous),version:manifest.version,ranges,payloadBytes,mapBytes,fullSize:target.size,verifiedSha512:target.sha512,savedPercent:(100*(1-(payloadBytes+mapBytes)/target.size)).toFixed(2)},null,2));
  } finally {
    server.closeAllConnections();server.close();
    await fsp.rm(cache,{recursive:true,force:true});
  }
}

main(...process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
