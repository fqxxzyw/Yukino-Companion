import * as THREE from 'three';

// One small, deterministic equirectangular sky per active scene. Clouds are
// part of the distant sky, never geometry that can intersect architecture.
const W=512,H=256;
const smooth=t=>t*t*(3-2*t);
const hash=(x,y)=>{let n=Math.imul(x,374761393)+Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
function noise(x,y,period){
 const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(x-ix),fy=smooth(y-iy),wrap=n=>(n%period+period)%period;
 const a=hash(wrap(ix),iy),b=hash(wrap(ix+1),iy),c=hash(wrap(ix),iy+1),d=hash(wrap(ix+1),iy+1);
 return (a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy;
}
const cloudField=(()=>{const result=new Float32Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 const u=x/W,v=y/H;
 result[y*W+x]=noise(u*8,v*8,8)*.55+noise(u*16,v*16,16)*.29+noise(u*32,v*32,32)*.16;
}return result;})();
const lerp=(a,b,t)=>a+(b-a)*t;

export function createDaySky(){
 const pixels=new Uint8Array(W*H*4),texture=new THREE.DataTexture(pixels,W,H);
 texture.name='weather:day-sky-clouds';texture.mapping=THREE.EquirectangularReflectionMapping;
 texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=texture.magFilter=THREE.LinearFilter;
 let key='';
 function update(daylight,weather){
  const cloud=THREE.MathUtils.clamp(weather?.cloud||0,0,1),brightness=daylight.brightness;
  const next=[Math.round(cloud*16),Math.round(brightness*16),daylight.twilight,daylight.hour<12].join(':');
  if(next===key)return;key=next;
  // Pale horizon, saturated zenith, and soft irregular cumulus. Overcast
  // shifts both sky and cloud towards grey without changing the user's time.
  for(let y=0;y<H;y++){
   const elevation=Math.max(0,(y/H-.45)/.55),gradient=Math.pow(elevation,.65),warm=daylight.twilight&&!daylight.night?1-brightness:0;
   const sky=[lerp(198,91,gradient),lerp(225,170,gradient),lerp(243,224,gradient)];
   sky[0]=lerp(sky[0],218,warm*.55);sky[1]=lerp(sky[1],170,warm*.4);sky[2]=lerp(sky[2],158,warm*.32);
   const limit=.48+elevation*.05-cloud*.11;
   for(let x=0;x<W;x++){
    const n=cloudField[y*W+x],altitude=Math.min(1,Math.max(0,(elevation+.04)*9));
    const amount=smooth(Math.min(1,Math.max(0,(n-limit)*9)))*altitude;
    const k=(y*W+x)*4,grey=lerp(248,181,cloud*.75);
    for(let c=0;c<3;c++)pixels[k+c]=Math.round(THREE.MathUtils.clamp(lerp(lerp(sky[c],192,cloud*.46),grey,amount)*(.26+.74*brightness),0,255));
    pixels[k+3]=255;
   }
  }
  texture.needsUpdate=true;
 }
 return {texture,update,dispose:()=>texture.dispose()};
}
