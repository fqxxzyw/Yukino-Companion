export const STREAM_LEVEL=.16;
export const STREAM_BANK_RISE=1.58;
export const STREAM_BANK_RUN=2.25;
export const STREAM_START=-42;
export const STREAM_END=30;
// The miniature finishes at STREAM_END. Its downstream background turns away
// behind a raised meadow. Petals still recycle within the finite play area.
export const DOWNSTREAM_END=122;
export function streamCenter(z){
 const near=.45+1.15*Math.sin(z*.075)+.42*Math.sin(z*.19+.6);
 if(z<=STREAM_END)return near;
 const t=Math.min(1,(z-STREAM_END)/55);
 return near+26*t*t*(3-2*t)+Math.max(0,z-85)*.24;
}
export const streamHalfWidth=z=>2.35+.28*Math.sin(z*.12+1.2);
export const streamBedY=(x,z)=>STREAM_LEVEL-.9-.24*(1-Math.min(1,Math.abs(x-streamCenter(z))/streamHalfWidth(z)));
export const pathCenter=z=>streamCenter(z)-streamHalfWidth(z)-3.35;
// The first tree owns the old spreading crown. Slender orchard trees stand
// further upstream and across the water, outside its main silhouette.
export const STREAM_HERO_TREES=Object.freeze([
 {x:-5.95,z:.4,height:6.55,spread:6.55},
 {x:-8.9,z:-15.5,height:4.35,spread:2.30},
 {x:6.8,z:-20.8,height:4.8,spread:2.52},
]);
