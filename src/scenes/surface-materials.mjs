import * as THREE from 'three';

// Dimensions are authored in metres. Detail fades below a pixel instead of
// turning distant masonry into sparkling noise. No screen-space colour filter.
const profiles={
 plaster:[.88,0,.055,.0015,24], stone:[.87,0,.12,.005,16],
 paving:[.86,0,.1,.005,19], asphalt:[.94,0,.17,.006,44],
 wood:[.68,0,.14,.003,8], bark:[.98,0,.18,.009,7],
 metal:[.34,.82,.025,.0003,70], paint:[.64,0,.025,.0006,36],
 leaf:[.91,0,.035,.0008,18], soil:[1,0,.16,.008,20],
 paper:[.94,0,.02,.0003,40], glass:[.14,0,0,0,1],
 redPanel:[.88,0,.075,.002,24],
 bamboo:[.98,0,.17,.003,55],
 forestPath:[.97,0,.34,.018,32],
 shopTile:[.86,0,.1,.0018,40], vermilion:[.86,0,.13,.0025,25],
 moss:[1,0,.28,.008,22],
};

export function surfaceProfile(material,names=''){
 const name=`${material.name} ${material.map?.name||''} ${names}`.toLowerCase();
 if(/bamboo:culm/.test(name))return 'bamboo';
 if(/asphalt:forest-aggregate/.test(name))return 'forestPath';
 if(/wall:ramen-tile/.test(name))return 'shopTile';
 if(/wood:vermilion/.test(name))return 'vermilion';
 if(/mossy-bank/.test(name))return 'moss';
 // Painted steel and aluminium keep the optical response of their coating.
 // A semantic metal object name must not turn its paint into bare shiny metal.
 if(/^paint:/.test(material.name))return 'paint';
 if(/glass|glazing|balustrade/.test(name)&&!/(frame|metal|bulb|lamp|shadow)/.test(material.name))return 'glass';
 if(/leaf|leaves|foliage|hedge|shrub|fern|sasa|grass|lawn|canopy/.test(name))return 'leaf';
 if(/bark|trunk|twig|branch|mossy.limb/.test(name))return 'bark';
 if(/soil|terrain|earth/.test(name))return 'soil';
 if(/asphalt|road$/.test(name))return 'asphalt';
 if(/paper|pages|book.cover|book.spine|folder|chalk|eraser/.test(name))return 'paper';
 if(/wood|timber|boards|desk.top|desk:top|chair:seat|shelf|cabinet|bench|door.panel/.test(name))return 'wood';
 if(/railing|metal|mullion|pipe|handle|hinge|steel|iron|leg|frame/.test(name))return material.metalness>.3?'metal':'paint';
 if(/paving|paver|forecourt|sidewalk|plaza|path|floor|stairs|steps|nosing/.test(name))return 'paving';
 if(/stone|concrete|curb|plinth|coping|slab|base|gravel|rock/.test(name))return 'stone';
 if(/stucco|wall|ceiling|tower|trim|soffit|cheek|roof|column|pier/.test(name))return 'plaster';
 if(material.metalness>.45)return 'metal';
 // Anonymous supplied batches keep their original palette. Infer only a modest
 // finish; semantic named materials take precedence over colour.
 const hsl={};material.color?.getHSL(hsl);
 if(hsl.h>.18&&hsl.h<.43&&hsl.s>.12)return 'leaf';
 if(hsl.h>.045&&hsl.h<.14&&hsl.s>.18&&hsl.l<.48)return 'wood';
 return 'paint';
}

const common=/* glsl */`
varying vec3 vSurfaceWorld;
uniform float uSurfaceRain;
uniform float uSurfaceSnow;
uniform float uSurfaceExposure;
float surfaceHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float surfaceNoise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(surfaceHash(i),surfaceHash(i+vec3(1,0,0)),f.x),mix(surfaceHash(i+vec3(0,1,0)),surfaceHash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(surfaceHash(i+vec3(0,0,1)),surfaceHash(i+vec3(1,0,1)),f.x),mix(surfaceHash(i+vec3(0,1,1)),surfaceHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float surfaceFilteredNoise(vec3 p){float footprint=max(length(dFdx(p)),length(dFdy(p)));return mix(surfaceNoise(p),.5,smoothstep(.28,1.15,footprint));}
vec3 surfaceBump(vec3 pos,vec3 n,float height){
 vec3 dx=dFdx(pos),dy=dFdy(pos),r1=cross(dy,n),r2=cross(n,dx);
 float det=dot(dx,r1);return normalize(abs(det)*n-sign(det)*(dFdx(height)*r1+dFdy(height)*r2));
}
`;

