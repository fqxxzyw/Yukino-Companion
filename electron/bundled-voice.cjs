const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DEFAULTS, validateSettings } = require('./speech.cjs');
const defaultReference=require('../resources/voice-presets/yukino-default.json');

async function exists(filename, directory=false) {
  try {const stat=await fs.stat(filename);return directory?stat.isDirectory():stat.isFile();}catch{return false;}
}
function resourcePath(root, relative) {
  if(typeof relative!=='string'||relative.includes('\\')||path.isAbsolute(relative)||relative.split('/').some(x=>!x||x==='..'||x==='.'))throw Error('内置音色资源路径无效');
  const resolved=path.resolve(root,relative);
  if(!resolved.startsWith(path.resolve(root)+path.sep))throw Error('内置音色资源路径越界');
  return resolved;
}
async function readVoicePreset(resourceRoot) {
  const root=path.join(resourceRoot,'voice-models');
  let manifest;
  try{manifest=JSON.parse(await fs.readFile(path.join(root,'preset.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(manifest.schemaVersion!==1||typeof manifest.promptText!=='string'||!manifest.promptText.trim()||!['ja','all_ja'].includes(manifest.promptLang)||!Array.isArray(manifest.files))throw Error('内置音色预设清单无效');
  const selected={};
  for(const kind of ['gpt','sovits','reference']) {
    const item=manifest.files.find(file=>file.kind===kind);
    if(!item||!Number.isSafeInteger(item.bytes)||item.bytes<=0||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('内置音色文件记录不完整');
    const filename=resourcePath(root,item.path),stat=await fs.stat(filename);
    if(!stat.isFile()||stat.size!==item.bytes)throw Error(`内置音色资源不完整：${kind}`);
    // Large checkpoint hashes are checked during packaging. Verify the small
    // reference here as well so stale audio cannot be paired with a transcript.
    if(kind==='reference'&&createHash('sha256').update(await fs.readFile(filename)).digest('hex')!==item.sha256)throw Error('内置参考音频校验失败');
    selected[kind]=filename;
  }
  return { ...selected, version:manifest.version, promptText:manifest.promptText,promptLang:manifest.promptLang,
    metadata:{id:manifest.id,label:manifest.label,packId:manifest.packId,durationSeconds:manifest.durationSeconds,
      referenceSource:manifest.referenceSource,transcriptVerification:manifest.transcriptVerification,ready:true} };
}

async function bundledVoiceDefaults({ resourceRoot, dataRoot, legacyDataRoot, runtimeRoot }) {
  const candidates=[runtimeRoot,resourceRoot,path.join(dataRoot,'runtime','current')].filter(Boolean);
  const result={...DEFAULTS};
  const engine=(await Promise.all(candidates.map(async root=>{const item=path.join(root,'inference-engine');return await exists(path.join(item,'yukino-runtime.json'))?item:null;}))).find(Boolean);
  if(engine) {
    const manifest=JSON.parse(await fs.readFile(path.join(engine,'yukino-runtime.json'),'utf8'));
    if(!/^[a-f0-9]{40}$/.test(manifest.revision))throw Error('推理组件清单版本无效');
    // Upstream writes pronunciation caches; keep packaged or downloaded source
    // read-only and use a private copy. Checkpoints are referenced in place.
    const installed=path.join(dataRoot,'speech-engine',manifest.revision),marker=path.join(installed,'.installed');
    if(await exists(marker)) result.root=installed;
    else {
      try{
        await fs.mkdir(installed,{recursive:true});await fs.cp(engine,installed,{recursive:true,force:true});
        await fs.writeFile(marker,manifest.revision);result.root=installed;
      }catch(error){if(!['EACCES','EPERM','EROFS'].includes(error.code))throw error;}
    }
  }
  for(const candidate of candidates) {
    const runtime=path.join(candidate,'python-runtime');
    if(!result.python&&await exists(path.join(runtime,'python.exe')))result.python=path.join(runtime,'python.exe');
    if(!result.ffmpeg&&await exists(path.join(runtime,'ffmpeg.exe')))result.ffmpeg=path.join(runtime,'ffmpeg.exe');
  }
  // Voice weights belong to the app, not an engine revision. Keeping this
  // directory stable lets downloads start while the runtime is installing.
  // Existing explicitly saved BERT/HuBERT paths continue to be honored.
  const pretrained=path.join(dataRoot,'speech-models');
  result.bert=path.join(pretrained,'chinese-roberta-wwm-ext-large');result.hubert=path.join(pretrained,'chinese-hubert-base');
  const preset=await readVoicePreset(resourceRoot);
  if(preset){for(const key of ['gpt','sovits','reference','version','promptLang'])result[key]=preset[key];result.promptText='';}
  else {
    // The small verified reference is shipped with the base app independently of
    // the optional downloaded GPT/SoVITS weights. Never copy the user's weights.
    const reference=path.join(resourceRoot,'voice-presets',defaultReference.reference.sourcePath);
    try{const bytes=await fs.readFile(reference);if(bytes.length===defaultReference.reference.bytes&&createHash('sha256').update(bytes).digest('hex')===defaultReference.reference.sha256){result.reference=reference;result.promptLang=defaultReference.promptLang;result.promptText='';}}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {defaults:result,modelRoot:pretrained,bundled:Boolean(result.root&&result.python),preset:preset?.metadata||null};
}

function mergeVoiceDefaults(saved={}, bundle) {
  const defaults=bundle.defaults||bundle,config={...DEFAULTS,...saved};
  for(const key of ['root','python','ffmpeg','bert','hubert'])if(!config[key])config[key]=defaults[key]||'';
  // A custom pair or reference is a single configuration unit. Never mix half
  // a user's pair with a preset, and never replace a custom transcript.
  if(!saved.gpt&&!saved.sovits){config.gpt=defaults.gpt||'';config.sovits=defaults.sovits||'';config.version=defaults.version||config.version;}
  if(!saved.reference&&!String(saved.promptText||'').trim()){
    config.reference=defaults.reference||'';config.promptText=defaults.promptText||'';config.promptLang=defaults.promptLang||config.promptLang;
  }
  return validateSettings(config);
}
module.exports={bundledVoiceDefaults,mergeVoiceDefaults,readVoicePreset,resourcePath};
