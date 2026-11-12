// Exercise the real App message and scroll behavior without GPU or provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

let preload=await fs.readFile(new URL('../scripts/ui-capture/preload.cjs',import.meta.url),'utf8');
preload=preload.replace("const {contextBridge} = require('electron');","const contextBridge={exposeInMainWorld:(name,value)=>window[name]=value};");
preload=preload.replace('let state={',"let state={presentation:{scene:'classroom',sceneEnabled:true,spread:true,gaze:false,wallpaper:{enabled:false,items:[]}},");
preload=preload.replace("setupDismissedVersion:''","setupDismissedVersion:'0.4.0-base.1'");
preload=preload.replace('activeConversation:null,personaEnabled',"activeConversation:'qa-conversation',personaEnabled");
preload=preload.replace("{id:'qa-assistant',role:'assistant',content:zh,zh,ja,status:'done',translationStatus:'ready',source:'api'},", "{id:'qa-assistant',role:'assistant',content:'旧回复',zh:'旧回复',status:'done'}, {id:'qa-user-2',role:'user',content:'第二个问题'}, {id:'qa-assistant-2',role:'assistant',content:'最新回复开头。'+('长回复内容。'.repeat(140)),status:'done'},");
preload=preload.replace("const qaCalls={help:[],install:[],cancel:0};", "const qaCalls={help:[],install:[],cancel:0}; let releaseReply,activeReply;");
preload=preload.replace("send:async request=>{emit('chunk',{id:request.id,text:zh});return{ok:true,bilingual:{zh,ja,translationStatus:'ready',source:request.mode==='local'?'local':'api'}};}","send:async request=>{activeReply=request.id;return await new Promise(resolve=>releaseReply=resolve);},qaReady:()=>Boolean(activeReply),qaChunk:text=>emit('chunk',{id:activeReply,text}),qaFinish:text=>{const finish=releaseReply;activeReply=null;releaseReply=null;finish({ok:true,bilingual:{zh:text,ja,translationStatus:'ready',source:'api'}});}");

const stubs={
 'SceneBackdrop.jsx':"export default function SceneBackdrop(){return null}",
 'BlackboardOverlay.jsx':"export default function BlackboardOverlay(){return null}",
 'CharacterPanel.jsx':`import React from 'react';export default function CharacterPanel({presentation,onPresentationChange}){return React.createElement('button',{'data-testid':'toggle-spread',onClick:()=>onPresentationChange({...presentation,spread:!presentation.spread})},'切换展开场景')}`,
};
const fixture=await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},logLevel:'error',plugins:[{name:'scene-message-browser-stubs',enforce:'pre',load(id){const key=Object.keys(stubs).find(name=>id.endsWith('/src/ui/'+name)||id.endsWith('\\src\\ui\\'+name));return key?stubs[key]:null;}},react()],build:{write:false,lib:{entry:fileURLToPath(new URL('./scene-messages-fixture.jsx',import.meta.url)),name:'SceneMessagesFixture',formats:['iife']},rollupOptions:{output:{inlineDynamicImports:true}}}});
const output=(Array.isArray(fixture)?fixture[0]:fixture).output;
const js=output.find(item=>item.type==='chunk').code;
const css=output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>String(item.source)).join('\n');
let browser;
try{
 let executablePath;
 for(const file of [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'])if(file&&await fs.access(file).then(()=>true,()=>false)){executablePath=file;break;}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const context=await browser.newContext({viewport:{width:1200,height:720}});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setContent('<!doctype html><div id="root"></div>');
 await page.addStyleTag({content:css});await page.addScriptTag({content:"if(!crypto.randomUUID){let id=0;crypto.randomUUID=()=>`fixture-${++id}`;}"});await page.addScriptTag({content:preload});await page.addScriptTag({content:js});
 await page.waitForSelector('.app.scene-city .chat-scroll',{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('.messages')?.textContent.includes('最新回复开头'));
 const messages=page.locator('.messages > .message');
 const questions=page.locator('.messages > .message.user');
 const chatScroll=page.locator('.chat-scroll');
 assert.equal(await messages.count(),4);
 assert.equal(await questions.last().innerText(),'第二个问题');
 assert.match(await messages.nth(1).innerText(),/旧回复/);
 assert.ok(await chatScroll.evaluate(el=>el.scrollTop)>0,'opening the conversation shows the latest turn');
 await page.locator('[data-testid="toggle-spread"]').click();
 await page.waitForFunction(()=>!document.querySelector('.app.scene-city'));
 assert.equal(await messages.count(),4,'all prior messages remain in regular chat');
 await page.locator('[data-testid="toggle-spread"]').click();
 await page.waitForSelector('.app.scene-city');
 await page.getByRole('textbox',{name:'消息',exact:true}).fill('新问题');
 await page.getByRole('button',{name:'发送消息',exact:true}).click();
 try{await page.waitForFunction(()=>window.desktop.qaReady(),null,{timeout:5000});}catch(error){console.error('Reply did not start:',{draft:await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),errors,body:(await page.locator('body').innerText()).slice(-400)});throw error;}
 await questions.last().filter({hasText:'新问题'}).waitFor();
 assert.equal(await messages.count(),6,'sending a message retains the two earlier exchanges');
 assert.match(await messages.nth(3).innerText(),/最新回复开头/);
 assert.ok(await questions.last().evaluate(el=>{
  const question=el.getBoundingClientRect(),viewport=el.closest('.chat-scroll').getBoundingClientRect();
  return question.top>=viewport.top&&question.bottom<=viewport.bottom;
 }),'show the sent question before the first reply chunk');
 const turnScroll=await chatScroll.evaluate(el=>el.scrollTop);
 await page.evaluate(()=>window.desktop.qaChunk('新回复第一句。'+('持续增长的内容。'.repeat(140))));
 await page.waitForFunction(()=>document.querySelector('.messages')?.textContent.includes('新回复第一句'));
 assert.equal(await messages.count(),6);
 assert.equal(await chatScroll.evaluate(el=>el.scrollTop),turnScroll,'streaming leaves the viewport at the new turn');
 await page.evaluate(()=>window.desktop.qaFinish('新回复第一句。已完成。'));
 await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'消息',exact:true}).fill('下一条问题');
 await page.getByRole('button',{name:'发送消息',exact:true}).click();
 await page.waitForFunction(()=>window.desktop.qaReady());
 await questions.last().filter({hasText:'下一条问题'}).waitFor();
 assert.equal(await messages.count(),8,'the newly completed turn remains after sending again');
 assert.equal(await questions.nth(2).innerText(),'新问题');
 assert.match(await messages.nth(5).innerText(),/新回复第一句/);
 assert.deepEqual(errors,[]);
 console.log('PASS actual App retains prior turns after consecutive sends and keeps scrolling steady during a reply');
 await context.close();
}finally{await browser?.close();}
