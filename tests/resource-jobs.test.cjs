const test = require('node:test');
const assert = require('node:assert/strict');
const { ResourceJobs } = require('../electron/resource-jobs.cjs');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(setImmediate);

test('same resource reserves once before preflight and releases after completion', async () => {
  const jobs = new ResourceJobs(), gate = deferred(); let starts = 0;
  const start = () => { starts++; return gate.promise; };
  const a = jobs.run('weights:v1', start), b = jobs.run('weights:v1', start);
  assert.equal(starts, 1); assert.ok(jobs.controller); gate.resolve('verified');
  assert.deepEqual(await Promise.all([a, b]), ['verified', 'verified']);
  assert.equal(jobs.controller, null);
  assert.equal(await jobs.run('weights:v1', () => 'rechecked'), 'rechecked');
});
test('one caller cancellation does not stop another owner of the same resource', async () => {
  const jobs = new ResourceJobs(), gate = deferred(), wizard = new AbortController(); let controller;
  const settings = jobs.run('weights', value => { controller = value; return gate.promise; });
  const setup = jobs.run('weights', () => assert.fail('duplicate start'), { signal: wizard.signal });
  const cancelled = assert.rejects(setup, { name: 'AbortError' }); wizard.abort(); await cancelled;
  assert.equal(controller.signal.aborted, false); gate.resolve('installed');
  assert.equal(await settings, 'installed');
});
test('last caller cancellation aborts the worker and waits for its cleanup', async () => {
  const jobs = new ResourceJobs(), gate = deferred(), a = new AbortController(), b = new AbortController(); let controller, settled = false;
  const first = jobs.run('weights', value => { controller = value; return gate.promise; }, { signal: a.signal });
  const second = jobs.run('weights', () => assert.fail('duplicate'), { signal: b.signal });
  const rejectFirst = assert.rejects(first, { name: 'AbortError' }), rejectSecond = assert.rejects(second, { name: 'AbortError' }).then(() => { settled = true; });
  a.abort(); await rejectFirst; assert.equal(controller.signal.aborted, false);
  b.abort(); await tick(); assert.equal(controller.signal.aborted, true); assert.equal(settled, false);
  gate.resolve('late success must be ignored'); await rejectSecond; assert.equal(jobs.controller, null);
});
test('cancel and immediate retry wait for old cleanup; old completion cannot unlock new work', async () => {
  const jobs = new ResourceJobs(), old = deferred(), next = deferred(); let starts = 0;
  const a = jobs.run('weights', () => { starts++; return old.promise; }), rejected = assert.rejects(a, /old cancelled/);
  jobs.cancel();
  const b = jobs.run('weights', () => { starts++; return next.promise; });
  await tick(); assert.equal(starts, 1);
  old.reject(Error('old cancelled')); await rejected; await tick(); assert.equal(starts, 2);
  const c = jobs.run('weights', () => assert.fail('old finally cleared new task'));
  next.resolve('new'); assert.deepEqual(await Promise.all([b, c]), ['new', 'new']); assert.equal(jobs.controller, null);
});
test('a retry cancelled while waiting for a draining job never starts', async () => {
  const jobs = new ResourceJobs(), old = deferred(), controller = new AbortController();
  const a = jobs.run('weights', () => old.promise), oldCancelled = assert.rejects(a, { name: 'AbortError' }); jobs.cancel();
  const b = jobs.run('weights', () => assert.fail('cancelled retry'), { signal: controller.signal });
  const rejected = assert.rejects(b, { name: 'AbortError' }); controller.abort(); await rejected;
  old.resolve(); await oldCancelled; await tick(); assert.equal(jobs.controller, null);
});
test('overlapping targets wait for older writers but independent resources remain concurrent', async () => {
  const jobs = new ResourceJobs(), old = deferred(), order = [];
  const a = jobs.run('single', () => { order.push('single'); return old.promise; }, { targets: ['gpt'] });
  const b = jobs.run('pair', () => { order.push('pair'); return 'pair'; }, { targets: ['gpt', 'sovits'] });
  const c = jobs.run('core', () => { order.push('core'); return 'core'; }, { targets: ['bert'] });
  await c; assert.deepEqual(order, ['single', 'core']);
  old.resolve(); await Promise.all([a, b]); assert.deepEqual(order, ['single', 'core', 'pair']);
});
test('failure does not poison a queued overlapping task, and explicit cancel stops queued writers', async () => {
  const jobs = new ResourceJobs(), old = deferred();
  const a = jobs.run('single', () => old.promise, { targets: ['gpt'] }), failed = assert.rejects(a, /failed/);
  const b = jobs.run('pair', () => 'repaired', { targets: ['gpt'] });
  old.reject(Error('failed')); await failed; assert.equal(await b, 'repaired');
  const gate = deferred(), c = jobs.run('single', () => gate.promise, { targets: ['gpt'] }), stopped = assert.rejects(c, { name: 'AbortError' });
  const d = jobs.run('pair', () => assert.fail('cancelled queued writer'), { targets: ['gpt'] }), cancelled = assert.rejects(d, { name: 'AbortError' });
  jobs.cancel(); gate.resolve(); await stopped; await cancelled; assert.equal(jobs.controller, null);
});
test('a second cancel also stops a no-signal retry queued behind old cleanup', async () => {
  const jobs = new ResourceJobs(), old = deferred(); let retryStarts = 0;
  const first = jobs.run('weights', () => old.promise), stopped = assert.rejects(first, { name: 'AbortError' });
  jobs.cancel();
  const retry = jobs.run('weights', () => { retryStarts++; return 'unexpected'; }).then(value => ({ value }), error => ({ error }));
  jobs.cancel(); old.resolve(); await stopped;
  assert.equal((await retry).error?.name, 'AbortError'); assert.equal(retryStarts, 0);
});
test('cancelling a queued overlapping pack releases its unused targets without waiting for another owner', async () => {
  const jobs = new ResourceJobs(), old = deferred(), controller = new AbortController(); let queuedSettled = false, independentStarted = false;
  const first = jobs.run('gpt', () => old.promise, { targets: ['gpt'] });
  const queued = jobs.run('pair', () => assert.fail('cancelled pair started'), { signal: controller.signal, targets: ['gpt', 'sovits'] }).then(() => { queuedSettled = true; }, error => { assert.equal(error.name, 'AbortError'); queuedSettled = true; });
  controller.abort(); await tick();
  const next = jobs.run('sovits', () => { independentStarted = true; }, { targets: ['sovits'] });
  await tick(); const cancelledPromptly = queuedSettled, unusedTargetFreed = independentStarted;
  old.resolve(); await Promise.all([first, queued, next]);
  assert.equal(cancelledPromptly, true); assert.equal(unusedTargetFreed, true);
});
test('cancelling a queued retry does not lose the original draining writer lock', async () => {
  const jobs = new ResourceJobs(), old = deferred(); let latestStarted = false;
  const first = jobs.run('weights', () => old.promise, { targets: ['gpt'] }), stopped = assert.rejects(first, { name: 'AbortError' });
  jobs.cancel();
  const retry = jobs.run('weights', () => assert.fail('cancelled retry started'), { targets: ['gpt'] }), cancelled = assert.rejects(retry, { name: 'AbortError' });
  jobs.cancel(); await cancelled;
  const latest = jobs.run('alias', () => { latestStarted = true; }, { targets: ['gpt'] });
  await tick(); assert.equal(latestStarted, false);
  old.resolve(); await stopped; await latest; assert.equal(latestStarted, true); assert.equal(jobs.controller, null);
});
test('pre-aborted calls and synchronous startup failure leave no reserved job', async () => {
  const jobs = new ResourceJobs(), controller = new AbortController(); controller.abort();
  await assert.rejects(jobs.run('weights', () => assert.fail('aborted start'), { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(jobs.run('weights', () => { throw Error('preflight failed'); }), /preflight failed/);
  assert.equal(jobs.controller, null); assert.equal(await jobs.run('weights', () => 'retry'), 'retry');
});
