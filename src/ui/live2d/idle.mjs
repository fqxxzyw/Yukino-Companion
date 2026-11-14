const gestures = [
  { pose: { ParamEyeBallX: .72, ParamAngleX: 22 }, lookBack: true },
  { pose: { ParamEyeBallY: -.55, ParamAngleY: -22 }, blink: true },
  { pose: { ParamAngleZ: 18, ParamBrowLY: .48, ParamBrowRY: -.24 } },
  { pose: { ParamYukinoSmile: .9, ParamEyeLOpen: -.16, ParamEyeROpen: -.16 } },
];
const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export class Live2DIdle {
  reset() {
    this.nextAt = undefined;
    this.startedAt = undefined;
    this.current = undefined;
    this.remaining = [];
    this.previous = undefined;
  }

  sample(now, blocked) {
    if (blocked) {
      this.nextAt = now + 4500;
      this.startedAt = undefined;
      return {};
    }
    this.nextAt ??= now + 4500;
    if (now < this.nextAt) return {};
    if (this.startedAt === undefined) {
      this.startedAt = now;
      this.remaining ??= [];
      if (!this.remaining.length) this.remaining = [...gestures];
      const choices = this.remaining.filter(gesture => gesture !== this.previous);
      const pool = choices.length ? choices : this.remaining;
      const gesture = pool[Math.floor(Math.random() * pool.length)];
      this.remaining.splice(this.remaining.indexOf(gesture), 1);
      this.previous = gesture;
      this.current = {
        ...gesture,
        side: Math.random() < .5 ? -1 : 1,
        tilt: gesture.pose.ParamAngleZ ? 0 : Math.random() < .55 ? 11 : 0,
        blinkAt: gesture.blink || Math.random() < .65 ? 1150 + Math.random() * 420 : Infinity,
      };
    }
    const elapsed = now - this.startedAt;
    const duration = 3500;
    if (elapsed >= duration) {
      this.startedAt = undefined;
      this.nextAt = now + 5000 + Math.random() * 6500;
      return {};
    }
    const { pose, side, tilt, blinkAt, lookBack } = this.current;
    const values = {};
    for (const [id, offset] of Object.entries({ ...pose, ParamAngleZ: pose.ParamAngleZ ?? tilt })) {
      const lead = id.startsWith('ParamAngle') ? 130 : 0;
      const end = lookBack && id === 'ParamEyeBallX' ? 2100 : duration;
      const weight = smooth((elapsed - lead) / 700) * smooth((end - elapsed) / 900);
      const lateral = id === 'ParamAngleX' || id === 'ParamAngleZ' || id === 'ParamEyeBallX';
      values[id] = offset * weight * (lateral ? side : 1);
    }
    if (elapsed >= blinkAt && elapsed < blinkAt + 260) {
      const blinkTime = elapsed - blinkAt;
      const closure = smooth(blinkTime / 65) * smooth((260 - blinkTime) / 110);
      for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) values[id] = Math.min(values[id] ?? 0, -closure);
    }
    return values;
  }
}
