// Configuration reads are asynchronous. Reserve the requested session before
// reading them so a stop, replacement, unload or renderer exit stays final.
class VoiceSessionStart {
  constructor({ speech, readConfig, resolveOutput = null, cloud = null, onBusy = () => {}, canBegin = () => true }) {
    Object.assign(this, { speech, readConfig, resolveOutput, cloud, onBusy, canBegin });
    this.pending = null;
  }
  async begin(id) {
    if (typeof id !== 'string' || !id || id.length > 128) throw Error('无效语音会话');
    if (!this.canBegin()) throw Error('语音会话已取消');
    this.cloud?.stop();
    const request = { id };
    this.pending = request;
    this.onBusy(true);
    try {
      const output=this.resolveOutput?await this.resolveOutput():null;
      if (this.pending !== request || !this.canBegin()) throw Error('语音会话已取消');
      if(output?.kind==='cloud'){
        this.speech.stop();this.cloud.begin(id,output.config,output.key);this.cloud.session.identity=output.identity;this.pending=null;return;
      }
      this.cloud?.stop();
      const config = output?.config||await this.readConfig();
      if (this.pending !== request || !this.canBegin()) throw Error('语音会话已取消');
      this.speech.configure(config);
      this.speech.begin(id);
      this.pending = null;
    } catch (error) {
      // A replaced request must not release the newer session's audio owner.
      if (this.pending === request) { this.pending = null; this.onBusy(false); }
      throw error;
    }
  }
  cancel(id) {
    if(this.cloud?.session&&(!id||this.cloud.session.id===id)){this.cloud.stop(id);this.onBusy(false);}
    if (!this.pending || (id && this.pending.id !== id)) return false;
    this.pending = null;
    this.onBusy(false);
    return true;
  }
  stop(id) { this.cancel(id); return this.speech.stop(id); }
}
module.exports = { VoiceSessionStart };