export function finishMaterial(material,profile,{exposed=true,scale=1,leafUv=false}={}){
 const [roughness,metalness,variation,relief,frequency]=profiles[profile]||profiles.paint;
 const priorCompile=material.onBeforeCompile,priorKey=material.customProgramCacheKey.bind(material);
 const cache=priorKey();
 const uniforms={uSurfaceRain:{value:0},uSurfaceSnow:{value:0},uSurfaceExposure:{value:exposed?1:0}};
 material.roughness=roughness;material.metalness=metalness;material.dithering=true;
 const authored=material.userData.surfaceFinish;
 if(authored){
  if(Number.isFinite(authored.roughness))material.roughness=THREE.MathUtils.clamp(authored.roughness,.06,1);
  if(Number.isFinite(authored.metalness))material.metalness=THREE.MathUtils.clamp(authored.metalness,0,1);
  if(Number.isFinite(authored.envMapIntensity))material.envMapIntensity=THREE.MathUtils.clamp(authored.envMapIntensity,0,2);
 }
 material.userData.surfaceProfile=profile;
 material.userData.surfaceUniforms=uniforms;
 if(profile==='glass'){
  material.transparent=true;material.depthWrite=false;material.forceSinglePass=true;
  material.envMapIntensity=Number.isFinite(authored?.envMapIntensity)?THREE.MathUtils.clamp(authored.envMapIntensity,0,2):.75;
 }
 material.onBeforeCompile=(shader,renderer)=>{
  priorCompile.call(material,shader,renderer);
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSurfaceWorld;')
   .replace('#include <project_vertex>',`#include <project_vertex>
    vec4 surfacePosition=vec4(transformed,1.0);
    #ifdef USE_BATCHING
     surfacePosition=batchingMatrix*surfacePosition;
    #endif
    #ifdef USE_INSTANCING
     surfacePosition=instanceMatrix*surfacePosition;
    #endif
    vSurfaceWorld=(modelMatrix*surfacePosition).xyz;`);
  if(leafUv){
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vBotanicalUv;').replace('#include <begin_vertex>','#include <begin_vertex>\nvBotanicalUv=uv;');
   shader.fragmentShader='varying vec2 vBotanicalUv;\n'+shader.fragmentShader;
  }
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+common);
  const wood=profile==='wood'||profile==='bark';
  const ground=profile==='paving'&&!material.map;
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   vec3 surfaceP=vSurfaceWorld / ${scale.toFixed(5)};
   float surfaceGrain=surfaceFilteredNoise(surfaceP*${frequency.toFixed(2)});
   float surfaceMacro=surfaceFilteredNoise(surfaceP*1.35);
   float surfaceDetail=surfaceGrain;
   ${wood?`surfaceDetail=mix(surfaceGrain,surfaceFilteredNoise(surfaceP*vec3(16.0,.7,3.0)),.72);`:''}
   ${profile==='bark'&&!material.bumpMap?`
    // Millimetre-scale fissures follow the trunk vertically, interrupted by
    // irregular plates. Filter out the detail when it falls below a pixel.
    vec3 barkP=surfaceP*vec3(23.0,1.7,23.0);
    float barkWarp=surfaceFilteredNoise(surfaceP*vec3(3.5,.7,3.5));
    float barkRidge=surfaceFilteredNoise(barkP+vec3(barkWarp*2.8,0.0,barkWarp*1.7));
    float barkCrack=1.0-smoothstep(.25,.43,barkRidge);
    surfaceDetail=mix(surfaceDetail,barkRidge,.8);
    diffuseColor.rgb*=.84+.28*barkRidge-barkCrack*.17;
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.87,1.06,.78),smoothstep(.66,.84,surfaceMacro)*.28);
   `:''}
   ${leafUv?`
    float leafT=clamp(vBotanicalUv.y,0.0,1.0),leafAcross=abs(vBotanicalUv.x-.5);
    float leafAA=max(fwidth(vBotanicalUv.x),.003);
    float leafMidrib=1.0-smoothstep(.009,.009+leafAA,leafAcross);
    float leafVeinCoord=leafT*7.0-leafAcross*4.4;
    float leafVeinDist=abs(fract(leafVeinCoord)-.5);
    float leafVein=(1.0-smoothstep(.025,.025+max(fwidth(leafVeinCoord),.02),leafVeinDist))*(1.0-smoothstep(.38,.5,leafAcross));
    diffuseColor.rgb*=mix(.76,1.12,smoothstep(0.0,.8,leafT));
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.12,1.06,.78),leafMidrib*.3+leafVein*.13);
    surfaceDetail=mix(surfaceDetail,.7,leafMidrib*.32+leafVein*.12);
   `:''}
   ${profile==='bamboo'?`surfaceDetail=mix(surfaceGrain,surfaceFilteredNoise(surfaceP*vec3(110.0,1.2,110.0)),.7);float bambooPatina=surfaceFilteredNoise(surfaceP*vec3(3.0,.45,3.0));diffuseColor.rgb*=.84+.24*bambooPatina;`:''}
   ${profile==='forestPath'?`float aggregate=surfaceFilteredNoise(surfaceP*62.0);float repairs=smoothstep(.55,.75,surfaceFilteredNoise(surfaceP*vec3(.7,1.0,.9)));surfaceDetail=mix(surfaceDetail,aggregate,.55);diffuseColor.rgb*=.78+aggregate*.35-repairs*.13;`:''}
   vec3 surfaceNormalWorld=normalize(cross(dFdx(vSurfaceWorld),dFdy(vSurfaceWorld)))*gl_FrontFacingSign;
   float surfaceUp=max(0.0,surfaceNormalWorld.y);
   float surfaceWet=uSurfaceRain*uSurfaceExposure*mix(.12,1.0,smoothstep(.25,.85,surfaceUp));
   float surfaceCover=uSurfaceSnow*uSurfaceExposure*smoothstep(.65,.98,surfaceUp);
   float surfaceJoint=0.0;
   ${profile==='shopTile'?`vec2 tileUv=(abs(surfaceNormalWorld.z)>.5?surfaceP.xy:surfaceP.zy)/vec2(.12,.08);vec2 tileEdge=min(fract(tileUv),1.0-fract(tileUv));vec2 tileAA=max(fwidth(tileUv),vec2(.001));surfaceJoint=(1.0-smoothstep(.025,.025+tileAA.x,tileEdge.x))+(1.0-smoothstep(.025,.025+tileAA.y,tileEdge.y));surfaceJoint=min(1.0,surfaceJoint)*(1.0-smoothstep(.1,.8,max(tileAA.x,tileAA.y)));`:''}
   ${profile==='vermilion'?`surfaceDetail=mix(surfaceGrain,surfaceFilteredNoise(surfaceP*vec3(30.0,.7,30.0)),.55);diffuseColor.rgb*=.92+.13*surfaceDetail;`:''}
   ${ground?`vec2 tile=surfaceP.xz/vec2(.72,.42);tile.x+=mod(floor(tile.y),2.0)*.5;
    vec2 edge=min(fract(tile),1.0-fract(tile));vec2 aa=max(fwidth(tile),vec2(.001));
    surfaceJoint=(1.0-smoothstep(.006,.006+aa.x,edge.x))+(1.0-smoothstep(.009,.009+aa.y,edge.y));
    surfaceJoint=min(1.0,surfaceJoint)*(1.0-smoothstep(.05,.7,max(aa.x,aa.y)))*surfaceUp;
    surfaceDetail=mix(surfaceDetail,.18,surfaceJoint*.65);`:''}
   ${profile==='redPanel'?`float course=surfaceP.y/.42;float edge=min(fract(course),1.0-fract(course));surfaceJoint=1.0-smoothstep(.014,.014+max(fwidth(course),.012),edge);`:''}
   diffuseColor.rgb*=1.0+(surfaceMacro-.5)*${variation.toFixed(3)}+(surfaceDetail-.5)*${(variation*.55).toFixed(3)};
   ${profile==='moss'?`float mossPatch=smoothstep(.36,.67,surfaceFilteredNoise(surfaceP*vec3(1.3,2.0,1.3)));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.12,.18,.052),mossPatch*.65);`:''}
   diffuseColor.rgb*=1.0-surfaceJoint*.22;
   diffuseColor.rgb*=1.0-surfaceWet*${profile==='metal'||profile==='glass'?'0.02':'0.24'};
   // Keep the pigment's luminance but restore colour separation lost in pale
   // authored palettes. Neutral masonry stays neutral; grass, paint and timber
   // retain stronger chroma under the same physically lit material model.
   float pigmentLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
   diffuseColor.rgb=max(vec3(0.0),mix(vec3(pigmentLuma),diffuseColor.rgb,${['leaf','paint','vermilion','bamboo','redPanel'].includes(profile)?'1.34':'1.18'}));
   ${profile==='plaster'?`diffuseColor.rgb*=1.09;`:''}
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.82,.86,.88),surfaceCover*.85);
   roughnessFactor=clamp(roughnessFactor+(surfaceDetail-.5)*.13, .06,1.0);
   roughnessFactor=mix(roughnessFactor,max(.16,roughnessFactor*.43),surfaceWet);
   roughnessFactor=mix(roughnessFactor,.96,surfaceCover);
  `.replaceAll('gl_FrontFacingSign','(gl_FrontFacing ? 1.0 : -1.0)'));
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   normal=surfaceBump(-vViewPosition,normal,(surfaceDetail-.5-surfaceJoint*.65)*${(relief*scale).toFixed(6)}*(1.0-surfaceWet*.45));
   ${profile==='glass'?`float surfaceFresnel=pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),5.0);
    diffuseColor.a=clamp(diffuseColor.a+(1.0-diffuseColor.a)*surfaceFresnel*.7,.06,.88);`:''}
  `);
 };
 material.customProgramCacheKey=()=>`${cache}|architectural-surface-v3:${profile}:${scale}:${leafUv}`;
 material.needsUpdate=true;
 return uniforms;
}

