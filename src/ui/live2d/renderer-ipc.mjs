import { BlinkScheduler } from '../blink-scheduler.mjs';
import { Live2DIdle } from './idle.mjs';

const mouthId = 'ParamMouthOpenY';
const eyes = ['ParamEyeLOpen', 'ParamEyeROpen'];
const breathId = 'ParamBreath';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = value => Number.isFinite(value) ? value : 0;
const gazeParameters = [
  ['ParamEyeBallX', 'eyeX', 3.2, 1, 65],
  ['ParamEyeBallY', 'eyeY', -4, 1, 65],
  ['ParamAngleX', 'headYaw', 3.5, 42, 145],
  ['ParamAngleY', 'headPitch', 6.5, 30, 145],
];

function validateViewerUrl(value, debug) {
  const url = new URL(value, document.baseURI);
  const local = url.protocol === 'yukino-live2d:' && url.host === 'local' && url.pathname === '/index.html';
  const development = url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.origin === location.origin;
  if ((!local && !development) || url.username || url.password) throw Error('Live2D 查看器地址无效');
  if (debug) url.searchParams.set('debug', '');
  return url;
}

function parameterMap(parameters) {
  if (!Array.isArray(parameters) || parameters.length > 512) throw Error('Live2D 参数无效');
  return new Map(parameters.filter(p => typeof p?.id === 'string' && p.id.length <= 80 &&
    [p.min, p.default, p.max].every(Number.isFinite) && p.min <= p.default && p.default <= p.max)
    .map(p => [p.id, p]));
}

