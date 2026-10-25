import { SentenceStream, JapaneseSentenceStream } from './text.mjs';

// Provider independent: feed only assistant content from any remote/local LLM.
export class SpeechSession {
  constructor({ bridge, player, onState = () => {}, japaneseOnly = false }) {
    Object.assign(this, { bridge, player, onState, japaneseOnly }); this.current = null;
  }
  start(id) {
    this.cancel();
    const job = { id, stream: this.japaneseOnly ? new JapaneseSentenceStream() : new SentenceStream(), queue: [], final: false, running: false, count: 0 };
    this.current = job;
    job.ready = Promise.resolve(this.bridge.begin(id));
    job.ready.catch(e => { if (this.current === job) this.fail(job, e); });
    this.onState({ phase: 'waiting', id });
  }
  push(text) {
    const job = this.current; if (!job || job.final) return;
    try { this.enqueue(job, job.stream.push(text)); } catch (e) { this.fail(job, e); }
  }
  finish() {
    const job = this.current; if (!job || job.final) return;
    try { job.final = true; this.enqueue(job, job.stream.push('', true)); } catch (e) { this.fail(job, e); }
  }
  enqueue(job, segments) {
    job.count += segments.reduce((n, s) => n + s.length, 0);
    if (job.queue.length + segments.length > 64 || job.count > 16000) throw Error('语音积压过多，已停止朗读；文字不受影响。');
    job.queue.push(...segments); void this.drain(job);
  }
  async drain(job) {
    if (job.running || this.current !== job) return;
    job.running = true;
    try {
      await job.ready;
      while (this.current === job && job.queue.length) {
        this.onState({ phase: 'synthesizing', id: job.id, pending: job.queue.length });
        const audio = await this.bridge.synthesize(job.id, job.queue.shift());
        if (this.current !== job) return;
        this.onState({ phase: 'playing', id: job.id, pending: job.queue.length });
        await this.player.play(audio);
      }
      if (this.current === job) {
        this.onState({ phase: job.final ? 'idle' : 'waiting', id: job.id });
        if (job.final) this.current = null;
      }
    } catch (e) { if (this.current === job) this.fail(job, e); }
    finally { job.running = false; }
  }
  fail(job, error) {
    if (this.current !== job) return;
    this.cancel(); this.onState({ phase: 'error', error: error.message });
  }
  cancel() {
    const old = this.current; this.current = null;
    this.player.stop();
    if (old) { old.queue.length = 0; old.stream = null; Promise.resolve(this.bridge.stop(old.id)).catch(() => {}); }
    this.onState({ phase: 'idle' });
  }
}
