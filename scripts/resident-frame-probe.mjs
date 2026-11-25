/** Installed in the actual Electron renderer before its Three.js loops start. */
export function attachResidentProbe() {
  if (window.yukinoResidentProbe) return;
  let sampling = false, rows = [], currentRow, draws, activeTimers;
  let gpuSamples, windowEvents, droppedWindowEvents;
  const contexts = new Map();
  const originalRaf = window.requestAnimationFrame.bind(window);
  function windowEvent(type) {
    if (!sampling) return;
    if (windowEvents.length === 64) {
      droppedWindowEvents++;
      return;
    }
    windowEvents.push({type, t: performance.now(), hidden: document.hidden, focused: document.hasFocus()});
  }
  document.addEventListener('visibilitychange', () => windowEvent('visibilitychange'));
  window.addEventListener('focus', () => windowEvent('focus'));
  window.addEventListener('blur', () => windowEvent('blur'));
  function getContext(gl) {
    if (contexts.has(gl)) return contexts.get(gl);
    const canvas = gl.canvas;
    const role = canvas.closest?.('.character-model-host') ? 'actor'
      : canvas.closest?.('.environment-backdrop-canvas') ? 'scene' : null;
    if (!role) return null;
    const ext = gl.createQuery && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const meter = {gl, role, ext, pending: [], callbacks: 0, discarded: 0};
    contexts.set(gl, meter);
    return meter;
  }
  function collect(meter) {
    const {gl, ext, pending, role} = meter;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length && (disjoint || gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE))) {
      const query = pending.shift();
      if (disjoint) meter.discarded++;
      else gpuSamples[role].push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
    return disjoint;
  }
  function sample(meter) {
    if (!meter.ext || ++meter.callbacks % 17 !== 0) return;
    const {gl, ext} = meter;
    if (collect(meter) || meter.pending.length >= 5 || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
    const query = gl.createQuery();
    if (!query) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    activeTimers.push({meter, query});
  }
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    for (const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
      if (!Object.hasOwn(ctor.prototype, method)) continue;
      const original = ctor.prototype[method];
      ctor.prototype[method] = function(...args) {
        if (sampling && draws) {
          const meter = getContext(this);
          if (meter) {
            if (draws[meter.role] === 0) sample(meter);
            draws[meter.role]++;
          }
        }
        return original.apply(this, args);
      };
    }
  }
  window.requestAnimationFrame = callback => originalRaf(timestamp => {
    if (!sampling) return callback(timestamp);
    if (!currentRow || currentRow.t !== timestamp) {
      currentRow = {t: timestamp, actor: 0, scene: 0, actorCpu: 0, sceneCpu: 0};
      rows.push(currentRow);
    }
    const start = performance.now();
    draws = {actor: 0, scene: 0};
    activeTimers = [];
    try { return callback(timestamp); }
    finally {
      for (const {meter, query} of activeTimers) {
        meter.gl.endQuery(meter.ext.TIME_ELAPSED_EXT);
        meter.pending.push(query);
      }
      const cost = performance.now() - start;
      for (const role of ['actor','scene']) if (draws[role]) {
        currentRow[role] += draws[role];
        currentRow[role + 'Cpu'] += cost;
      }
      draws = null;
    }
  });
  const beat = () => { if (sampling) window.requestAnimationFrame(beat); };
  function drain() { const chunk = rows; rows = []; return chunk; }
  window.yukinoResidentProbe = {
    start() {
      currentRow = null;
      rows = [];
      gpuSamples = {actor: [], scene: []};
      windowEvents = [];
      droppedWindowEvents = 0;
      for (const meter of contexts.values()) {
        for (const query of meter.pending) meter.gl.deleteQuery(query);
        meter.pending = [];
        meter.discarded = 0;
        meter.callbacks = 0;
      }
      sampling = true;
      windowEvent('start');
      window.requestAnimationFrame(beat);
      return performance.now();
    },
    drain,
    stop() {
      windowEvent('stop');
      sampling = false;
      const metadata = [];
      for (const meter of contexts.values()) {
        const {gl, ext, role} = meter;
        if (ext) collect(meter);
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        metadata.push({role, renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
          width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
          available: Boolean(ext), disjointDiscarded: meter.discarded, pendingAtStop: meter.pending.length});
      }
      return {tail: drain(), gpuSamples, contexts: metadata, time: performance.now(), windowEvents, droppedWindowEvents};
    },
  };
}
