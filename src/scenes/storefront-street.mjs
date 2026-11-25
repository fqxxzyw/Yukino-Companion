import * as T from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';

// A finite carriageway gives the shop a street-scale foreground. Build before
// batching so the granite lengths, iron grates and their slots share draws.
export function oppositeSidewalk(b,{edgeY,edgeZ,paving,curb,iron,halfWidth=30}){
 const depth=8.4;
 b.box([0,edgeY+.071,edgeZ+depth/2],[halfWidth*2,.142,depth],paving);
 for(let x=-halfWidth+.75;x<halfWidth;x+=1.5){
  b.box([x,edgeY+.077,edgeZ],[1.484,.154,.21],curb);
 }
 for(const x of [-6.7,2.55,9.8]){
  b.box([x,edgeY+.008,edgeZ-.21],[.56,.016,.27],iron);
  for(let slot=0;slot<8;slot++){
   b.box([x-.239+slot*.068,edgeY+.019,edgeZ-.21],[.028,.012,.24],curb);
  }
 }
}

export function entranceLight(b,from,to,{color='#ffdfad',intensity=30,range=6}={}){
 const light=new T.SpotLight(color,intensity,range,.64,.78,2);
 light.position.fromArray(from);light.target.position.fromArray(to);
 b.root.add(light,light.target);b.lamps.push({light,intensity,day:.08,night:1});
}

// A shallow, broken swale along the kerb. One small mirror capture supplies
// the current glass, signs, weather sky and their actual moving reflections.
export function gutterReflection(b,api,{x,y,z}){
 const base=Reflector.ReflectorShader;
 const shader={
  name:'storefront-gutter-water',
  uniforms:{...base.uniforms,wetness:{value:0},phase:{value:0}},
  vertexShader:base.vertexShader
   .replace('void main()', 'varying vec2 bank;\nvoid main()')
   .replace('vUv = textureMatrix', 'bank=position.xy;\nvUv = textureMatrix'),
  fragmentShader:`uniform sampler2D tDiffuse;
   uniform float wetness,phase;
   varying vec4 vUv;
   varying vec2 bank;
   #include <logdepthbuf_pars_fragment>
   void main(){
    #include <logdepthbuf_fragment>
    vec2 p=bank;
    p.y+=.07*sin(p.x*3.7)+.06*sin(p.x*1.3);
    float d=min(length((p-vec2(-4.4,.21))/vec2(3.9,.39)),
                length((p-vec2(1.1,-.10))/vec2(2.65,.61)));
    d=min(d,length((p-vec2(5.9,.26))/vec2(1.92,.31)));
    float edge=max(fwidth(d),.06);
    float cover=1.-smoothstep(wetness-edge,wetness+edge,d);
    if(cover<.015)discard;
    vec2 wave=vec2(sin(bank.x*4.7+phase*1.8),cos(bank.y*24.+phase*2.4))*.00075;
    vec3 reflected=texture2D(tDiffuse,vUv.xy/vUv.w+wave).rgb;
    gl_FragColor=vec4(reflected,.47*wetness*cover);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 };
 const water=new Reflector(b.own(new T.PlaneGeometry(18,1.9)),{shader,textureWidth:384,textureHeight:192,multisample:0,clipBias:.002});
 water.name='street:rainwater-at-curb';water.rotation.x=-Math.PI/2;water.position.set(x,y,z);
 water.material.transparent=true;water.material.depthWrite=false;water.visible=false;
 api.root.add(water);
 b.animations.push(time=>{water.material.uniforms.phase.value=time;});
 function setWeather(weather){
  const rain=T.MathUtils.clamp(weather?.rain||0,0,1);
  water.visible=rain>.035;water.material.uniforms.wetness.value=rain;
 }
 const dispose=api.dispose;
 api.setWeather=setWeather;
 api.setSunlight=(_direction,_brightness,_cloud,_rayWindow,weather)=>setWeather(weather);
 api.dispose=()=>{if(!b.disposed)water.dispose();dispose();};
}
