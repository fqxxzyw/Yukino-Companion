const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// No plaintext text, model path or reference transcript is persisted. Include
// file identity as well as settings so replacing a voice at the same path cannot
// reuse the old sound. Missing resources disable reuse, not ordinary synthesis.
async function speechCacheKey(config, texts, script) {
  const files = [config.python, config.gpt, config.sovits, config.reference, script,
    path.join(config.root, 'GPT_SoVITS/TTS_infer_pack/TTS.py'),
    ...['config.json','pytorch_model.bin','tokenizer.json'].map(file => path.join(config.bert, file)),
    ...['config.json','pytorch_model.bin','preprocessor_config.json'].map(file => path.join(config.hubert, file))];
  if (config.ffmpeg) files.push(config.ffmpeg);
  if(config.engine==='aqua'){
    files.push(path.join(path.dirname(script),'aqua_adapter.py'));
    for(const key of ['aquaSovitsBase','aquaSpeaker'])if(config[key])files.push(config[key]);
    // V3 folder identities are not enough to prove unchanged weights; disable
    // disk reuse rather than serve sound from an unknown vocoder identity.
    if(config.version==='v3')return null;
  }
  try {
    const identities = await Promise.all(files.map(async file => {
      if (!file || !path.isAbsolute(file)) throw Error('missing resource');
      const stat = await fs.stat(file, { bigint: true });
      if (!stat.isFile()) throw Error('not a file');
      return [path.resolve(file), ...['dev','ino','size','mtimeNs','ctimeNs'].map(field => String(stat[field]))];
    }));
    const sound = Object.fromEntries(['engine','engineVersion','aquaGraph','aquaSovitsBase','aquaBigvgan','aquaSpeaker','aquaLangdetect','root','bert','hubert','version','promptText','promptLang','textLang','speed','device','half','cpuFallback','cpuThreads'].map(field => [field, config[field]]));
    return createHash('sha256').update(JSON.stringify({schema:2,texts,sound,identities})).digest('hex');
  } catch { return null; }
}
module.exports = { speechCacheKey };
