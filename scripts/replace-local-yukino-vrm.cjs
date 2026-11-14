#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {candidateFile,maxModelBytes} = require('../electron/local-yukino-outfits.cjs');
const {approvedYukinoBases,verifyCompatibleVrm} = require('../electron/yukino-vrm-compatibility.cjs');
const {writeAtomicJson} = require('../electron/atomic-json.cjs');

const actionLimit = 4 * 1024 ** 2;
const catalogLimit = 1024 ** 2;
const sha = data => createHash('sha256').update(data).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const usage = `用法：node scripts/replace-local-yukino-vrm.cjs <款式 ID> <新版.vrm> [--root <模型目录>] [--apply]
款式：${Object.keys(approvedYukinoBases).join('、')}
默认只检查并显示替换计划。关闭 Yukino Companion 后使用 --apply，替换完成后重新启动应用。`;

function requireCondition(condition, message) {
  if (!condition) throw Error(message);
}

function argumentsFor(args) {
  if (args.length === 1 && ['--help','-h'].includes(args[0])) return null;
  const [style, filename, ...options] = args;
  requireCondition(Object.hasOwn(approvedYukinoBases,style) && filename &&
    ['.vrm','.glb'].includes(path.extname(filename).toLowerCase()), usage);
  let root, apply = false;
  while (options.length) {
    const option = options.shift();
    if (option === '--apply' && !apply) apply = true;
    else if (option === '--root' && !root && options[0] && !options[0].startsWith('--')) root = options.shift();
    else throw Error(usage);
  }
  requireCondition(root || process.env.APPDATA, '未找到 APPDATA，请使用 --root 指定模型目录');
  return {style,filename:path.resolve(filename),root:path.resolve(root ?? path.join(process.env.APPDATA,'yukino-companion','local-yukino-outfits')),apply};
}

async function readRegular(file, limit) {
  const expected = await fs.lstat(file);
  requireCondition(expected.isFile() && !expected.isSymbolicLink() && expected.size > 0 &&
    expected.size <= limit, '文件不是普通文件或超出大小限制：' + file);
  const handle = await fs.open(file,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    requireCondition(opened.isFile() && opened.ino === expected.ino && opened.dev === expected.dev &&
      opened.size === expected.size, '读取前文件发生变化：' + file);
    const buffer = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await handle.read(buffer,offset,buffer.length - offset,offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const read = await handle.stat();
    requireCondition(offset === opened.size && read.mtimeMs === opened.mtimeMs && read.size === opened.size,
      '读取期间文件发生变化：' + file);
    return buffer.subarray(0,offset);
  } finally {
    await handle.close();
  }
}

async function readPinned(file, record, limit) {
  requireCondition(digestPattern.test(record?.sha256) && Number.isSafeInteger(record?.bytes) &&
    record.bytes > 0 && record.bytes <= limit, '模型或动作摘要无效');
  const data = await readRegular(file,limit);
  requireCondition(data.length === record.bytes && sha(data) === record.sha256, '文件 SHA-256 不匹配：' + file);
  return data;
}

function parseJson(data) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}

function encodeActionPack(pack) {
  return Buffer.from(JSON.stringify(pack,(_key,value) => Object.is(value,-0) ? JSON.rawJSON('-0') : value));
}

function runtimeWeights(data) {
  const json = parseJson(data.subarray(20,20 + data.readUInt32LE(12)));
  return import('../src/ui/eight-weight-skinning.mjs').then(({inspectGlbSkinning}) =>
    inspectGlbSkinning(json,data.buffer.slice(data.byteOffset,data.byteOffset + data.byteLength)));
}

async function publishUnchangedFile(file,data,limit) {
  try {
    const existing = await readRegular(file,limit);
    requireCondition(existing.equals(data), '摘要文件已存在但内容不符：' + file);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const staged = `${file}.${randomUUID()}.stage`;
  const handle = await fs.open(staged,'wx');
  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // A hard link publishes the completed bytes and never replaces an existing
    // digest-named file. The staging link is removed after the final link exists.
    await fs.link(staged,file);
  } finally {
    await fs.unlink(staged).catch(() => {});
  }
}

