// Renderer-independent motion signals. Seconds in, normalized parameters out.
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0));
export class NaturalMotion {
  constructor({ random = Math.random } = {}) {
    this.random = random; this.time = 0; this.blink = -1;
    this.nextBlink = 2 + random() * 4;
    this.x = 0; this.y = 0; this.tx = 0; this.ty = 0;
    this.mouth = 0; this.volume = 0; this.state = 'idle';
  }
  setPointer(x, y) { this.tx = clamp(x, -1, 1); this.ty = clamp(y, -1, 1); }
  setState(state) {
    if (!['idle', 'thinking', 'speaking'].includes(state)) throw new TypeError('Unknown avatar state');
    this.state = state;
    if (state !== 'speaking') this.volume = 0;
  }
  setLipSync(value) { this.volume = clamp(value, 0, 1); }
  step(seconds, { reducedMotion = false } = {}) {
    // Clamp after hidden-tab gaps so resuming cannot cause a large jump.
    const dt = clamp(seconds, 0, 0.1); this.time += dt;
    const ease = 1 - Math.exp(-dt / 0.3);
    this.x += (this.tx - this.x) * ease; this.y += (this.ty - this.y) * ease;
    const target = this.state === 'speaking' ? this.volume : 0;
    this.mouth += (target - this.mouth) * (1 - Math.exp(-dt / (target > this.mouth ? 0.055 : 0.11)));
    if (this.time >= this.nextBlink && this.blink < 0) this.blink = 0;
    let eyeOpen = 1;
    if (this.blink >= 0) {
      this.blink += dt;
      eyeOpen = 1 - Math.sin(Math.PI * Math.min(this.blink / 0.18, 1));
      if (this.blink >= 0.18) { this.blink = -1; this.nextBlink = this.time + 2.5 + this.random() * 4.5; }
    }
    const t = this.time;
    return {
      eyeOpen: reducedMotion ? 1 : clamp(eyeOpen, 0, 1), mouthOpen: this.mouth,
      gazeX: reducedMotion ? 0 : this.x * 0.65, gazeY: reducedMotion ? 0 : this.y * 0.45,
      headX: reducedMotion ? 0 : this.x * 6,
      headY: reducedMotion ? 0 : this.y * 4,
      breath: reducedMotion ? 0 : (Math.sin(t * Math.PI / 2.6) + 1) / 2,
      bodyAngle: reducedMotion ? 0 : Math.sin(t * 0.51) * 0.35 + Math.sin(t * 0.29) * 0.15,
      hairAngle: reducedMotion ? 0 : Math.sin(t * 0.51 - 0.35) * 0.6,
    };
  }
}
