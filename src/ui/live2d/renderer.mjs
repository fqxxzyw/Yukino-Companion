const gazeAxes = {
  ParamEyeBallX: ['x', 1],
  ParamEyeBallY: ['y', 1],
  ParamAngleX: ['x', 0.3],
  ParamAngleY: ['y', 0.3],
};
const mouthId = 'ParamMouthOpenY';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class Live2DAvatarRenderer {
  constructor(host, { viewerUrl, audioPlayer, debug = false, onError = () => {}, onPointer = () => {}, onWheel, onMenu }) {
    this.audioPlayer = audioPlayer;
    this.frame = document.createElement('iframe');
    this.frame.title = '雪乃 Live2D';
    this.frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent';
    const url = new URL(viewerUrl, document.baseURI);
    if (debug) url.searchParams.set('debug', '');
    if (url.origin !== location.origin) throw new Error('Live2D viewer must share the host origin');
    this.resetSpeechClock();
    this.gaze = { x: 0, y: 0 };
    this.gazeEnabled = true;
    this.lastPose = null;
    this.disposed = false;
    this.ready = new Promise((resolve, reject) => {
      this.abortReady = () => reject(new DOMException('Live2D disposed', 'AbortError'));
      this.frame.addEventListener('load', async () => {
        try {
          const viewer = this.frame.contentWindow;
          const runtime = viewer.yukino;
          if (!runtime?.drawPose) throw new Error('Live2D viewer runtime is unavailable');
          const parameters = await runtime.ready();
          if (this.disposed) return;
          this.parameters = new Map(parameters.map(parameter => [parameter.id, parameter]));
          this.runtime = runtime;
          const canvas = viewer.document.querySelector('#model');
          viewer.document.addEventListener('pointermove', () => onPointer(true));
          this.frame.addEventListener('pointerleave', () => onPointer(false));
          viewer.document.addEventListener('wheel', event => {
            if (debug || !onWheel) return;
            event.preventDefault();
            onWheel(event.deltaY);
          }, { passive: false });
          viewer.document.addEventListener('contextmenu', event => {
            if (!onMenu) return;
            event.preventDefault();
            onMenu();
          });
          canvas.addEventListener('pointermove', event => {
            if (!this.gazeEnabled) return;
            const rect = canvas.getBoundingClientRect();
            this.gaze.x = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
            this.gaze.y = clamp(1 - (event.clientY - rect.top) / rect.height * 2, -1, 1);
            this.manual = false;
          });
          canvas.addEventListener('pointerleave', () => { this.gaze = { x: 0, y: 0 }; });
          canvas.addEventListener('dblclick', () => this.reset({ hold: debug }));
          viewer.document.querySelector('#panel')?.addEventListener('input', () => { this.manual = true; });
          viewer.document.querySelector('#panel')?.addEventListener('click', event => {
            if (event.target.tagName === 'BUTTON') this.manual = true;
          });
          this.tick();
          resolve(parameters);
        } catch (error) {
          reject(error);
        }
      }, { once: true });
    });
    this.ready.catch(error => { if (!this.disposed) onError(error); });
    this.frame.src = url.href;
    host.append(this.frame);
  }

  resetSpeechClock() {
    this.speechToken = -1;
    this.elapsed = -1;
  }

  setGazeEnabled(enabled) {
    this.gazeEnabled = enabled;
    if (!enabled) this.gaze = { x: 0, y: 0 };
  }

  mouthLevel() {
    const sample = this.audioPlayer?.getSnapshot();
    if (!Number.isSafeInteger(sample?.token) || sample.token < 0 || sample.token < this.speechToken) return 0;
    if (sample.token > this.speechToken) {
      this.speechToken = sample.token;
      this.elapsed = -1;
    }
    const { elapsedSeconds, durationSeconds, level, playing, paused } = sample;
    if (!playing || paused || !Number.isFinite(elapsedSeconds) ||
        !Number.isFinite(durationSeconds) || elapsedSeconds < 0 ||
        elapsedSeconds < this.elapsed || elapsedSeconds >= durationSeconds) return 0;
    this.elapsed = elapsedSeconds;
    return Number.isFinite(level) ? clamp(level, 0, 1) : 0;
  }

  draw() {
    const values = {};
    const mouth = this.parameters.get(mouthId);
    if (mouth) values[mouthId] = mouth.default + (mouth.max - mouth.default) * this.mouthLevel();
    for (const [id, [axis, strength]] of Object.entries(gazeAxes)) {
      const p = this.parameters.get(id);
      if (!p) continue;
      const direction = this.gaze[axis];
      const range = direction < 0 ? p.default - p.min : p.max - p.default;
      values[id] = p.default + direction * range * strength;
    }
    if (!this.lastPose || Object.keys(values).some(id => values[id] !== this.lastPose[id])) {
      this.runtime.drawPose(values);
      this.lastPose = values;
    }
  }

  tick() {
    if (!this.manual) this.draw();
    this.animation = requestAnimationFrame(() => this.tick());
  }

  reset({ hold = false } = {}) {
    this.gaze = { x: 0, y: 0 };
    this.runtime?.resetPose();
    this.manual = hold;
    this.lastPose = null;
  }

  resume() {
    this.manual = false;
    this.lastPose = null;
  }

  dispose() {
    this.disposed = true;
    this.abortReady();
    cancelAnimationFrame(this.animation);
    this.frame.remove();
  }
}
