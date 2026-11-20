import * as THREE from 'three';

// Each cloud occupies a world-space volume hundreds of metres across. Integrate
// density through the volume towards the camera and back towards the scene sun.
// No cloud images, lookup textures, or camera-facing cards are involved.
const cloudField = /* glsl */ `
  uniform float seed, drift, cover;
  uniform vec4 cells[16];
  float hash3(vec3 p) {
    p = fract(p * vec3(.1031,.1030,.0973));
    p += dot(p,p.yxz+33.33);
    return fract((p.x+p.y)*p.z);
  }
  float noise3(vec3 p) {
    vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),
                   mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),
                   mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  // Smoothly join neighbouring thermals. The radial gradient supplies the
  // broad rounded light transition; finer vapour is restricted to the shell.
  float thermal(vec3 p,out vec3 facing) {
    vec3 q=p*vec3(1.,.80,.68);
    // Air first condenses along a level shelf. It connects the rising
    // thermals at their feet while leaving the top silhouette broken.
    vec3 shelf=(q-vec3(.025,-.395,.015))*vec3(.38,1.65,.92);
    float shelfDistance=max(.0001,length(shelf));
    float mass=.269-shelfDistance;
    facing=normalize(shelf*vec3(.38,1.65,.92)+vec3(.00001));
    for (int i=0;i<16;i++){
      vec3 delta=q-cells[i].xyz;
      float dist=max(.0001,length(delta));
      float r=cells[i].w-dist;
      float h=clamp(.5+.5*(r-mass)/.055,0.,1.);
      mass=mix(mass,r,h)+.055*h*(1.-h);
      facing=mix(facing,delta/dist,h);
    }
    return mass;
  }
  // Fold three scales of advected vapour around the larger thermal.
  float vapour(vec3 p){
    vec3 n=p*vec3(7.6,4.9,4.8)+vec3(seed+drift,3.8+seed*.57,-drift*.26);
    vec3 warp=vec3(noise3(n*.56+11.),noise3(n*.61+17.),noise3(n*.53))*1.15;
    n+=warp;
    return (noise3(n)-.50)*.232+(noise3(n*2.24+15.)-.5)*.092
         +(noise3(n*4.8+2.9)-.5)*.038;
  }
  float density(vec3 p,float mass) {
    if(mass < -.21)return 0.;
    float curls=vapour(p);
    float edge=mass+curls;
    float core=smoothstep(-.013,.083,edge);
    float air=mix(.35,1.,smoothstep(-.005,.105,edge));
    return core*air*smoothstep(-.65,-.56+curls*.36,p.y);
  }
  float lightDensity(vec3 p) {
    vec3 normal;
    float mass=thermal(p,normal);
    return density(p,mass);
  }`;

const skyVertex = /* glsl */ `
  uniform mat4 inverseProjection, cameraRotation;
  varying vec3 sightline;
  void main(){
    sightline=mat3(cameraRotation)*(inverseProjection*vec4(position.xy,1.,1.)).xyz;
    gl_Position=vec4(position.xy,1.,1.);
  }`;
const skyFragment = /* glsl */ `
  uniform vec3 sunlight;
  uniform float dusk,cover,haze,daylight,cel;
  varying vec3 sightline;
  void main(){
    vec3 ray=normalize(sightline);
    float height=1.-exp(-max(ray.y,0.)*4.1);
    vec3 zenith=mix(vec3(.018,.255,.67),vec3(.012,.195,.49),cel);
    vec3 horizon=mix(vec3(.31,.72,.91),vec3(.30,.71,.85),cel);
    zenith=mix(zenith,vec3(.20,.27,.49),dusk*.85);
    horizon=mix(horizon,vec3(.98,.65,.43),dusk);
    vec3 sky=mix(horizon,zenith,height);
    // Compress the bright marine horizon into the lowest few degrees.
    sky=mix(sky,vec3(.022,.250,.60),.22*smoothstep(.08,.38,ray.y)*(1.-dusk));
    sky=mix(sky,vec3(.37,.46,.54),cover*(.61+.20*height));
    sky=mix(sky,horizon,haze*.72);
    float sun=max(0.,dot(ray,sunlight));
    sky+=vec3(1.,.84,.57)*(1.-cover)*(smoothstep(.99991,.99997,sun)+.15*pow(sun,72.));
    gl_FragColor=vec4(sky*daylight,1.);
    #include <colorspace_fragment>
  }`;

