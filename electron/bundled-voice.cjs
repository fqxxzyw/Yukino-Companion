const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULTS } = require('./speech.cjs');

async function bundledVoiceDefaults({ resourceRoot, dataRoot }) {
  const engine=path.join(resourceRoot,'inference-engine');
  const runtime=path.join(resourceRoot,'python-runtime');
  const result={...DEFAULTS};
  try {
    const manifest=JSON.parse(await fs.readFile(path.join(engine,'yukino-runtime.json'),'utf8'));
    if(!/^[a-f0-9]{40}$/.test(manifest.revision))throw Error('推理组件清单版本无效');
    // Upstream creates lexicon caches. Keep packaged source read-only and deploy
    // a private writable copy; trained weights remain referenced in place.
    const installed=path.join(dataRoot,'speech-engine',manifest.revision);
    const marker=path.join(installed,'.installed');
    try{await fs.access(marker)}catch{
      await fs.mkdir(installed,{recursive:true});
      await fs.cp(engine,installed,{recursive:true,force:true});
      await fs.writeFile(marker,manifest.revision);
    }
    result.root=installed;
  }catch(e){if(e.code!=='ENOENT')throw e}
  try{await fs.access(path.join(runtime,'python.exe'));result.python=path.join(runtime,'python.exe')}catch{}
  try{await fs.access(path.join(runtime,'ffmpeg.exe'));result.ffmpeg=path.join(runtime,'ffmpeg.exe')}catch{}
  const pretrained=result.root?path.join(result.root,'GPT_SoVITS','pretrained_models'):path.join(dataRoot,'speech-models');
  result.bert=path.join(pretrained,'chinese-roberta-wwm-ext-large');
  result.hubert=path.join(pretrained,'chinese-hubert-base');
  return { defaults:result, modelRoot:pretrained, bundled:Boolean(result.root&&result.python) };
}
module.exports={bundledVoiceDefaults};
