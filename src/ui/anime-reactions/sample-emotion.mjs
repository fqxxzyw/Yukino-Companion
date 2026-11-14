// x/y offsets in head widths (+x screen right, +y up), rotation in degrees.
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const smooth=(a,b,x)=>{const q=clamp((x-a)/(b-a));return q*q*(3-2*q);};
const TAU=2*Math.PI;
export function sampleEmotion(preset, elapsed, strength=1) {
  if (!preset || !Number.isFinite(elapsed) || !Number.isFinite(strength) ||
      !Number.isFinite(preset.seconds) || preset.seconds<=0) throw new TypeError('Invalid emotion input');
  const d=preset.seconds,t=clamp(elapsed,0,d),p=t/d,w=clamp(strength);
  const alpha=smooth(0,.35,t)*(1-smooth(d-.55,d,t))*w;
  const face=Object.fromEntries(Object.entries(preset.channels).map(([n,v])=>[n,v*alpha]));
  const state=(name,x=0,y=0,scale=1,rotation=0)=>({name,opacity:alpha,x,y,scale,rotation});
  let layers=[];
  if(preset.icon) {
    const o=preset.iconTiming??{};
    const pop=1+0.24*Math.sin(Math.PI*smooth(0.02,0.24,p));
    switch(preset.motion) {
      case 'heart_float': {
        const peak=o.popSeconds*.57;
        const scale=t<peak?.65+.47*smooth(0,peak,t):1.12-.12*smooth(peak,o.popSeconds,t);
        layers=[state(preset.icon,0,o.rise*smooth(o.popSeconds,d,t),scale)];break;
      }
      case 'heart_split': {
        if(t<o.splitAt) layers=[state(preset.icon)];
        else {
          const q=smooth(o.splitAt,o.splitAt+o.splitSeconds,t);
          const fall=-o.fall*smooth(o.splitAt+o.splitSeconds,d,t);
          layers=[state('broken-heart-left',-o.spread*q,fall,1,-o.rotation*q),
                  state('broken-heart-right',o.spread*q,fall,1,o.rotation*q)];
        }break;
      }
      case 'sway': layers=[state(preset.icon,0,0,1,7*Math.sin(p*TAU*2)*alpha)];break;
      case 'drop': layers=[state(preset.icon,0,-.20*smooth(.10,.70,p))];break;
      case 'pulse': layers=[state(preset.icon,0,0,1+.10*Math.pow(Math.sin(p*TAU*1.5),2)*alpha)];break;
      default: layers=[state(preset.icon,0,0,pop)];
    }
  }
  return {face,icon:layers.length===1?layers[0]:null,icons:layers,done:elapsed>=d};
}