const volumeVertex = /* glsl */ `
  varying vec3 entryRay;
  uniform vec3 localEye;
  void main(){
    entryRay=position-localEye;
    vec4 clip=projectionMatrix*modelViewMatrix*vec4(position,1.);
    clip.z=clip.w*.999999;
    gl_Position=clip;
  }`;
const volumeFragment = /* glsl */ `
  ${cloudField}
  uniform vec3 localEye, localSun;
  uniform float dusk, haze, daylight, cel;
  varying vec3 entryRay;
  void main(){
    vec3 ray=normalize(entryRay);
    vec3 inv=1./(sign(ray)*max(abs(ray),vec3(.000001))+vec3(.0000001));
    vec3 a=(-1.-localEye)*inv,b=(1.-localEye)*inv;
    vec3 lo=min(a,b),hi=max(a,b);
    float front=max(max(lo.x,lo.y),max(lo.z,0.));
    float back=min(min(hi.x,hi.y),hi.z);
    if(back<=front) discard;
    float stepSize=(back-front)/32.;
    vec3 pos=localEye+ray*(front+stepSize*.5);
    vec3 shade=mix(vec3(.32,.53,.68),vec3(.22,.44,.62),cel);
    vec3 sunlit=mix(vec3(.99,.97,.88),vec3(1.,.971,.85),cel);
    shade=mix(shade,vec3(.34,.30,.47),dusk*.76);
    sunlit=mix(sunlit,vec3(1.0,.65,.36),dusk*.88);
    shade=mix(shade,vec3(.31,.38,.47),cover*.76);
    sunlit=mix(sunlit,vec3(.76,.79,.80),cover*.83);
    float trans=1.; vec3 scattering=vec3(0.);
    for(int i=0;i<32;i++){
      vec3 face; float mass=thermal(pos,face);
      float d=density(pos,mass);
      if(d>.001){
        float opticalDepth=.42*lightDensity(pos+localSun*.085)+.53*lightDensity(pos+localSun*.23)+.47*lightDensity(pos+localSun*.46);
        float transmission=exp(-opticalDepth*1.82);
        float roundness=clamp(dot(normalize(face+vec3(.0001)),localSun)*.49+.51,0.,1.);
        float fill=smoothstep(-.57,.62,pos.y);
        float light=clamp(.12*fill+.75*transmission+.25*roundness-.067,0.,1.);
        float illustrated=.28*smoothstep(.11,.32,light)+.43*smoothstep(.32,.62,light)
                         +.29*smoothstep(.61,.86,light);
        light=mix(light,illustrated,cel*.54);
        vec3 color=mix(shade,sunlit,light);
        float alpha=1.-exp(-d*stepSize*13.8);
        scattering+=trans*alpha*color;
        trans*=1.-alpha;
        if(trans<.012)break;
      }
      pos+=ray*stepSize;
    }
    float opacity=1.-trans;
    if(opacity<.006)discard;
    vec3 color=scattering/opacity;
    color=mix(color,mix(vec3(.62,.81,.87),vec3(.89,.61,.46),dusk),.06+haze*.50);
    gl_FragColor=vec4(color*daylight,opacity);
    #include <colorspace_fragment>
  }`;

// Angle around the horizon, distance, width, height, depth and cloud-base altitude.
const banks=[
  [-162,1750,650,200,260,42],[-124,1240,420,205,225,52],
  [-79,1500,550,320,285,65],[-45,1250,430,310,240,48],
  [-24,1910,515,195,260,55],[22,1500,497,287,270,75],
  [60,1950,610,169,245,45],[90,1260,415,348,255,77],
  [134,1700,570,220,245,38],[169,1310,355,158,216,45],
  // Low, separated banks sit beyond the tall convection; all are real volumes.
  [-6,2860,655,85,199,42],[52,2640,490,106,267,56],[-53,2640,570,108,225,55],
  [-112,3000,600,97,218,55],[111,2850,505,88,214,49],[176,3270,710,105,225,43],
];

