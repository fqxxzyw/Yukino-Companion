// A bounded, audio-clock-only gesture layer. Tokens come from AudioPlayer's
// monotonically increasing epoch; no transcript or wall clock is retained.
const ATTACK = .2, RELEASE = .3, VOICE_GATE = .08, PAUSE_GRACE = .25;
const VOICE_THRESHOLD = .02, MAX_OBSERVED_GAP = .25, MAX_WEIGHT = .4;
const EPSILON = 1e-7;
const candidates = Object.freeze({
 neutral: ['Speak_PhraseCadence', 'Nod_Subtle'], question: ['Question_Tilt', 'Nod_Subtle'],
 explain: ['Speak_PhraseCadence', 'Explain_Small', 'Nod_Subtle'], greeting: ['Greet_Reserved', 'Nod_Subtle'],
 clarify: ['Clarify_LowHand', 'Explain_Small', 'Nod_Subtle'],
});
const separatelyApprovedSpeechClips = new Set(['Speak_PhraseCadence', 'Clarify_LowHand']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const hintName = value => Object.hasOwn(candidates, value) ? value : 'neutral';
const identity = entry => [entry?.id || '', entry?.sha256 || '', entry?.version || ''].join('|');
function eligible(entry) {
 return Boolean(entry && entry.clips && !entry.custom && entry.importMode !== 'static' && entry.ready !== false && !entry.hold && !/hold/i.test(String(entry.status || '')));
}
function verifiedClip(entry, clips, name) {
 const declared = Object.hasOwn(entry.clips, name) && entry.clips[name], actual = clips?.get?.(name);
 if (!declared || declared.loop !== false || !actual || !Number.isFinite(declared.duration) || declared.duration <= 0 || !Number.isFinite(actual.duration) || actual.duration <= 0 || Math.abs(declared.duration - actual.duration) > .002) return null;
 const guarded = separatelyApprovedSpeechClips.has(name);
 if (guarded && (declared.speechEligible !== true || !Number.isFinite(declared.minRepeatGapSeconds) || declared.minRepeatGapSeconds < 0)) return null;
 return {name, duration: actual.duration, repeatGap: guarded ? declared.minRepeatGapSeconds : null};
}

// Deliberately not an emotion/refusal classifier. Only short explicit questions,
// exact known greetings, or length-based explanatory prose get a hint.
export function speechHint(text) {
 if (typeof text !== 'string') return 'neutral';
 const value = text.trim();
 if (!value) return 'neutral';
 if (/^(?:つまり|すなわち|具体的には|也就是说|具体来说)/u.test(value)) return 'clarify';
 if (value.length <= 160 && /(?:[?？]|(?:ですか|ますか|でしょうか|かな|かしら)[。.!！?？]?)\s*["'”’」』）)]?$/u.test(value)) return 'question';
 if (value.length <= 80 && /^(?:你好|您好|早上好|上午好|下午好|晚上好|早安|午安|晚安|嗨|哈喽|こんにちは|こんばんは|おはよう(?:ございます)?|おやすみ(?:なさい)?|はじめまして|hello|hi|good\s+(?:morning|afternoon|evening|night))[\s。.!！,，、~～]*$/iu.test(value)) return 'greeting';
 return value.length >= 120 ? 'explain' : 'neutral';
}

export class SpeechMotionDirector {
 constructor() { this.latestToken = -1; this.segment = null; this.repeatStarts = new Map(); }

 // Retire, rather than replay, the current segment. A new AudioPlayer token is
 // required after reset, stop, conflicts or reduced motion.
 reset() { this.segment = null; }

 update(snapshot, {entry, clips, blocked = false, reducedMotion = false} = {}) {
  const token = snapshot?.token;
  if (!Number.isSafeInteger(token) || token < 0) { this.reset(); return null; }
  if (token < this.latestToken) return null; // A delayed IPC sample cannot rewind a newer segment.
  const isNew = token > this.latestToken;
  if (isNew) { this.latestToken = token; this.segment = null; }
  if (blocked || reducedMotion || snapshot.playing !== true || !eligible(entry)) { this.reset(); return null; }
  const elapsed = snapshot.elapsedSeconds, duration = snapshot.durationSeconds;
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(duration) || duration <= 0 || elapsed >= duration) { this.reset(); return null; }
  if (!isNew && !this.segment) return null;
  const voiced = Number.isFinite(snapshot.level) && snapshot.level >= VOICE_THRESHOLD;
  const clock = Number.isFinite(snapshot.clockSeconds) && snapshot.clockSeconds >= 0 ? snapshot.clockSeconds : null;
  if (isNew) this.segment = {identity: identity(entry), duration, lastElapsed: elapsed, lastClock: clock, previousVoiced: voiced, voicedSeconds: 0, paused: false, motion: null, finished: false, hint: hintName(snapshot.hint)};
  const segment = this.segment;
  if (segment.identity !== identity(entry) || Math.abs(segment.duration - duration) > .002 || elapsed < segment.lastElapsed - EPSILON || clock !== null && segment.lastClock !== null && clock < segment.lastClock - EPSILON) { this.reset(); return null; }
  if (clock !== null) segment.lastClock = clock;
  let delta = Math.max(0, elapsed - segment.lastElapsed);
  segment.lastElapsed = elapsed;
  if (segment.finished) return null;
  if (segment.motion && (!verifiedClip(entry, clips, segment.motion.name) || segment.motion.repeatGap !== null && clock === null)) { this.reset(); return null; }
  if (snapshot.paused === true) {
   segment.paused = true; segment.voicedSeconds = 0; segment.previousVoiced = false;
   return segment.motion ? {name: segment.motion.name, time: segment.motion.time, weight: 0, token} : null;
  }
  if (segment.paused) {
   segment.paused = false; delta = 0;
   if (segment.motion) {
    // A stale relay can pause the local layer while real audio keeps running.
    // Do not restart a held gesture that can no longer finish before speech.
    if (duration - elapsed + EPSILON < segment.motion.duration - segment.motion.time + .2) { segment.finished = true; return null; }
    segment.motion.resumeAt = segment.motion.time;
   }
  }
  if (!segment.motion) {
   segment.hint = hintName(snapshot.hint);
   segment.voicedSeconds = voiced && segment.previousVoiced && delta <= MAX_OBSERVED_GAP + EPSILON ? segment.voicedSeconds + delta : 0;
   segment.previousVoiced = voiced;
   if (segment.voicedSeconds + EPSILON < VOICE_GATE) return null;
   const choice = candidates[segment.hint].map(name => verifiedClip(entry, clips, name)).find(clip => clip && duration - elapsed + EPSILON >= clip.duration + .2 && (clip.repeatGap === null || clock !== null && (!this.repeatStarts.has(clip.name) || clock - this.repeatStarts.get(clip.name) + EPSILON >= clip.repeatGap)));
   if (!choice) { segment.finished = true; return null; }
   // Bounded to two approved names. Reset/cancellation never clears repeat gaps.
   if (choice.repeatGap !== null) this.repeatStarts.set(choice.name, clock);
   segment.motion = {...choice, time: 0, silenceSeconds: 0, voiceGain: 1, recovery: null, resumeAt: null};
   return {name: choice.name, time: 0, weight: 0, token};
  }
  const motion = segment.motion;
  motion.time = Math.min(motion.duration, motion.time + delta);
  if (motion.time >= motion.duration - EPSILON) { segment.finished = true; return null; }
  if (voiced) {
   if (!segment.previousVoiced && motion.voiceGain < 1) motion.recovery = {time: motion.time, from: motion.voiceGain};
   motion.silenceSeconds = 0;
   motion.voiceGain = motion.recovery ? motion.recovery.from + (1 - motion.recovery.from) * smooth((motion.time - motion.recovery.time) / ATTACK) : 1;
  } else {
   motion.silenceSeconds += delta; motion.recovery = null;
   motion.voiceGain = Math.min(motion.voiceGain, smooth(1 - (motion.silenceSeconds - PAUSE_GRACE) / RELEASE));
  }
  segment.previousVoiced = voiced;
  const resume = motion.resumeAt === null ? 1 : smooth((motion.time - motion.resumeAt) / ATTACK);
  const envelope = smooth(motion.time / ATTACK) * smooth((motion.duration - motion.time) / RELEASE);
  return {name: motion.name, time: motion.time, weight: clamp(MAX_WEIGHT * envelope * motion.voiceGain * resume, 0, MAX_WEIGHT), token};
 }
}
