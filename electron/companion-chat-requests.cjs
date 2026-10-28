const {randomUUID}=require('node:crypto');
class CompanionChatRequests{
 constructor({dispatch,setTimer=setTimeout,clearTimer=clearTimeout}){Object.assign(this,{dispatch,setTimer,clearTimer});this.pending=new Map();}
 submit(text){const requestId=randomUUID();return new Promise((resolve,reject)=>{const timer=this.setTimer(()=>{this.pending.delete(requestId);reject(Error('聊天尚未准备好，请打开主窗口检查设置；输入已保留。'));},5000);this.pending.set(requestId,{resolve,reject,timer});try{this.dispatch({requestId,text});}catch(error){this.ack({requestId,accepted:false,error:error.message});}});}
 ack({requestId,accepted,error}={}){const row=this.pending.get(requestId);if(!row)return false;this.pending.delete(requestId);this.clearTimer(row.timer);if(accepted===true)row.resolve(true);else row.reject(Error(typeof error==='string'?error.slice(0,400):'消息未发送，输入已保留。'));return true;}
 cancel(error='聊天窗口已停止，请重新打开主窗口。'){for(const id of [...this.pending.keys()])this.ack({requestId:id,accepted:false,error});}
}
module.exports={CompanionChatRequests};
