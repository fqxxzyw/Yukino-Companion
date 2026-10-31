// Incremental translation for providers returning Chinese-only text. One
// translation owner, bounded admitted sentences, bounded raw text inbox.
class StreamingTranslation {
  constructor({stream,translate,onText,signal,maxPending=12}){Object.assign(this,{stream,translate,onText,signal,maxPending});this.inbox='';this.queue=[];this.out=[];this.result='';this.total=0;this.final=false;this.flushed=false;this.running=false;this.closed=false;this.error=null;this.completion=new Promise(resolve=>this.resolve=resolve);}
  push(text){if(this.closed||this.final)return;this.total+=text.length;if(this.total>16000)throw Error('流式翻译文本超出上限');this.inbox+=text;this.feed();void this.drain();}
  feed(){while(!this.closed&&this.queue.length<this.maxPending){if(this.out.length){const text=this.out.shift().trim();if(/[\p{L}\p{N}]/u.test(text))this.queue.push(text);continue;}if(this.inbox){const n=this.inbox.codePointAt(0)>0xffff?2:1;this.out.push(...this.stream.push(this.inbox.slice(0,n)));this.inbox=this.inbox.slice(n);continue;}if(this.final&&!this.flushed){this.flushed=true;this.out.push(...this.stream.push('',true));continue;}break;}}
  async drain(){if(this.running||this.closed)return;this.running=true;try{this.feed();while(this.queue.length){this.signal?.throwIfAborted();const text=this.queue.shift(),reply=await this.translate(text);this.signal?.throwIfAborted();if(typeof reply?.text!=='string'||!/[ぁ-ゖァ-ヺ]/u.test(reply.text))throw Error('流式翻译未返回可确认的日语');this.result+=reply.text;this.onText(reply.text);this.feed();}if(this.final&&this.flushed&&!this.inbox&&!this.out.length){this.closed=true;this.resolve({text:this.result});}}catch(error){this.closed=true;this.error=error;this.queue.length=0;this.out.length=0;this.inbox='';this.resolve({text:this.result,error});}finally{this.running=false;}}
  async finish(){if(!this.closed){this.final=true;this.feed();void this.drain();}return this.completion;}
  cancel(){this.closed=true;this.inbox='';this.queue.length=0;this.out.length=0;this.resolve({text:this.result,error:Error('流式翻译已取消')});}
}
async function createStreamingTranslation(options){const {SmartSentenceStream}=await import('../src/speech/segmenter.mjs');return new StreamingTranslation({stream:new SmartSentenceStream({language:'zh'}),...options});}
module.exports={StreamingTranslation,createStreamingTranslation};
