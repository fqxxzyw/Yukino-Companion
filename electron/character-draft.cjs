'use strict';

// A draft is an explicit, isolated request: it never touches chat history.
class CharacterDraft {
  constructor({resolve,transport,timeout=90000}) { Object.assign(this,{resolve,transport,timeout}); this.current=null; }
  cancel() { this.current?.abort(); this.current=null; }
  async generate({configId,prompt}={}) {
    if(typeof configId!=='string'||!configId||configId.length>160||typeof prompt!=='string'||!prompt.trim()||prompt.length>6000)throw Error('角色草稿请求无效。');
    if(this.current)throw Error('角色草稿正在生成，请稍候。');
    const controller=new AbortController();this.current=controller;
    const timer=setTimeout(()=>controller.abort(),this.timeout);
    try {
      const settings=await this.resolve(configId);controller.signal.throwIfAborted();
      let text='';
      await this.transport({...settings,messages:[{role:'user',content:prompt}],signal:controller.signal,onToken:part=>{
        if(controller.signal.aborted)return;
        text+=part;if(text.length>6000)throw Error('生成内容超过 6000 字，请调整提示词后重试。');
      }});
      controller.signal.throwIfAborted();text=text.trim();
      if(!text)throw Error('服务未返回角色设定，请重试。');
      return {text};
    } catch(error) {
      if(controller.signal.aborted)throw Error('角色草稿请求已取消或超时。');
      throw error;
    } finally { clearTimeout(timer);if(this.current===controller)this.current=null; }
  }
}
module.exports={CharacterDraft};
