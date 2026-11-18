(() => {
  'use strict';
  const debug = new URLSearchParams(location.search).has('debug');
  const canvas = document.querySelector('#model');
  const panel = document.querySelector('#panel');
  const clamp = value => Math.max(-1, Math.min(1, value));

  async function connect(event) {
    if (parent === window || event.source !== parent ||
        !/^(?:null|file:\/\/|http:\/\/127\.0\.0\.1:\d+)$/.test(event.origin) ||
        event.data?.type !== 'yukino-live2d-connect' || event.ports.length !== 1) return;
    window.removeEventListener('message', connect);
    const port = event.ports[0];
    const send = (type, value) => port.postMessage({ type, value });
    try {
      const runtime = window.yukino;
      const parameters = await runtime.ready();
      const { width, height, mask } = runtime.hitMask();
      port.postMessage({ type: 'ready', value: { parameters, width, height, mask } }, [mask.buffer]);
      port.onmessage = ({ data }) => {
        if (data?.type === 'draw') runtime.drawPose(data.value);
        if (data?.type === 'reset') runtime.resetPose();
      };
      canvas.addEventListener('webglcontextlost', () => send('error', 'Live2D 图形上下文已丢失'));
      if (!debug) return;
      canvas.addEventListener('pointermove', event => {
        const rect = canvas.getBoundingClientRect();
        const x = clamp((event.clientX - rect.left) / rect.width * 2 - 1);
        const y = clamp((event.clientY - rect.top) / rect.height * 2 - 1);
        send('gaze', { eyeX: x, eyeY: y, headYaw: x * 9, headPitch: -y * 6 });
      });
      canvas.addEventListener('pointerleave', () => send('gaze', null));
      canvas.addEventListener('dblclick', () => send('reset', null));
      panel.addEventListener('input', () => send('manual', null), { capture: true });
      panel.addEventListener('click', event => {
        if (event.target.tagName === 'BUTTON') send('manual', null);
      }, { capture: true });
    } catch (error) { send('error', error?.message || String(error)); }
  }
  window.addEventListener('message', connect);
})();
