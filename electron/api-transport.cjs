'use strict';
const {chat}=require('./chat.cjs');

// Chromium networking honors the desktop's proxy/PAC configuration. All
// production conversation, translation, and vision requests use this adapter.
function createSystemProxyChat(net){
  if(typeof net?.fetch!=='function')throw Error('API 网络服务尚未准备好。');
  return options=>chat({...options,fetcher:(url,init)=>net.fetch(url,init)});
}
module.exports={createSystemProxyChat};
