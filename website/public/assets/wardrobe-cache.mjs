// Cache only encoded same-origin wardrobe bytes. One video element decodes the
// current turn; inactive outfits never keep a decoder or high-res bitmap alive.
export function createWardrobeCache({budget = 24 * 1024 * 1024, lanes} = {}) {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0, order = 0;
  // Reserve both image slots for the comparison, independently of the movie.
  const caps=lanes||{image:2,video:1};
  const active={image:0,video:0};
  const valid = /^\/assets\/wardrobe\/[-\w]+\.(webp|webm)$/i;
  const maxAssetBytes = 4 * 1024 * 1024;

  function peek(path) {
    const entry = entries.get(path);
    if (!entry) return null;
    entries.delete(path); entries.set(path,entry);
    return entry.url;
  }

  function drain() {
    for (;;) {
      const job = [...pending.values()].filter(job=>!job.started&&active[job.lane]<caps[job.lane])
        .sort((a,b)=>b.priority-a.priority || b.order-a.order)[0];
      if (!job) return;
      job.started=true;
      active[job.lane]++;
      void (async()=>{
        const signal=AbortSignal.timeout(11000);
        let url=null;
        try {
          const response=await fetch(job.path,{mode:'same-origin',credentials:'same-origin',redirect:'error',signal});
          const length=Number(response.headers.get('content-length'));
          if (response.status!==200 || length>maxAssetBytes) return;
          const type=job.lane==='video'?'video/webm':'image/webp';
          if (!response.headers.get('content-type')?.split(';')[0].trim().startsWith(type)) return;
          const blob=await response.blob();
          if (!blob.size || blob.size>Math.min(maxAssetBytes,budget)) return;
          while (bytes+blob.size>budget && entries.size) {
            const [key,entry]=entries.entries().next().value;
            entries.delete(key); bytes-=entry.size;
            URL.revokeObjectURL(entry.url);
          }
          url=URL.createObjectURL(blob);
          entries.set(job.path,{url,size:blob.size});
          bytes+=blob.size;
        } catch { /* A direct source remains available on request failure. */ }
        finally {
          pending.delete(job.path); active[job.lane]--;
          job.resolve(url); drain();
        }
      })();
    }
  }

  function get(path, priority=1) {
    if (!path || !valid.test(path)) return Promise.resolve(null);
    const ready=peek(path);
    if (ready) return Promise.resolve(ready);
    const job=pending.get(path);
    if (job) {
      job.priority=Math.max(job.priority,priority);
      job.order=++order;
      return job.promise;
    }
    const next={path,priority,order:++order,started:false,lane:path.endsWith('.webm')?'video':'image'};
    next.promise=new Promise(resolve=>{next.resolve=resolve;});
    pending.set(path,next);
    queueMicrotask(drain);
    return next.promise;
  }

  return {get,peek};
}
