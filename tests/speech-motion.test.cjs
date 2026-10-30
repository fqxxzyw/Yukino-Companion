const test = require('node:test'), assert = require('node:assert/strict');
const modules = import('../src/speech/motion.mjs');
const durations = {Nod_Subtle: 2.4, Question_Tilt: 3.7, Explain_Small: 4.2, Greet_Reserved: 3.6};
async function fixture({duration = 12, hint = 'neutral', entryPatch = {}} = {}) {
 const {SpeechMotionDirector} = await modules;
 const director = new SpeechMotionDirector(), entry = {id: 'yukino-07-v1', version: 'verified', ready: true, clips: Object.fromEntries(Object.entries(durations).map(([name, duration]) => [name, {duration, loop: false}])), ...entryPatch};
 const clips = new Map(Object.entries(durations).map(([name, duration]) => [name, {duration}]));
 const sample = (elapsedSeconds, patch = {}, context = {}) => director.update({token: 1, playing: true, paused: false, elapsedSeconds, durationSeconds: duration, level: .2, hint, ...patch}, {entry, clips, ...context});
 const start = () => { assert.equal(sample(0), null); assert.equal(sample(.04), null); return sample(.08); };
 return {director, entry, clips, sample, start};
}
function close(actual, expected, tolerance = 1e-10) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`); }

test('sustained voiced audio starts one bounded Nod with 0.2 s attack and 0.3 s release', async () => {
 const f = await fixture(), start = f.start();
 assert.deepEqual(start, {name: 'Nod_Subtle', time: 0, weight: 0, token: 1});
 const middleAttack = f.sample(.18); close(middleAttack.time, .1); close(middleAttack.weight, .2);
 close(f.sample(.28).weight, .4); close(f.sample(2.18).weight, .4); close(f.sample(2.33).weight, .2);
 assert.equal(f.sample(2.48), null); assert.equal(f.sample(7), null, 'Same segment must not start another gesture');
});

test('voiced gate resets on silence and does not treat repeated timestamps as elapsed activity', async () => {
 const f = await fixture();
 assert.equal(f.sample(0), null); assert.equal(f.sample(.06), null); assert.equal(f.sample(.07, {level: 0}), null);
 assert.equal(f.sample(.1), null); assert.equal(f.sample(.15), null);
 for (let i = 0; i < 100; i++) assert.equal(f.sample(.15), null);
 assert.equal(f.sample(.18)?.name, 'Nod_Subtle');
});

test('safe hints select only existing manifest-approved non-loop clips and fall back to Nod', async () => {
 for (const [hint, expected] of [['neutral', 'Nod_Subtle'], ['question', 'Question_Tilt'], ['explain', 'Explain_Small'], ['greeting', 'Greet_Reserved'], ['refusal', 'Nod_Subtle'], ['Walk_Slow_Loop', 'Nod_Subtle']]) {
  const f = await fixture({hint}); assert.equal(f.start()?.name, expected);
 }
 for (const hint of ['question', 'explain', 'greeting']) {
  const f = await fixture({hint}); for (const name of ['Question_Tilt', 'Explain_Small', 'Greet_Reserved']) f.clips.delete(name);
  assert.equal(f.start()?.name, 'Nod_Subtle');
 }
});

test('full clip plus 0.2 seconds must fit the remaining audio; short segments stay mouth-only', async () => {
 const fallback = await fixture({duration: 3, hint: 'question'}); assert.equal(fallback.start()?.name, 'Nod_Subtle');
 const exact = await fixture({duration: 2.68}); assert.equal(exact.start()?.name, 'Nod_Subtle');
 const short = await fixture({duration: 2.679}); assert.equal(short.start(), null); assert.equal(short.sample(.2), null);
 const insufficient = await fixture({duration: 1.4}); assert.equal(insufficient.start(), null);
});

test('unverified, looping, missing or mismatched clips never become semantic fallback gestures', async () => {
 for (const mode of ['looping', 'no-manifest', 'no-actual', 'mismatch', 'nan', 'negative']) {
  const f = await fixture();
  if (mode === 'looping') f.entry.clips.Nod_Subtle.loop = true;
  if (mode === 'no-manifest') delete f.entry.clips.Nod_Subtle;
  if (mode === 'no-actual') f.clips.delete('Nod_Subtle');
  if (mode === 'mismatch') f.clips.get('Nod_Subtle').duration = 3;
  if (mode === 'nan') f.clips.get('Nod_Subtle').duration = NaN;
  if (mode === 'negative') f.entry.clips.Nod_Subtle.duration = -1;
  assert.equal(f.start(), null, mode);
 }
});

test('custom, static, HOLD and unavailable models consume the token instead of replaying later', async () => {
 for (const patch of [{custom: true}, {importMode: 'static'}, {hold: true}, {status: 'HOLD_pending'}, {ready: false}]) {
  const f = await fixture({entryPatch: patch}); assert.equal(f.start(), null);
  for (const key of Object.keys(patch)) delete f.entry[key]; f.entry.ready = true;
  assert.equal(f.sample(.2), null); assert.equal(f.sample(.3), null);
 }
});

test('walking-capable idle models may nod, but walking/other conflicts consume the current speech segment', async () => {
 const f = await fixture({entryPatch: {walking: {clip: 'Walk_Slow_Loop'}}});
 assert.equal(f.start()?.name, 'Nod_Subtle');
 assert.equal(f.sample(.3, {}, {blocked: true}), null); assert.equal(f.sample(.4), null);
 assert.equal(f.sample(0, {token: 2}), null); assert.equal(f.sample(.1, {token: 2})?.name, 'Nod_Subtle');
});

test('blocked, reduced motion, explicit stop and reset all prevent same-token restart', async () => {
 for (const stop of ['blocked', 'reduced', 'stopped', 'reset']) {
  const f = await fixture(); f.start();
  if (stop === 'blocked') assert.equal(f.sample(.2, {}, {blocked: true}), null);
  if (stop === 'reduced') assert.equal(f.sample(.2, {}, {reducedMotion: true}), null);
  if (stop === 'stopped') assert.equal(f.sample(.2, {playing: false}), null);
  if (stop === 'reset') f.director.reset();
  assert.equal(f.sample(.3), null); assert.equal(f.sample(.5), null);
  assert.equal(f.sample(0, {token: 2}), null); assert.equal(f.sample(.1, {token: 2})?.time, 0);
 }
});

test('a nonplaying initial/stop token is retired and the next AudioPlayer token is required', async () => {
 const f = await fixture(); assert.equal(f.sample(0, {playing: false, token: 0}), null);
 assert.equal(f.sample(.1, {token: 0}), null); assert.equal(f.sample(.2, {token: 0}), null);
 assert.equal(f.start()?.token, 1);
 assert.equal(f.sample(0, {playing: false, token: 2}), null); assert.equal(f.sample(.2, {token: 2}), null);
});

test('new token starts independently and delayed old IPC cannot rewind the active segment', async () => {
 const f = await fixture(); f.start(); f.sample(.4);
 assert.equal(f.sample(0, {token: 2}), null); assert.equal(f.sample(.1, {token: 2})?.time, 0);
 assert.equal(f.sample(4, {token: 1, playing: false}), null);
 close(f.sample(.2, {token: 2}).time, .1);
 assert.equal(f.director.latestToken, 2);
});

test('frozen AudioContext time holds motion and weighting regardless of sample count or level changes', async () => {
 const f = await fixture(); f.start(); const held = f.sample(.58);
 for (let i = 0; i < 1000; i++) assert.deepEqual(f.sample(.58, {level: i % 2 ? 0 : .2}), held);
});

test('brief relay/audio pause holds clip time at zero weight and resumes without a jump', async () => {
 const f = await fixture(); f.start(); const before = f.sample(.58);
 assert.deepEqual(f.sample(.58, {paused: true, level: 0}), {...before, weight: 0});
 assert.deepEqual(f.sample(.58, {paused: true, level: 0}), {...before, weight: 0});
 const resumed = f.sample(.58); assert.equal(resumed.time, before.time); assert.equal(resumed.weight, 0);
 const half = f.sample(.68); close(half.time, before.time + .1); close(half.weight, .2);
 close(f.sample(.78).weight, .4);
});

test('paused clock increments are not accumulated into a burst when playback resumes', async () => {
 const f = await fixture(); f.start(); const before = f.sample(.38);
 assert.equal(f.sample(.5, {paused: true}).time, before.time); assert.equal(f.sample(2, {paused: true}).time, before.time);
 assert.equal(f.sample(2.1).time, before.time); close(f.sample(2.2).time, before.time + .1);
});

test('a relay-stalled gesture is retired if resumed audio no longer leaves enough time to finish', async () => {
 const f = await fixture({duration: 3}); f.start(); f.sample(.38);
 assert.equal(f.sample(.38, {paused: true})?.weight, 0);
 assert.equal(f.sample(2.1), null); assert.equal(f.sample(2.2), null);
});

test('long unvoiced pause fades down after 0.25 seconds and renewed voice fades up', async () => {
 const f = await fixture(); f.start(); f.sample(.48);
 close(f.sample(.58, {level: 0}).weight, .4); close(f.sample(.73, {level: 0}).weight, .4);
 close(f.sample(.88, {level: 0}).weight, .2); close(f.sample(1.03, {level: 0}).weight, 0);
 close(f.sample(1.13).weight, 0); close(f.sample(1.23).weight, .2); close(f.sample(1.33).weight, .4);
});

test('rewound, nonfinite, negative or out-of-range audio timestamps invalidate instead of replaying', async () => {
 for (const patch of [{elapsedSeconds: -.1}, {elapsedSeconds: NaN}, {elapsedSeconds: Infinity}, {elapsedSeconds: 12}, {durationSeconds: 0}, {durationSeconds: Infinity}, {durationSeconds: 10}]) {
  const f = await fixture(); f.start(); f.sample(.4); assert.equal(f.sample(.5, patch), null); assert.equal(f.sample(.6), null);
 }
 const rewind = await fixture(); rewind.start(); rewind.sample(.5); assert.equal(rewind.sample(.4), null); assert.equal(rewind.sample(.6), null);
});

test('invalid tokens fail closed and all emitted tokens stay safe integers', async () => {
 for (const token of [NaN, Infinity, 1.5, -1, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
  const f = await fixture(); f.start(); assert.equal(f.sample(.2, {token}), null); assert.equal(f.sample(.3), null);
 }
 const f = await fixture(); assert.equal(f.sample(0, {token: Number.MAX_SAFE_INTEGER}), null);
 assert.equal(f.sample(.1, {token: Number.MAX_SAFE_INTEGER})?.token, Number.MAX_SAFE_INTEGER);
});

test('low-FPS clock gaps do not fabricate sustained initial speech or emit queued gesture bursts', async () => {
 const f = await fixture(); assert.equal(f.sample(0), null); assert.equal(f.sample(2), null); assert.equal(f.sample(2.08)?.time, 0);
 const jumped = f.sample(3.08); close(jumped.time, 1); assert.ok(jumped.weight <= .4);
 assert.equal(f.sample(8), null); assert.equal(f.sample(8.1), null);
});

test('model identity or active clip validation changes cancel the segment', async () => {
 for (const kind of ['id', 'hash', 'missing', 'duration', 'loop']) {
  const f = await fixture(); f.start();
  if (kind === 'id') f.entry.id = 'other-character';
  if (kind === 'hash') f.entry.sha256 = 'new-asset';
  if (kind === 'missing') f.clips.delete('Nod_Subtle');
  if (kind === 'duration') f.clips.get('Nod_Subtle').duration += .1;
  if (kind === 'loop') f.entry.clips.Nod_Subtle.loop = true;
  assert.equal(f.sample(.2), null, kind); assert.equal(f.sample(.3), null);
 }
});

test('clock sampling rate does not change a started gesture position or its envelope', async () => {
 for (const hz of [10, 30, 60, 144]) {
  const f = await fixture(); f.start();
  for (let t = .08 + 1 / hz; t < 1.08 - 1e-9; t += 1 / hz) f.sample(t);
  const result = f.sample(1.08); close(result.time, 1); close(result.weight, .4);
 }
});

test('speechHint is constrained, retains no text, and never infers refusal or arbitrary actions', async () => {
 const {speechHint} = await modules;
 for (const text of ['你好！', 'こんにちは。', 'おはようございます', 'Hello!', 'good evening']) assert.equal(speechHint(text), 'greeting', text);
 for (const text of ['为什么？', 'Ready?', 'どう思いますか。', 'そうかな', '本当かしら']) assert.equal(speechHint(text), 'question', text);
 for (const text of ['', null, '不行，我拒绝。', '怒っている', 'Walk_Slow_Loop', 'history']) assert.equal(speechHint(text), 'neutral', String(text));
 assert.equal(speechHint('这是一段较长的解释。'.repeat(15)), 'explain');
 const secret = 'not retained '+ 'x'.repeat(200), f = await fixture({hint: speechHint(secret)}); f.start();
 assert.ok(!JSON.stringify(f.director).includes(secret));
 assert.ok(['neutral', 'question', 'greeting', 'explain'].includes(speechHint('x'.repeat(100000))));
});

async function approvedFixture(options = {}) {
 const f = await fixture(options);
 for (const [name, duration] of [['Speak_PhraseCadence', 3], ['Clarify_LowHand', 3.4]]) {
  f.entry.clips[name] = {duration, loop: false, speechEligible: true, minRepeatGapSeconds: 10}; f.clips.set(name, {duration});
 }
 return f;
}
function startApproved(f, {token = 1, clock = 100, hint = 'neutral'} = {}) {
 assert.equal(f.sample(0, {token, clockSeconds: clock, hint}), null);
 return f.sample(.08, {token, clockSeconds: clock + .08, hint});
}

test('only the two explicitly speech-eligible new names enter the automatic selection order', async () => {
 for (const [hint, expected] of [['neutral', 'Speak_PhraseCadence'], ['explain', 'Speak_PhraseCadence'], ['clarify', 'Clarify_LowHand'], ['question', 'Question_Tilt'], ['greeting', 'Greet_Reserved']]) {
  const f = await approvedFixture(); assert.equal(startApproved(f, {hint})?.name, expected);
 }
 const other = await fixture(); other.entry.clips.UnapprovedGesture = {duration: 1, loop: false, speechEligible: true, minRepeatGapSeconds: 0}; other.clips.set('UnapprovedGesture', {duration: 1});
 assert.equal(startApproved(other, {hint: 'UnapprovedGesture'})?.name, 'Nod_Subtle');
});

test('new names require explicit eligibility, actual clock and declared repeat gap, otherwise legacy fallback remains', async () => {
 for (const mode of ['flag-false', 'no-flag', 'no-gap', 'invalid-gap', 'no-clock', 'nan-clock', 'negative-clock']) {
  const f = await approvedFixture();
  if (mode === 'flag-false') f.entry.clips.Speak_PhraseCadence.speechEligible = false;
  if (mode === 'no-flag') delete f.entry.clips.Speak_PhraseCadence.speechEligible;
  if (mode === 'no-gap') delete f.entry.clips.Speak_PhraseCadence.minRepeatGapSeconds;
  if (mode === 'invalid-gap') f.entry.clips.Speak_PhraseCadence.minRepeatGapSeconds = -1;
  const clock = mode === 'no-clock' ? undefined : mode === 'nan-clock' ? NaN : mode === 'negative-clock' ? -1 : 100;
  f.sample(0, {clockSeconds: clock}); assert.equal(f.sample(.08, {clockSeconds: clock === undefined ? undefined : clock + .08})?.name, 'Nod_Subtle', mode);
 }
 const clarify = await fixture({hint: 'clarify'}); assert.equal(clarify.start()?.name, 'Explain_Small');
});

test('absolute AudioContext repeat gaps survive new tokens, cancellation and reset', async () => {
 const f = await approvedFixture(); assert.equal(startApproved(f)?.name, 'Speak_PhraseCadence');
 assert.equal(f.sample(.2, {clockSeconds: 100.2}, {blocked: true}), null); f.director.reset();
 assert.equal(startApproved(f, {token: 2, clock: 102})?.name, 'Nod_Subtle');
 assert.equal(startApproved(f, {token: 3, clock: 109.999})?.name, 'Nod_Subtle');
 assert.equal(startApproved(f, {token: 4, clock: 110})?.name, 'Speak_PhraseCadence');
 assert.equal(startApproved(f, {token: 5, clock: 110.5, hint: 'clarify'})?.name, 'Clarify_LowHand');
 assert.deepEqual([...f.director.repeatStarts.keys()].sort(), ['Clarify_LowHand', 'Speak_PhraseCadence']);
 assert.equal(startApproved(f, {token: 6, clock: 111, hint: 'clarify'})?.name, 'Explain_Small');
});

test('a reset absolute clock cannot bypass a previously selected new-clip repeat gap', async () => {
 const f = await approvedFixture(); startApproved(f, {clock: 1000}); f.director.reset();
 assert.equal(startApproved(f, {token: 2, clock: 0})?.name, 'Nod_Subtle');
 assert.equal(f.director.repeatStarts.get('Speak_PhraseCadence'), 1000.08);
});

test('missing or rewound absolute clock cancels an active newly gated gesture', async () => {
 for (const mode of ['missing', 'rewound']) {
  const f = await approvedFixture(); startApproved(f);
  assert.ok(f.sample(.2, {clockSeconds: 100.2}));
  assert.equal(f.sample(.3, {clockSeconds: mode === 'missing' ? undefined : 100.1}), null);
  assert.equal(f.sample(.4, {clockSeconds: 100.4}), null);
 }
});

test('absolute clock never advances a gesture when the playback elapsed clock is frozen', async () => {
 const f = await approvedFixture(); startApproved(f); const held = f.sample(.4, {clockSeconds: 100.4});
 assert.deepEqual(f.sample(.4, {clockSeconds: 101}), held);
 assert.deepEqual(f.sample(.4, {clockSeconds: 102}), held);
});

test('clarification hints require explicit known prefixes, with no text retained or other semantic triggers', async () => {
 const {speechHint} = await modules;
 for (const value of ['つまり、こういうことです。', 'すなわち説明します。', '具体的には次の通りです。', '也就是说这并不矛盾。', '具体来说，先做第一步。']) assert.equal(speechHint(value), 'clarify');
 for (const value of ['不赞成这个解释', '他说也就是说', 'This is a refusal', 'Clarify_LowHand']) assert.equal(speechHint(value), 'neutral');
});
