'use strict';
// This is a fixed, local review pack, not a user-controlled media-file reader.
// The separate digests prevent a changed manifest from authorizing changed files.
const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');
const VIDEO_GAIT = Object.freeze({ strideHeightRatio: 0.8342623859709787 / 1.0004711474757642, durationMs: 35 / 24 * 1000, subjectHeight: 198 });
const SOURCE_MODEL_SHA256 = '44cdaf1b970662e0a1c3aac1545e515047bf1cfb6bed0ac83b4d2c8b16a88866';
const VIDEO_FILES = Object.freeze({
  idle: Object.freeze({ src:'idle.webm',bytes:382755,sha256:'f6cd4ac5c5f96effb17be12579e9382421748496a59be3debed3b52f4e73bdb7',durationMs:4000,opaqueX:320 }),
  walk_left: Object.freeze({ src:'walk_left.webm',bytes:1789324,sha256:'f3a5b31e4b81c583a15e0cf22c828b37060225a17f06f1eaf420a82e89c22678',durationMs:VIDEO_GAIT.durationMs,opaqueX:329 }),
  walk_right: Object.freeze({ src:'walk_right.webm',bytes:1825941,sha256:'ea132b3fccc76b4a45b4407112bdca3d269f97871445064e5a67cf4cbeb19f41',durationMs:VIDEO_GAIT.durationMs,opaqueX:329 }),
});
const VIDEO_POSTER = Object.freeze({src:'idle_decoded_first_frame.png',bytes:218576,sha256:'90df97de172febea5fd7fc0f46394d65b25218a0948e432175422f453639732a'});
const PACK_ROOT = path.join(__dirname,'companion-view/video-preview');
const invalid = detail => new Error(`连续动画预览资源校验失败：${detail}；仍可使用原 Q 版桌宠。`);
function sameNumber(a,b) { return Number.isFinite(a) && Math.abs(a-b)<1e-8; }
async function readRegular(root, file, {bytes,maxBytes,sha256}={}) {
  if (!/^[A-Za-z0-9_-]+\.(webm|png|json)$/.test(file)) throw invalid('文件名无效');
  const local = path.join(root,file), stat = await fs.lstat(local);
  if (!stat.isFile() || stat.isSymbolicLink() || (bytes!==undefined&&stat.size!==bytes) || (maxBytes!==undefined&&stat.size>maxBytes)) throw invalid('文件类型或大小不符');
  const actual = await fs.realpath(local);
  if (path.relative(root,actual)!==file) throw invalid('文件超出已登记目录');
  const handle = await fs.open(local,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const opened = await handle.stat();
    if(!opened.isFile()||(bytes!==undefined&&opened.size!==bytes)||(maxBytes!==undefined&&opened.size>maxBytes))throw invalid('文件在读取前发生变化');
    const data = await handle.readFile();
    if((bytes!==undefined&&data.length!==bytes)||(maxBytes!==undefined&&data.length>maxBytes))throw invalid('读取大小不符');
    if(sha256&&createHash('sha256').update(data).digest('hex')!==sha256)throw invalid('SHA-256 不符');
    return {data,url:pathToFileURL(actual).href};
  } finally { await handle.close(); }
}
async function verifyVideoPreviewPack(root = PACK_ROOT) {
  // root is an internal dependency/test seam; it is never accepted over IPC.
  const directory = path.resolve(root), stat = await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw invalid('目录不安全');
  const realRoot = await fs.realpath(directory);
  let source;
  try { source=JSON.parse((await readRegular(realRoot,'manifest.json',{maxBytes:128*1024})).data.toString('utf8')); }
  catch(error) { throw invalid(`清单不可读取 (${error.code||'invalid'})`); }
  if(source.version!==1||!Array.isArray(source.clips)||source.clips.length!==3)throw invalid('清单版本或动作数量不符');
  if(source.preview?.characterId!=='yukino'||source.preview?.reviewOnly!==true||source.preview?.sourceModelSha256!==SOURCE_MODEL_SHA256)throw invalid('评审角色或来源不符');
  if(!Object.entries(VIDEO_GAIT).every(([key,value])=>sameNumber(source.preview.gait?.[key],value)))throw invalid('步态元数据不符');
  const poster=source.staticPoster;
  if(!poster||Object.entries(VIDEO_POSTER).some(([key,value])=>poster[key]!==value))throw invalid('静态回退清单不符');
  const ids=new Set(),clips=[],allowedAssetURLs=[];
  for(const item of source.clips){
    const pinned=VIDEO_FILES[item?.id];
    if(!pinned||ids.has(item.id))throw invalid('未知或重复动作');
    ids.add(item.id);
    if(item.src!==pinned.src||item.bytes!==pinned.bytes||item.sha256!==pinned.sha256||!sameNumber(item.durationMs,pinned.durationMs)||item.width!==640||item.height!==640||item.fps!==24||item.subjectHeight!==543||item.alpha!==true||item.loop!==true||item.mime!=='video/webm; codecs="vp9"'||item.anchor?.x!==320||item.anchor?.y!==600||item.alphaProbe?.transparent?.x!==0||item.alphaProbe?.transparent?.y!==0||item.alphaProbe?.opaque?.x!==pinned.opaqueX||item.alphaProbe?.opaque?.y!==250)throw invalid('视频声明与已评审素材不符');
    const verified=await readRegular(realRoot,pinned.src,pinned);
    allowedAssetURLs.push(verified.url);clips.push({...item,src:verified.url,motionWindows:[]});
  }
  const verifiedPoster=await readRegular(realRoot,VIDEO_POSTER.src,VIDEO_POSTER);
  const manifest={version:1,clips};
  // Share the renderer's bounded contract validation without giving the manifest
  // authority to register its own URLs. The fixed verified table above grants it.
  const {registerVideoManifest}=await import('./companion-view/animation/video-playback.mjs');
  registerVideoManifest(manifest,{allowedAssetURLs});
  return {manifest,allowedAssetURLs,posterURL:verifiedPoster.url,gait:{...VIDEO_GAIT},reviewOnly:true,characterId:'yukino'};
}
module.exports={verifyVideoPreviewPack,VIDEO_GAIT,VIDEO_FILES,VIDEO_POSTER,SOURCE_MODEL_SHA256};