export function upgradeSurfaces(root,id){
 const converted=new Map(),uniforms=[],owned=new Set(),materials=new Map(),glass=[];
 root.traverse(object=>{if(object.isMesh)for(const material of [object.material].flat()){
  const entry=materials.get(material)||[];entry.push(object);materials.set(material,entry);
 }});
 for(const [original,objects]of materials){
  if(!original.isMeshStandardMaterial&&!original.isMeshToonMaterial)continue;
  const names=objects.map(o=>`${o.name} ${o.parent?.name||''}`).join(' ');
  let profile=surfaceProfile(original,names);
  if(id==='school'&&original.name==='wall:brick-clone')profile='redPanel';
  let material=original;
  if(original.isMeshToonMaterial){
   material=new THREE.MeshStandardMaterial();
   for(const key of ['color','emissive'])material[key].copy(original[key]);
   for(const key of ['name','map','alphaMap','aoMap','aoMapIntensity','normalMap','bumpMap','bumpScale','displacementMap','displacementScale','emissiveMap','emissiveIntensity','opacity','transparent','alphaTest','side','depthWrite','depthTest','vertexColors','fog','visible','polygonOffset','polygonOffsetFactor','polygonOffsetUnits'])if(original[key]!==undefined)material[key]=original[key];
   material.normalScale.copy(original.normalScale);
   material.onBeforeCompile=original.onBeforeCompile;material.customProgramCacheKey=original.customProgramCacheKey;
   material.userData={...original.userData};owned.add(material);converted.set(original,material);
   for(const object of objects)object.material=Array.isArray(object.material)?object.material.map(m=>m===original?material:m):material;
  }
  if(profile==='redPanel'){material.map=null;material.color.set('#995b56');}
  if(id==='school'&&/^school:(glass|door-glass)$/.test(original.name)){material.map=null;material.color.set('#9aaeb2');material.opacity=original.name.includes('door')?.28:.56;}
  if(id==='school'&&original.name==='window:frame')material.color.set('#b9bfbd');
  if(profile==='glass')glass.push(material);
  // Non-glass lamp covers and emissive sign faces keep their authored emission.
  const indoors=id==='classroom'||id==='bookshop';
  const outside=!indoors||/outside|road|asphalt|curb|exterior/.test(names);
  const exposed=original.userData.weatherExposure??(outside&&!/interior|lobby|porch|ceiling|soffit|base:/.test(original.name));
  const leafUv=profile==='leaf'&&original.userData.botanicalKind!=='grass'&&objects.every(o=>o.geometry?.attributes.uv);
  uniforms.push(finishMaterial(material,profile,{exposed,leafUv}));
 }
 return {
  sync(){
   for(const [source,target]of converted){target.color.copy(source.color);target.emissive.copy(source.emissive);target.emissiveIntensity=source.emissiveIntensity;target.opacity=source.opacity;}
   for(const material of glass){const authored=material.userData.surfaceFinish;material.metalness=0;material.roughness=Number.isFinite(authored?.roughness)?THREE.MathUtils.clamp(authored.roughness,.06,1):.12;material.envMapIntensity=Number.isFinite(authored?.envMapIntensity)?THREE.MathUtils.clamp(authored.envMapIntensity,0,2):.85;}
  },
  setWeather(weather){for(const u of uniforms){u.uSurfaceRain.value=THREE.MathUtils.clamp(weather?.rain||0,0,1);u.uSurfaceSnow.value=THREE.MathUtils.clamp(weather?.snow||0,0,1);}},
  dispose(){for(const material of owned)material.dispose();owned.clear();},
  count:uniforms.length,
 };
}
