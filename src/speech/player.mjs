export class AudioPlayer {
  constructor() { this.volume = 0.8; this.epoch = 0; }
  unlock() {
    this.context ||= new AudioContext();
    this.gain ||= this.context.createGain();
    if (!this.connected) { this.gain.connect(this.context.destination); this.connected = true; }
    this.gain.gain.value = this.volume;
    return this.context.resume();
  }
  setVolume(value) { this.volume = value; if (this.gain) this.gain.gain.value = value; }
  async play(bytes) {
    const epoch = this.epoch;
    await this.unlock();
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const audio = await this.context.decodeAudioData(data.slice().buffer);
    if (epoch !== this.epoch) return;
    const source = this.context.createBufferSource(); source.buffer = audio; source.connect(this.gain); this.source = source;
    await new Promise((resolve, reject) => {
      this.resolve = resolve;
      source.onended = () => { source.disconnect(); if (this.source === source) { this.source = null; this.resolve = null; } resolve(); };
      try { source.start(); } catch (e) { source.disconnect(); this.source = null; this.resolve = null; reject(e); }
    });
  }
  stop() { this.epoch++; if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; } this.resolve?.(); this.resolve = null; }
  dispose() { this.stop(); void this.context?.close(); }
}