export class Live2DAvatarRenderer {
  constructor(host, { viewerUrl, audioPlayer, debug = false, onError = () => {} }) {
    this.audioPlayer = audioPlayer;
    this.onError = onError;
    this.frame = document.createElement('iframe');
    this.frame.title = '雪乃 Live2D';
    this.frame.style.cssText = 'display:block;width:100%;height:100%;border:0;outline:0;background:transparent';
    if (!debug) {
      this.frame.style.pointerEvents = 'none';
      this.frame.tabIndex = -1;
    }
    this.frame.referrerPolicy = 'no-referrer';
    this.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    const url = validateViewerUrl(viewerUrl, debug);
    this.resetSpeechClock();
    this.gaze = {};
    this.gazeOffsets = {};
    this.idle = new Live2DIdle();
    this.idleOffsets = {};
    this.hairAngle = 0;
    this.pose = Object.create(null);
    this.blink = new BlinkScheduler();
    this.visible = true;
    this.lastPose = null;
    this.disposed = false;
    this.lastTick = -Infinity;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(Error('本地 Live2D 查看器未响应')), 12000);
      const fail = error => { clearTimeout(timer); this.port?.close(); reject(error); };
      this.abortReady = () => fail(new DOMException('Live2D disposed', 'AbortError'));
      this.frame.addEventListener('load', () => {
        if (this.disposed) return;
        const channel = new MessageChannel();
        this.port = channel.port1;
        this.port.onmessage = ({ data }) => {
          const { type, value } = data || {};
          if (type === 'ready' && !this.parameters) {
            try {
              const { parameters, width, height, mask } = value;
              if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
                  width > 2048 || height > 2048 || !(mask instanceof Uint8Array) ||
                  mask.length !== Math.ceil(width * height / 8)) throw Error('Live2D 轮廓无效');
              this.parameters = parameterMap(parameters);
              this.silhouette = { width, height, mask };
              clearTimeout(timer);
              this.schedule();
              resolve(parameters);
            } catch (error) { fail(error); }
          } else if (type === 'error') {
            const error = Error(typeof value === 'string' ? value.slice(0, 250) : 'Live2D 无法渲染');
            if (this.parameters) { this.setVisible(false); this.onError(error); }
            else fail(error);
          } else if (debug && type === 'gaze') {
            this.setGaze(value);
            if (value) this.resume();
          } else if (debug && type === 'reset') {
            this.reset({ hold: true });
          } else if (debug && type === 'manual') this.manual = true;
        };
        try {
          this.frame.contentWindow.postMessage({ type: 'yukino-live2d-connect' },
            url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin, [channel.port2]);
        } catch (error) {
          channel.port2.close();
          fail(error);
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

  mouthLevel() {
    const sample = this.audioPlayer?.getSnapshot?.();
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

  draw(now, elapsed) {
    const values = this.reducedMotion ? {} : { ...this.pose };
    const mouth = this.parameters.get(mouthId);
    if (mouth) values[mouthId] = mouth.default + (mouth.max - mouth.default) * (this.reducedMotion ? 0 : this.mouthLevel());
    if (!this.reducedMotion) {
      const returning = gazeParameters.every(([, axis]) => !number(this.gaze[axis]));
      const speech = this.audioPlayer?.getSnapshot?.();
      const idle = this.idle.sample(now, !returning || Boolean(speech?.playing) || Object.keys(this.pose).length > 0);
      for (const id of new Set([...Object.keys(idle), ...Object.keys(this.idleOffsets)])) {
        const parameter = this.parameters.get(id);
        if (!parameter) continue;
        const target = idle[id] ?? 0;
        const offset = target + ((this.idleOffsets[id] ?? 0) - target) * Math.exp(-elapsed / 65);
        if (!target && Math.abs(offset) < .001) delete this.idleOffsets[id];
        else this.idleOffsets[id] = offset;
        values[id] = clamp((values[id] ?? parameter.default) + offset, parameter.min, parameter.max);
      }
      for (const [id, axis, gain, limit, followTime] of gazeParameters) {
        const p = this.parameters.get(id);
        if (!p) continue;
        const previous = this.gazeOffsets[id] ?? 0;
        const target = clamp(number(this.gaze[axis]) * gain, -limit, limit);
        const time = returning ? followTime + 240 : followTime;
        const next = target + (previous - target) * Math.exp(-elapsed / time);
        const offset = Math.abs(next - target) < limit * 0.001 ? target : next;
        this.gazeOffsets[id] = offset;
        values[id] = clamp((values[id] ?? p.default) + offset, p.min, p.max);
      }
      const angle = number(values.ParamAngleX) + number(values.ParamAngleZ) + number(values.ParamAngleY) * .45;
      this.hairAngle += (angle - this.hairAngle) * (1 - Math.exp(-elapsed / 260));
      const lag = this.hairAngle - angle;
      for (const [id, gain] of [['ParamHairFront', .023], ['ParamHairBack', .032]]) {
        const parameter = this.parameters.get(id);
        if (parameter) values[id] = clamp((values[id] ?? parameter.default) + lag * gain, parameter.min, parameter.max);
      }
      const breath = this.parameters.get(breathId);
      if (breath && breath.max > breath.default) {
        const base = values[breathId] ?? breath.default;
        const wave = (1 - Math.cos((now % 4400) * 2 * Math.PI / 4400)) * 0.11;
        values[breathId] = clamp(base + (breath.max - breath.default) * wave, breath.min, breath.max);
      }
    }
    const blink = this.blink.update(now, { enabled: eyes.every(id => {
      const p = this.parameters.get(id);
      return p && p.default > p.min;
    }), reducedMotion: this.reducedMotion });
    if (blink > 0) for (const id of eyes) {
      const p = this.parameters.get(id);
      const base = values[id] ?? p.default;
      values[id] = base + (p.min - base) * blink;
    }
    if (!this.lastPose || Object.keys({ ...this.lastPose, ...values }).some(id => values[id] !== this.lastPose[id])) {
      this.port.postMessage({ type: 'draw', value: values });
      this.lastPose = values;
    }
  }

  schedule() {
    if (!this.disposed && this.visible && this.parameters && !this.animation)
      this.animation = requestAnimationFrame(now => {
        this.animation = null;
        if (!this.manual && now - this.lastTick >= 15) {
          const elapsed = Math.min(50, now - this.lastTick);
          this.lastTick = now;
          this.draw(now, elapsed);
        }
        this.schedule();
      });
  }

  reset({ hold = false } = {}) {
    this.idle.reset();
    this.idleOffsets = {};
    this.hairAngle = 0;
    this.gaze = {};
    this.gazeOffsets = {};
    this.pose = Object.create(null);
    this.blink.reset();
    this.port?.postMessage({ type: 'reset' });
    this.manual = hold;
    this.lastPose = null;
  }

  setGaze(value) { this.gaze = value || {}; }

  setPoseParameters(values) {
    this.pose = Object.create(null);
    if (!values || !this.parameters) return;
    for (const [id, value] of Object.entries(values)) {
      const p = this.parameters.get(id);
      if (p && id !== mouthId && Number.isFinite(value)) this.pose[id] = clamp(value, p.min, p.max);
    }
  }

  setVisible(value) {
    this.visible = value !== false;
    if (this.visible) this.schedule();
    else {
      this.idle.reset();
      this.idleOffsets = {};
      this.hairAngle = 0;
      cancelAnimationFrame(this.animation);
      this.animation = null;
      this.blink.reset();
    }
  }

  setReducedMotion(value) {
    this.reducedMotion = value === true;
    if (this.reducedMotion) {
      this.idle.reset();
      this.idleOffsets = {};
      this.hairAngle = 0;
      this.gazeOffsets = {};
      this.blink.reset();
    }
  }

  hitTest(clientX, clientY) {
    if (!this.visible || !this.silhouette) return false;
    const { width, height, mask } = this.silhouette;
    const rect = this.frame.getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height);
    if (!(scale > 0)) return false;
    const x = Math.floor((clientX - rect.left - (rect.width - width * scale) / 2) / scale);
    const y = Math.floor((clientY - rect.top - (rect.height - height * scale) / 2) / scale);
    if (!(x >= 0 && y >= 0 && x < width && y < height)) return false;
    const bit = y * width + x;
    return Boolean(mask[bit >> 3] & (1 << (bit & 7)));
  }

  resume() {
    if (!this.manual) return;
    this.manual = false;
    this.lastPose = null;
  }

  dispose() {
    this.disposed = true;
    this.abortReady();
    cancelAnimationFrame(this.animation);
    this.blink.dispose();
    this.frame.remove();
  }
}
