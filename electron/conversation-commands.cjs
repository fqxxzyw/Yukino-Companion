'use strict';

// Only direct, bounded user utterances can control the application. History,
// quoted examples and model replies never enter this parser.
function parseConversationCommand(text){
 if(typeof text!=='string'||text.length>160||/[\r\n`"'“”‘’「」『』《》]/u.test(text))return null;
 let value=text.normalize('NFKC').trim().replace(/[。.!！?？,，、\s]+$/gu,'');
 value=value.replace(/^(?:雪之下雪乃|雪乃|雪之下)[,，、\s]*/u,'').replace(/^(?:(?:请|麻烦)(?:你)?[,，、\s]*)?(?:你)?(?:能不能|能否|可不可以|可以|能)?(?:帮我|帮忙)?[,，、\s]*/u,'');
 for(let i=0;i<3;i++)value=value.replace(/(?:一下|好吗|好不好|可以吗|吗|吧|谢谢)$/u,'').trim();
 const camera='(?:摄像头|相机)',tail='(?:一下)?';
 if(new RegExp(`^(?:隐藏|收起|不显示|不要显示|关闭)${camera}(?:的)?(?:预览|画面|预览窗口|画面窗口|窗口)${tail}$`,'u').test(value))return {action:'camera-preview-hide'};
 if(new RegExp(`^(?:显示|恢复|展开|打开)${camera}(?:的)?(?:预览|画面|预览窗口|画面窗口|窗口)${tail}$`,'u').test(value))return {action:'camera-preview-show'};
 if(new RegExp(`^(?:关闭|关掉|停用|停止)(?:一下)?${camera}${tail}$`,'u').test(value)||new RegExp(`^把${camera}(?:给)?(?:关闭|关掉|停用|停止)${tail}$`,'u').test(value)||/^(?:别看了|不要再看了|停止观察|停止摄像头观察)$/u.test(value))return {action:'camera-stop'};
 if(new RegExp(`^(?:打开|开启|启动)(?:一下)?${camera}${tail}$`,'u').test(value)||/^(?:看看|看一下|看一看|瞧瞧)我(?:现在|正在)?(?:在)?(?:干什么|做什么|忙什么)$/u.test(value))return {action:'camera-start'};
 return null;
}

async function executeConversationCommand(text,{visual,owner,kind='main',onReply=()=>{}}={}){
 const command=parseConversationCommand(text);if(!command)return {handled:false};
 if(!visual)throw Error('摄像头服务尚未准备好，请稍后重试。');
 let reply;
 if(command.action==='camera-start'){
  if(!owner||owner.isDestroyed()||!owner.isVisible()||owner.isMinimized?.())throw Error('请先显示聊天或陪伴窗口，再开启摄像头。');
  if(await visual.open(owner,kind,{mode:'camera',autoStart:true,prompt:text.trim()})===false)throw Error('摄像头面板未能打开，请重试。');
  reply='已打开摄像头面板，正在开启本机预览。需要识别画面时，请在面板中允许发送。';
 }else if(command.action==='camera-stop'){
  visual.stop();reply='已停止摄像头和画面识别。';
 }else{
  const visible=command.action==='camera-preview-show';
  if(await visual.setPreviewVisible(visible)===false)throw Error('请先开启摄像头，再调整画面预览。');
  reply=visible?'已显示摄像头画面。':'已隐藏摄像头画面，摄像头仍保持开启。';
 }
 const bilingual={zh:reply,ja:'',translationStatus:'skipped',source:'command'};onReply(bilingual);
 return {handled:true,command:command.action,bilingual};
}
module.exports={parseConversationCommand,executeConversationCommand};
