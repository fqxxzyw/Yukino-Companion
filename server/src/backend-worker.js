// Temporary backend-only entry point. The currently deployed Worker serves a
// Hello World placeholder outside /api; retain it until the website is ready.
// All API and scheduled behavior comes from the normal full-site Worker.
import fullWorker from './worker.js';

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return fullWorker.fetch(request, env, ctx);
    }
    return new Response('Hello World!', {
      status: 200,
      headers: {'content-type': 'text/plain;charset=UTF-8'},
    });
  },
  scheduled: fullWorker.scheduled,
};
