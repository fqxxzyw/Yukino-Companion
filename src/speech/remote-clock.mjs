// This receiver never extrapolates a remote AudioContext clock from Date.now or
// requestAnimationFrame. Wall time is used only to stop stale IPC/audio state.
export class RemoteSpeechClock {
  constructor(now=()=>performance.now()){this.now=now;this.clear();}
  clear(){this.snapshot=null;this.receivedAt=0;this.sequence=-1;}
  receive(value){if(!value||!Number.isSafeInteger(value.sequence)||value.sequence<=this.sequence)return false;this.sequence=value.sequence;this.snapshot=value;this.receivedAt=this.now();return true;}
  getSnapshot(){const value=this.snapshot,age=this.now()-this.receivedAt;if(!value||age>2000)return {token:value?.token||0,clockSeconds:value?.clockSeconds||0,playing:false,paused:false,elapsedSeconds:0,durationSeconds:0,level:0,hint:'neutral'};return age>250?{...value,paused:true,level:0}:value;}
  getLevel(){const value=this.getSnapshot();return value.playing&&!value.paused?value.level:0;}
}
