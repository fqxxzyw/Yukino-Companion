'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');

const outfits = {
  kimono: {id:'yukino-04-v1', label:'蓝色花纹和服'},
  'summer-uniform': {
    id:'summer-uniform', label:'夏日制服', thumbnail:'./characters/thumbnails/yukino-summer-uniform.png',
    avatarThumbnail:'./characters/thumbnails/yukino-summer-uniform-avatar.png',
  },
  swimsuit: {id:'yukino-03-v1', label:'白色连体泳装蓝蝴蝶结'},
  'winter-uniform': {id:'winter-uniform', label:'冬季制服（待补口型）'},
  'black-qipao': {id:'yukino-05-v1', label:'黑色旗袍'},
  'twin-tail': {
    id:'twin-tail', label:'双马尾', thumbnail:'./characters/thumbnails/yukino-twin-tail.png',
    avatarThumbnail:'./characters/thumbnails/yukino-twin-tail-avatar.png',
  },
  beret: {id:'yukino-02-v1', label:'蓝色开衫贝雷帽'},
};
const sha256 = /^[a-f0-9]{64}$/;
const maxModelBytes = 128 * 1024 ** 2;
const maxActionBytes = 32 * 1024 ** 2;

function pinned(value, limit) {
  return value && sha256.test(value.sha256) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= limit;
}

function candidateFile(root, entry, actions = false) {
  return path.join(root, entry.sha256 + (actions ? '.actions.json' : '.vrm'));
}

async function matchesSize(filename, bytes) {
  const stat = await fs.lstat(filename).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink() && stat.size === bytes;
}

async function verifiedFile(filename, sha, limit, bytes) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit ||
      (bytes !== undefined && bytes !== stat.size)) throw Error('本机模型兼容性文件大小无效');
  const data = await fs.readFile(filename);
  if (data.length !== stat.size || createHash('sha256').update(data).digest('hex') !== sha)
    throw Error('本机模型兼容性文件校验失败');
  return data;
}

async function verifyRevision(root, candidate, style) {
  const base = {sha256:candidate.compatibilityBaseSha256, actionPack:candidate.compatibilityBaseActionPack};
  if (!sha256.test(base.sha256) || !pinned(base.actionPack, maxActionBytes)) return false;
  const [baseBytes, revisionBytes, baseActions, revisionActions] = await Promise.all([
    verifiedFile(candidateFile(root, base), base.sha256, maxModelBytes),
    verifiedFile(candidateFile(root, candidate), candidate.sha256, maxModelBytes, candidate.bytes),
    verifiedFile(candidateFile(root, base, true), base.actionPack.sha256, maxActionBytes, base.actionPack.bytes),
    verifiedFile(candidateFile(root, candidate, true), candidate.actionPack.sha256, maxActionBytes, candidate.actionPack.bytes),
  ]);
  const {verifyCompatibleVrm} = require('./yukino-vrm-compatibility.cjs');
  const rebound = await verifyCompatibleVrm(baseBytes, revisionBytes, JSON.parse(baseActions), style);
  return isDeepStrictEqual(rebound, JSON.parse(revisionActions));
}

async function localYukinoOutfits(root, builtins) {
  const directory = await fs.lstat(root).catch(() => null);
  if (!directory?.isDirectory() || directory.isSymbolicLink()) return builtins;
  const filename = path.join(root, 'catalog.json');
  const stat = await fs.lstat(filename).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 1024 ** 2) return builtins;
  const manifest = await fs.readFile(filename, 'utf8').then(JSON.parse).catch(() => null);
  if (manifest?.schemaVersion !== 1 || !manifest.outfits || Array.isArray(manifest.outfits)) return builtins;

  const models = [...builtins];
  for (const [style, outfit] of Object.entries(outfits)) {
    const candidate = manifest.outfits[style];
    if (!pinned(candidate, maxModelBytes) || !pinned(candidate.actionPack, maxActionBytes)) continue;
    if (!await matchesSize(candidateFile(root, candidate), candidate.bytes) ||
        !await matchesSize(candidateFile(root, candidate, true), candidate.actionPack.bytes)) continue;
    const isRevision = Object.hasOwn(candidate, 'compatibilityBaseSha256');
    if (isRevision && !await verifyRevision(root, candidate, style).catch(() => false)) continue;
    const clips = Object.fromEntries(Object.entries(candidate.clips || {}).filter(([name, clip]) =>
      /^[A-Za-z0-9_]{1,80}$/.test(name) && Number.isFinite(clip?.duration) && clip.duration > 0 && clip.duration <= 120 && typeof clip.loop === 'boolean'
    ).map(([name, clip]) => [name, {
      duration:clip.duration, loop:clip.loop, autonomous:clip.autonomous !== false,
      ...(name === 'Speak_PhraseCadence' && clip.speechEligible === true && Number.isFinite(clip.minRepeatGapSeconds) && clip.minRepeatGapSeconds >= 0
        ? {speechEligible:true, minRepeatGapSeconds:clip.minRepeatGapSeconds} : {}),
    }]));
    if (!clips.Idle_Breathe?.loop) continue;

    const index = models.findIndex(model => model.id === outfit.id);
    const original = models[index];
    const entry = {
      id:outfit.id, outfitGroup:original?.outfitGroup || outfit.id, characterId:'yukino',
      label:outfit.label, version:'2026-11-13', ready:true, status:'local_runtime_candidate',
      url:'local-yukino-outfit:' + style, format:'vrm', runtimeCandidate:style,
      thumbnail:outfit.thumbnail ?? original?.thumbnail, bytes:candidate.bytes, sha256:candidate.sha256,
      ...(outfit.avatarThumbnail ? {avatarThumbnail:outfit.avatarThumbnail} : {}),
      ...(isRevision ? {compatibilityBaseSha256:candidate.compatibilityBaseSha256} : {}),
      defaultClip:'Idle_Breathe', clips,
      actionPack:{bytes:candidate.actionPack.bytes, sha256:candidate.actionPack.sha256},
    };
    if (index === -1) models.push(entry);
    else models[index] = entry;
  }
  return manifest.retireOriginals === true && models.some(model => model.runtimeCandidate === 'summer-uniform')
    ? models.filter(model => model.runtimeCandidate || !/^yukino-0[1-7](?:-|$)/.test(model.id))
    : models;
}

module.exports = {candidateFile, localYukinoOutfits, maxActionBytes, maxModelBytes};
