// The UI's synthesizing/playing label is not a source of audio truth. In
// particular, React may batch labels across an async decode/next sentence.
export class SpeechSnapshotRelay {
 constructor({player,send,characterId,nextSequence}){Object.assign(this,{player,send,characterId,nextSequence});this.pending=false;this.disposed=false;this.lastIdle='';}
 tick(){
  if(this.disposed||this.pending)return;
  const snapshot=this.player.getSnapshot(),characterId=this.characterId(),idleKey=characterId+':'+snapshot.token;
  if(!snapshot.playing&&this.lastIdle===idleKey)return;
  this.lastIdle=snapshot.playing?'':idleKey;this.pending=true;
  Promise.resolve().then(()=>this.disposed?undefined:this.send({...snapshot,sequence:this.nextSequence(),characterId})).catch(()=>{this.lastIdle='';}).finally(()=>{this.pending=false});
 }
 dispose(){if(this.disposed)return;this.disposed=true;const snapshot=this.player.getSnapshot(),payload={...snapshot,playing:false,paused:false,level:0,sequence:this.nextSequence(),characterId:this.characterId()};return Promise.resolve().then(()=>this.send(payload)).catch(()=>{});}
}