async function replace({style,filename,root,apply}) {
  const stat = await fs.lstat(root);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), '模型根目录不是普通目录');
  const catalogFile = path.join(root,'catalog.json');
  const initial = await readRegular(catalogFile,catalogLimit);
  const catalog = parseJson(initial);
  const record = catalog.outfits?.[style];
  requireCondition(catalog.schemaVersion === 1 && record && digestPattern.test(record.sha256), '该款式尚未登记新版动作和模型');
  const [currentModel,currentActions,candidate] = await Promise.all([
    readPinned(candidateFile(root,record),record,maxModelBytes),
    readPinned(candidateFile(root,record,true),record.actionPack,actionLimit),
    readRegular(filename,maxModelBytes),
  ]);
  const baseSha = approvedYukinoBases[style];
  const baseEntry = {sha256:baseSha};
  const baseAction = record.sha256 === baseSha ? record.actionPack : record.compatibilityBaseActionPack;
  let baseModel = currentModel, baseActions = currentActions;
  if (record.sha256 !== baseSha) {
    requireCondition(record.compatibilityBaseSha256 === baseSha, '当前版本缺少原始验收摘要，请先从备份恢复');
    const [baseAsset,basePack] = await Promise.all([
      readRegular(candidateFile(root,baseEntry),maxModelBytes),
      readPinned(candidateFile(root,baseEntry,true),baseAction,actionLimit),
    ]);
    requireCondition(sha(baseAsset) === baseSha,'原始验收模型的 SHA-256 不匹配');
    baseModel = baseAsset;
    baseActions = basePack;
    const existingPack = verifyCompatibleVrm(baseModel,currentModel,parseJson(baseActions),style);
    requireCondition(isDeepStrictEqual(existingPack,parseJson(currentActions)), '当前动作与原始动作不一致，请先人工复核');
  }
  const rebound = verifyCompatibleVrm(baseModel,candidate,parseJson(baseActions),style);
  await runtimeWeights(candidate);
  const nextEntry = {sha256:rebound.modelSha256};
  const result = {
    outfit:style, changed:nextEntry.sha256 !== record.sha256, applied:false,
    previousSha256:record.sha256, newSha256:nextEntry.sha256, compatibilityBaseSha256:baseSha,
    model:candidateFile(root,nextEntry), actions:candidateFile(root,nextEntry,true),
    clips:rebound.clips.map(clip => clip.name),
  };
  if (!apply || !result.changed) return result;

  const lock = path.join(root,'.yukino-vrm-replacement.lock');
  const lockHandle = await fs.open(lock,'wx');
  try {
    requireCondition((await readRegular(catalogFile,catalogLimit)).equals(initial), '模型清单已经更改，请重新执行检查');
    const replacingWithBase = nextEntry.sha256 === baseSha;
    const actions = replacingWithBase ? baseActions : encodeActionPack(rebound);
    requireCondition(actions.length <= actionLimit,'重新绑定的动作包超过播放器限制');
    await publishUnchangedFile(result.model,candidate,maxModelBytes);
    await publishUnchangedFile(result.actions,actions,actionLimit);
    const entry = {...record, bytes:candidate.length, sha256:nextEntry.sha256,
      actionPack:{bytes:actions.length,sha256:sha(actions)}};
    if (replacingWithBase) {
      delete entry.compatibilityBaseSha256;
      delete entry.compatibilityBaseActionPack;
    } else {
      entry.compatibilityBaseSha256 = baseSha;
      entry.compatibilityBaseActionPack = baseAction;
    }
    const updated = JSON.stringify({...catalog,outfits:{...catalog.outfits,[style]:entry}},null,2) + '\n';
    requireCondition(Buffer.byteLength(updated) <= catalogLimit,'更新后的清单超过播放器限制');
    result.backupCatalog = path.join(root,`catalog.before-${style}-${randomUUID()}.json`);
    await fs.writeFile(result.backupCatalog,initial,{flag:'wx'});
    requireCondition((await readRegular(catalogFile,catalogLimit)).equals(initial), '模型清单在保存前更改，保留了原清单');
    await writeAtomicJson(fs,catalogFile,updated);
    result.applied = true;
    return result;
  } finally {
    await lockHandle.close();
    await fs.unlink(lock);
  }
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (!options) { console.log(usage); return; }
  console.log(JSON.stringify(await replace(options),null,2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
