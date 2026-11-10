import * as T from 'three';

// A scene-owned, effectively distant moon: camera translation causes no lunar
// parallax, but the fixed sky direction remains stable when the user orbits.
// It stays outside the finite architecture bounds and behind real occluders.
export function addNightSky(api,scene){
 const home=api.cameraPresets?.companion||api.cameraPresets?.photo;
 const eye=new T.Vector3(...(home?.position||[0,2,15])),aim=new T.Vector3(...(home?.target||[0,2,0]));
 const forward=aim.sub(eye).setY(0).normalize();if(forward.lengthSq()<.1)forward.set(0,0,-1);
 const right=new T.Vector3().crossVectors(forward,new T.Vector3(0,1,0)).normalize();
 const direction=forward.multiplyScalar(.86).addScaledVector(right,.3).setY(.23).normalize();
 const uniforms={uVisibility:{value:0},uBrightness:{value:1}};
 const geometry=new T.PlaneGeometry(12.4,12.4);
 const material=new T.ShaderMaterial({name:'sky:bright-cratered-moon',uniforms,transparent:true,depthWrite:false,fog:false,toneMapped:false,
  vertexShader:`varying vec2 vMoonUv;void main(){vMoonUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:/* glsl */`
   varying vec2 vMoonUv;uniform float uVisibility;uniform float uBrightness;
   float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
   float crater(vec2 p,vec2 c,float radius){float r=length(p-c)/radius;return -.14*(1.-smoothstep(.58,.92,r))+.075*exp(-pow((r-.96)*13.,2.));}
   void main(){
    vec2 p=(vMoonUv-.5)*2.2;float r=length(p),aa=max(fwidth(r),.001);
    float disc=1.-smoothstep(1.-aa,1.+aa,r);if(r>1.09)discard;
    float mare=(1.-smoothstep(.22,.59,length((p-vec2(-.23,.25))*vec2(.88,1.3))))*.22;
    mare+=(1.-smoothstep(.16,.38,length(p-vec2(.3,.31))))*.15;
    mare+=(1.-smoothstep(.14,.34,length(p-vec2(-.45,-.17))))*.12;
    float detail=(noise(p*37.)-.5)*.06+(noise(p*13.)-.5)*.08;
    float relief=crater(p,vec2(.23,-.55),.14)+crater(p,vec2(-.52,-.41),.12)+crater(p,vec2(.56,-.13),.095)+crater(p,vec2(-.03,.65),.08);
    float surface=.89-mare+detail+relief-.09*pow(clamp(r,0.,1.),4.);
    vec3 col=vec3(surface)*vec3(1.,.985,.955)*uBrightness;
    float halo=exp(-max(0.,r-1.)*43.)*.045*(1.-disc);
    gl_FragColor=vec4(col,(disc*.99+halo)*uVisibility);
    #include <colorspace_fragment>
   }`,
 });
 const moon=new T.Mesh(geometry,material);moon.name='sky:night-moon';moon.frustumCulled=false;moon.visible=false;moon.renderOrder=3;
 moon.onBeforeRender=(_renderer,_scene,camera)=>{moon.position.copy(camera.position).addScaledVector(direction,180);moon.quaternion.copy(camera.quaternion);moon.updateMatrixWorld();moon.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse,moon.matrixWorld);};
 scene.add(moon);let disposed=false;
 return {moon,direction,
  setClimate(daylight,weather){if(disposed)return;const cloud=T.MathUtils.clamp(weather?.cloud||0,0,1),rain=T.MathUtils.clamp(weather?.rain||0,0,1),fog=T.MathUtils.clamp(weather?.fog||0,0,1);
   uniforms.uVisibility.value=(1-T.MathUtils.smoothstep(daylight.brightness,0,.35))*Math.pow(1-cloud,2)*(1-rain*.85)*(1-fog*.9);moon.visible=uniforms.uVisibility.value>.005;
  },
  dispose(){if(disposed)return;disposed=true;moon.removeFromParent();geometry.dispose();material.dispose();},
 };
}
