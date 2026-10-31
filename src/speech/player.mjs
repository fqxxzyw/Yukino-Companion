const HINTS = new Set(['neutral', 'question', 'explain', 'greeting', 'clarify']);
export class AudioPlayer {
  constructor() { this.volume = 0.8; this.epoch = 0; }
  unlock() {
    this.context ||= new AudioContext();
    this.gain ||= this.context.createGain();
    if (!this.connected) { this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;this.samples=new Uint8Array(this.analyser.fftSize);this.gain.connect(this.analyser);this.analyser.connect(this.context.destination); this.connected = true; }
    this.gain.gain.value = this.volume;
    return this.context.resume();
  }
  getLevel() { if(!this.source||!this.analyser||this.context?.state!=='running')return 0;this.analyser.getByteTimeDomainData(this.samples);let sum=0;for(const sample of this.samples)sum+=((sample-128)/128)**2;return Math.min(1,Math.sqrt(sum/this.samples.length)*5); }
  // Never use wall time to advance a gesture. AudioContext time freezes when
  // suspended; the record exists only after the actual source has started.
  getSnapshot() {
    const record=this.playback;
    if(!record||!this.source)return {token:this.lastStartedToken||0,clockSeconds:this.context?.currentTime||0,playing:false,paused:false,elapsedSeconds:0,durationSeconds:0,level:0,hint:'neutral'};
    const elapsedSeconds=Math.max(0,Math.min(record.durationSeconds,this.context.currentTime-record.startedAt));
    const playing=elapsedSeconds<record.durationSeconds,paused=this.context.state!=='running';
    return {token:record.token,clockSeconds:this.context.currentTime,playing,paused,elapsedSeconds,durationSeconds:record.durationSeconds,level:playing&&!paused?this.getLevel():0,hint:record.hint,text:record.text,sequence:record.sequence,requestId:record.requestId};
  }
  setVolume(value) { this.volume = value; if (this.gain) this.gain.gain.value = value; }
  async prepare(bytes) {
    await this.unlock();
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    if(data.byteLength>32*1024*1024)throw Error('播放音频超过大小限制');
    const buffer=await this.context.decodeAudioData(data.slice().buffer);
    if(!Number.isFinite(buffer.duration)||buffer.duration<=0)throw Error('音频时长无效');
    const prepared={buffer,duration:buffer.duration};(this.prepared ||= new WeakSet()).add(prepared);return prepared;
  }
  async play(bytes,{hint='neutral',onStarted=()=>{},text='',sequence=null,requestId=null}={}) {
    this.stop();const epoch=this.epoch;
    const prepared=this.prepared?.has(bytes)?bytes:await this.prepare(bytes);
    await this.unlock();
    if(epoch!==this.epoch)return;
    const audio=prepared.buffer;
    const source = this.context.createBufferSource(); source.buffer = audio; source.connect(this.gain); this.source = source;
    await new Promise((resolve, reject) => {
      this.resolve = resolve;
      source.onended = () => { source.disconnect(); if (this.source === source) { this.source = null; this.playback=null; this.resolve = null; } resolve(); };
      try { const startedAt=this.context.currentTime;source.start();this.lastStartedToken=epoch;this.playback={token:epoch,startedAt,durationSeconds:audio.duration,hint:HINTS.has(hint)?hint:'neutral',text,sequence,requestId};onStarted({clockSeconds:startedAt,durationSeconds:audio.duration}); }
      catch (e) { source.disconnect(); if(this.source===source){this.source=null;this.playback=null;this.resolve=null;}reject(e); }
    });
  }
  stop() { this.epoch++;const source=this.source,resolve=this.resolve;this.source=null;this.playback=null;this.resolve=null;if(source){try{source.stop()}catch{}source.disconnect();}resolve?.(); }
  dispose() { this.stop(); void this.context?.close(); }
}
