// Process-owned, in-flight operations. Callers own subscriptions, not the shared
// AbortController. Cancelling setup only releases its subscriptions; a settings
// download continues while it still has an owner. Disk recovery stays in the
// existing downloaders; this registry deliberately does not claim persistence.
function abortError() { const error = Error('资源准备已取消'); error.name = 'AbortError'; return error; }
function waitFor(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
class ResourceJobs {
  constructor() { this.jobs = new Map(); this.active = new Set(); }
  get controller() { return this.active.values().next().value?.controller || null; }
  run(key, start, { signal, targets = [] } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    const current = this.jobs.get(key);
    if (current && !current.controller.signal.aborted) return this.subscribe(current, signal);
    // Register retries immediately so another cancel can find them, but retain
    // draining predecessors as blockers until their writers have really closed.
    const ownedTargets = new Set(targets);
    // Distinct packs may write the same weights. Wait for older writers, then
    // let the original hash checks reuse their results; unrelated files run on.
    const blockers = [...this.active].filter(job => job.key === key || [...ownedTargets].some(target => job.targets.has(target))).map(job => job.settled);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const job = { key, controller: new AbortController(), targets: ownedTargets, consumers: new Set(), promise, settled: promise.then(() => {}, () => {}), finished: false };
    this.jobs.set(key, job); this.active.add(job);
    const result = this.subscribe(job, signal);
    const finish = (callback, value) => {
      job.finished = true; this.active.delete(job);
      if (this.jobs.get(key) === job) this.jobs.delete(key);
      callback(value);
    };
    const execute = () => { job.controller.signal.throwIfAborted(); return start(job.controller); };
    try {
      // Queued work owns no file handles yet: cancellation must free its unused
      // targets immediately, without waiting for an unrelated owner's download.
      const operation = blockers.length ? waitFor(Promise.all(blockers), job.controller.signal).then(execute) : execute();
      Promise.resolve(operation).then(value => {
        if (job.controller.signal.aborted) finish(reject, abortError()); else finish(resolve, value);
      }, error => finish(reject, error));
    } catch (error) { finish(reject, error); }
    return result;
  }
  subscribe(job, signal) {
    return new Promise((resolve, reject) => {
      const owner = {}; let cancelled = false;
      job.consumers.add(owner);
      const release = () => { signal?.removeEventListener('abort', abort); job.consumers.delete(owner); };
      const abort = () => {
        cancelled = true; release();
        if (!job.finished && !job.consumers.size) {
          job.controller.abort();
          // The last owner waits for file handles/workers to drain, so a new
          // setup session cannot receive late cleanup/progress from this one.
          job.settled.then(() => reject(abortError()));
        } else reject(abortError());
      };
      signal?.addEventListener('abort', abort, { once: true });
      job.promise.then(value => { release(); if (!cancelled) resolve(value); }, error => { release(); if (!cancelled) reject(error); });
    });
  }
  // An explicit resource-page cancel or app shutdown stops the resource itself.
  cancel() { for (const job of this.active) job.controller.abort(); }
}
module.exports = { ResourceJobs };
