const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {inspectReferenceAudio,referenceAudioMetadata,MAX_REFERENCE_BYTES}=require('../electron/voice-reference.cjs');

function wav(seconds=3,{channels=1,sampleRate=16000}={}){
  const blockAlign=channels*2,size=Math.round(seconds*sampleRate)*blockAlign,bytes=Buffer.alloc(44+size+(size&1));
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(channels,22);bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*blockAlign,28);bytes.writeUInt16LE(blockAlign,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(size,40);
  return bytes;
}
function flac(seconds=3){
  const sampleRate=48000,totalSamples=seconds*sampleRate,bytes=Buffer.alloc(44);bytes.write('fLaC');bytes[4]=0x80;bytes.writeUIntBE(34,5,3);bytes.writeUInt16BE(4096,8);bytes.writeUInt16BE(4096,10);
  bytes.writeBigUInt64BE((BigInt(sampleRate)<<44n)|(1n<<41n)|(15n<<36n)|BigInt(totalSamples),18);bytes[42]=0xff;bytes[43]=0xf8;return bytes;
}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-reference-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('WAV inspection returns actual duration and bounded preview only for an authorized local file',async t=>{
  const root=await fixture(t),filename=path.join(root,'selected.wav'),bytes=wav(3.5,{channels:2});await fs.writeFile(filename,bytes);
  await assert.rejects(inspectReferenceAudio({filename}),/先选择并保存/);
  const result=await inspectReferenceAudio({filename,allowedPaths:[filename],includeAudio:true});
  assert.equal(result.readable,true);assert.equal(result.validDuration,true);assert.equal(result.durationSeconds,3.5);assert.equal(result.sampleRate,16000);assert.equal(result.channels,2);assert.equal(result.playbackVerified,false);assert.deepEqual(Buffer.from(result.preview.base64,'base64'),bytes);
  assert.equal((await inspectReferenceAudio({filename,allowedPaths:[filename]})).preview,undefined);
});

test('reference duration boundaries are inclusive and do not report short or long clips as suitable',async t=>{
  const root=await fixture(t),filename=path.join(root,'reference.wav');
  for(const [seconds,expected] of [[2.9,false],[3,true],[10,true],[10.1,false]]){
    await fs.writeFile(filename,wav(seconds));const result=await inspectReferenceAudio({filename,allowedPaths:[filename]});assert.equal(result.validDuration,expected,String(seconds));assert.equal(result.usable,expected);
  }
});

test('WAV validation rejects truncated containers, invalid byte rates and unsupported formats',()=>{
  const truncated=wav();assert.throws(()=>referenceAudioMetadata(truncated.subarray(0,truncated.length-1)),/不完整/);
  const badRate=wav();badRate.writeUInt32LE(1,28);assert.throws(()=>referenceAudioMetadata(badRate),/编码参数/);
  const compressed=wav();compressed.writeUInt16LE(6,20);assert.throws(()=>referenceAudioMetadata(compressed),/编码参数/);
  const headerOnly=wav(0);assert.throws(()=>referenceAudioMetadata(headerOnly),/音频数据不完整/);
  assert.throws(()=>referenceAudioMetadata(Buffer.from('not audio')),/仅支持/);
});

test('FLAC STREAMINFO is checked without claiming that metadata validation is playback',async t=>{
  const root=await fixture(t),filename=path.join(root,'selected.flac'),bytes=flac(4);await fs.writeFile(filename,bytes);
  const result=await inspectReferenceAudio({filename,allowedPaths:[filename]});assert.equal(result.format,'flac');assert.equal(result.durationSeconds,4);assert.equal(result.channels,2);assert.equal(result.bitsPerSample,16);assert.equal(result.playbackVerified,false);
  assert.throws(()=>referenceAudioMetadata(bytes.subarray(0,42)),/帧缺失/);
  const bad=Buffer.from(bytes);bad.writeUIntBE(33,5,3);assert.throws(()=>referenceAudioMetadata(bad),/STREAMINFO/);
});

test('unreadable locations, directories, symlinks and oversized files never become previews',async t=>{
  const root=await fixture(t),filename=path.join(root,'missing.wav');
  await assert.rejects(inspectReferenceAudio({filename,allowedPaths:[filename]}),/不存在/);
  await assert.rejects(inspectReferenceAudio({filename:root,allowedPaths:[root]}),/普通音频文件/);
  await fs.writeFile(filename,wav());const link=path.join(root,'linked.wav');
  try{await fs.symlink(filename,link);await assert.rejects(inspectReferenceAudio({filename:link,allowedPaths:[link]}),/链接或目录/);}catch(error){if(!['EPERM','EACCES','ENOSYS'].includes(error.code))throw error;}
  const huge=path.join(root,'huge.wav'),handle=await fs.open(huge,'w');await handle.truncate(MAX_REFERENCE_BYTES+1);await handle.close();
  await assert.rejects(inspectReferenceAudio({filename:huge,allowedPaths:[huge],includeAudio:true}),/过大/);
});
