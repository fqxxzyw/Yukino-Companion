'use strict';
// Numeric playback state only. No audio bytes, transcript, profile or API key.
function speechSnapshot(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('语音时钟无效');
 for(const key of ['sequence','token'])if(!Number.isSafeInteger(value[key])||value[key]<0)throw Error('语音时钟序号无效');
 if(typeof value.characterId!=='string'||!value.characterId||value.characterId.length>120)throw Error('语音角色无效');
 if(typeof value.playing!=='boolean'||typeof value.paused!=='boolean')throw Error('语音播放状态无效');
 for(const [key,max]of [['clockSeconds',1e10],['elapsedSeconds',3600],['durationSeconds',3600],['level',1]])if(!Number.isFinite(value[key])||value[key]<0||value[key]>max)throw Error('语音时钟范围无效');
 if(value.elapsedSeconds>value.durationSeconds||!['neutral','question','explain','greeting','clarify'].includes(value.hint))throw Error('语音时钟内容无效');
 return {sequence:value.sequence,characterId:value.characterId,token:value.token,clockSeconds:value.clockSeconds,playing:value.playing,paused:value.paused,elapsedSeconds:value.elapsedSeconds,durationSeconds:value.durationSeconds,level:value.playing&&!value.paused?value.level:0,hint:value.hint};
}
module.exports={speechSnapshot};