export function createDaySky(scene) {
  const group=new THREE.Group();
  group.name='weather:procedural-cumulus';
  const common={
    sunlight:{value:new THREE.Vector3(1,1,0).normalize()},dusk:{value:0},
    cover:{value:0},haze:{value:0},daylight:{value:1},cel:{value:0},drift:{value:0},
  };
  const skyGeometry=new THREE.BufferGeometry();
  skyGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const skyUniforms={...common,cameraRotation:{value:new THREE.Matrix4()},inverseProjection:{value:new THREE.Matrix4()}};
  const gradient=new THREE.Mesh(skyGeometry,new THREE.ShaderMaterial({
    uniforms:skyUniforms,vertexShader:skyVertex,fragmentShader:skyFragment,
    depthTest:false,depthWrite:false,toneMapped:false,
  }));
  gradient.name='weather:atmosphere';
  gradient.frustumCulled=false; gradient.renderOrder=-100000;
  gradient.onBeforeRender=(_renderer,_scene,camera)=>{
    skyUniforms.cameraRotation.value.copy(camera.matrixWorld);
    skyUniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
  };
  group.add(gradient);
  const volume=new THREE.BoxGeometry(2,2,2);
  const inverse=new THREE.Matrix4(),linear=new THREE.Matrix3();
  const clouds=banks.map(([bearing,distance,width,height,depth,base],i)=>{
    const azimuth=THREE.MathUtils.degToRad(bearing);
    const seed=i*1.73+2.1;
    // Wide shoulders share a lower base; rising convection is off-centre.
    const crown=.37*Math.sin(seed*1.73);
    const crownHeight=.23+.095*Math.cos(seed*.8);
    const cells=Array.from({length:16},(_,j)=>{
      if(j<7){
        const x=(j-3)*.199;
        const lift=.30*Math.exp(-Math.pow((x-crown)/(.25+.08*Math.cos(seed)),2));
        return new THREE.Vector4(x,-.31+lift+.075*Math.sin(j*4.1+seed),.18*Math.sin(j*2.1+seed),.244+.052*Math.sin(j*2.8+seed));
      }
      if(j===7)return new THREE.Vector4(crown,crownHeight,-.02,.245);
      const k=j-8,t=k/7;
      const x=crown+(t-.5)*.95;
      const shoulder=1.-Math.min(1,Math.abs(t-.44)*1.87);
      return new THREE.Vector4(x,-.25+shoulder*(.32+crownHeight*.61)+.054*Math.sin(k*2.7+seed),
        .206+.123*Math.cos(k*1.9+seed),.136+.059*Math.cos(k+seed));
    });
    const uniforms={...common,seed:{value:seed},cells:{value:cells},
      localEye:{value:new THREE.Vector3()},localSun:{value:new THREE.Vector3()}};
    const material=new THREE.ShaderMaterial({uniforms,vertexShader:volumeVertex,fragmentShader:volumeFragment,
      side:THREE.BackSide,transparent:true,depthWrite:false,toneMapped:false});
    const bank=new THREE.Mesh(volume,material);
    bank.name='weather:cumulus-bank-'+i;
    bank.position.set(Math.sin(azimuth)*distance,base+height*.66,-Math.cos(azimuth)*distance);
    bank.scale.set(width,height,depth);bank.rotation.y=-azimuth;
    bank.frustumCulled=false;bank.renderOrder=-1000-Math.round(distance);
    bank.onBeforeRender=(_renderer,_scene,camera)=>{
      inverse.copy(bank.matrixWorld).invert();
      uniforms.localEye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
      uniforms.localSun.value.copy(common.sunlight.value).applyMatrix3(linear.setFromMatrix4(inverse)).normalize();
    };
    group.add(bank);return bank;
  });
  group.visible=false;scene.add(group);
  let wind=.35;
  return {
    update(light,weather,direction,painted){
      group.visible=!light.night;
      common.sunlight.value.copy(direction??new THREE.Vector3(...light.sun.position)).normalize();
      common.cel.value=Number(painted);
      common.dusk.value=THREE.MathUtils.smoothstep(2.7-light.sun.intensity,0,1.35);
      common.cover.value=Math.min(1,(weather?.cloud||0)*.72+(weather?.rain||0)*.45);
      common.haze.value=Math.min(1,(weather?.fog||0)+(weather?.snow||0)*.6);
      common.daylight.value=.30+.70*light.brightness;
      wind=.35+Math.max(0,weather?.wind||0);
    },
    advance(dt){if(group.visible&&Number.isFinite(dt))common.drift.value+=Math.min(dt,.1)*wind*.046;},
    dispose(){group.removeFromParent();skyGeometry.dispose();gradient.material.dispose();volume.dispose();for(const cloud of clouds)cloud.material.dispose();},
  };
}
