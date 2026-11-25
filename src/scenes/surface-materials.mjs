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

const builtArchitecture=new Set(['inage','kasai','kyoto','school','city','bookshop','classroom','wedding']);
// A small sunward tint for low-chroma mineral and timber finishes. Lacquer,
// painted steel and coloured panels keep their own hue.
const sunlitFinish={
 plaster:[1.065,1.018,.947],stone:[1.043,1.015,.964],paving:[1.037,1.013,.971],
 shopTile:[1.043,1.014,.96],wood:[1.080,1.018,.92],
 paint:[1.012,1.006,.987],vermilion:[1.012,1.006,.987],redPanel:[1.018,1.006,.986],
};

// Project courses in metres onto the two faces of a street building. A single
// batch may contain several façades, so the joints use world position. Below
// pixel scale their contrast fades into the finish of the more distant wall.
function claddingShader(kind){
 const sizes={brick:[.31,.115],siding:[2.72,.255],panel:[1.65,.82],render:[2.45,2.80]};
 const size=sizes[kind];if(!size)return '';
 const seam=kind==='render'?.07:kind==='brick'?.29:.21;
 return `
  if(abs(surfaceNormalWorld.y)<.55){
   vec2 wallMetres=vec2(abs(surfaceNormalWorld.x)>.55?vSurfaceWorld.z:vSurfaceWorld.x,vSurfaceWorld.y);
   vec2 course=wallMetres/vec2(${size[0].toFixed(3)},${size[1].toFixed(3)});
   vec2 footprint=max(fwidth(course),vec2(.001));
   ${kind==='brick'||kind==='siding'?'course.x+=mod(floor(course.y),2.)*.5;':''}
   vec2 coord=fract(course),edge=min(coord,1.-coord),unitMetres=vec2(${size[0].toFixed(3)},${size[1].toFixed(3)});
   vec2 halfJoint=vec2(.004)/unitMetres;
   vec2 visible=1.-smoothstep(vec2(.12),vec2(.80),footprint);
   vec2 reveal=(1.-smoothstep(halfJoint,halfJoint+footprint,edge))*visible;
   float block=surfaceHash(vec3(floor(course),7.73))-.5;
   float unitVariation=block*visible.x*visible.y;
   float batchTint=surfaceNoise(vec3(wallMetres.x*.42,wallMetres.y*.55,4.6))-.5;
   diffuseColor.rgb*=vec3(1.)+unitVariation*vec3(.18,.13,.10)+batchTint*vec3(.11,.08,.045);
   diffuseColor.rgb*=1.-max(reveal.x,reveal.y)*${seam.toFixed(2)};
   float lowerSkirt=1.-smoothstep(.60,.64,vSurfaceWorld.y);
   diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.65,.69,.73),lowerSkirt);
   surfaceDetail-=max(reveal.x,reveal.y)*.30;
  }`;
}

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
float surfaceFilteredNoise(vec3 p){
 #ifdef YUKINO_GOUACHE
  return .5;
 #else
  float footprint=max(length(dFdx(p)),length(dFdy(p)));return mix(surfaceNoise(p),.5,smoothstep(.28,1.15,footprint));
 #endif
}
vec3 surfaceBump(vec3 pos,vec3 n,float height){
 vec3 dx=dFdx(pos),dy=dFdy(pos),r1=cross(dy,n),r2=cross(n,dx);
 float det=dot(dx,r1);return normalize(abs(det)*n-sign(det)*(dFdx(height)*r1+dFdy(height)*r2));
}
`;

export function finishMaterial(material,profile,{exposed=true,scale=1,leafUv=false,clearDay=null}={}){
 const [roughness,metalness,variation,relief,frequency]=profiles[profile]||profiles.paint;
 const priorCompile=material.onBeforeCompile,priorKey=material.customProgramCacheKey.bind(material);
 const cache=priorKey();
 const cladding=material.userData.cladding||'';
 const uniforms={uSurfaceRain:{value:0},uSurfaceSnow:{value:0},uSurfaceExposure:{value:exposed?1:0}};
 if(clearDay)uniforms.uClearArchitectureDay=clearDay;
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
    #ifndef YUKINO_GOUACHE
    float leafT=clamp(vBotanicalUv.y,0.0,1.0),leafAcross=abs(vBotanicalUv.x-.5);
    float leafAA=max(fwidth(vBotanicalUv.x),.003);
    float leafMidrib=1.0-smoothstep(.009,.009+leafAA,leafAcross);
    float leafVeinCoord=leafT*7.0-leafAcross*4.4;
    float leafVeinDist=abs(fract(leafVeinCoord)-.5);
    float leafVein=(1.0-smoothstep(.025,.025+max(fwidth(leafVeinCoord),.02),leafVeinDist))*(1.0-smoothstep(.38,.5,leafAcross));
    diffuseColor.rgb*=mix(.76,1.12,smoothstep(0.0,.8,leafT));
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.12,1.06,.78),leafMidrib*.3+leafVein*.13);
    surfaceDetail=mix(surfaceDetail,.7,leafMidrib*.32+leafVein*.12);
    #endif
   `:''}
   ${profile==='bamboo'?`surfaceDetail=mix(surfaceGrain,surfaceFilteredNoise(surfaceP*vec3(110.0,1.2,110.0)),.7);float bambooPatina=surfaceFilteredNoise(surfaceP*vec3(3.0,.45,3.0));diffuseColor.rgb*=.84+.24*bambooPatina;`:''}
   ${profile==='forestPath'?`float aggregate=surfaceFilteredNoise(surfaceP*62.0);float repairs=smoothstep(.55,.75,surfaceFilteredNoise(surfaceP*vec3(.7,1.0,.9)));surfaceDetail=mix(surfaceDetail,aggregate,.55);diffuseColor.rgb*=.78+aggregate*.35-repairs*.13;`:''}
   vec3 surfaceNormalWorld=normalize(cross(dFdx(vSurfaceWorld),dFdy(vSurfaceWorld)))*gl_FrontFacingSign;
   float surfaceUp=max(0.0,surfaceNormalWorld.y);
   float surfaceWet=uSurfaceRain*uSurfaceExposure*mix(.12,1.0,smoothstep(.25,.85,surfaceUp));
   float surfaceCover=uSurfaceSnow*uSurfaceExposure*smoothstep(.65,.98,surfaceUp);
   float surfaceJoint=0.0;
   ${claddingShader(cladding)}
   ${profile==='shopTile'?`vec2 tileUv=(abs(surfaceNormalWorld.z)>.5?surfaceP.xy:surfaceP.zy)/vec2(.12,.08);vec2 tileEdge=min(fract(tileUv),1.0-fract(tileUv));vec2 tileAA=max(fwidth(tileUv),vec2(.001));surfaceJoint=(1.0-smoothstep(.025,.025+tileAA.x,tileEdge.x))+(1.0-smoothstep(.025,.025+tileAA.y,tileEdge.y));surfaceJoint=min(1.0,surfaceJoint)*(1.0-smoothstep(.1,.8,max(tileAA.x,tileAA.y)));`:''}
   ${profile==='vermilion'?`surfaceDetail=mix(surfaceGrain,surfaceFilteredNoise(surfaceP*vec3(30.0,.7,30.0)),.55);diffuseColor.rgb*=.92+.13*surfaceDetail;`:''}
   ${ground?`vec2 tile=surfaceP.xz/vec2(.72,.42);tile.x+=mod(floor(tile.y),2.0)*.5;
    vec2 edge=min(fract(tile),1.0-fract(tile));vec2 aa=max(fwidth(tile),vec2(.001));
    surfaceJoint=(1.0-smoothstep(.006,.006+aa.x,edge.x))+(1.0-smoothstep(.009,.009+aa.y,edge.y));
    surfaceJoint=min(1.0,surfaceJoint)*(1.0-smoothstep(.05,.7,max(aa.x,aa.y)))*surfaceUp;
    // Variation follows individual slabs and fades with distance. The joint
    // and slight difference between paving lots remain in both styles.
    float slabTone=(surfaceHash(vec3(floor(tile),19.7))-.5)*(1.-smoothstep(.12,.8,max(aa.x,aa.y)))*surfaceUp;
    diffuseColor.rgb*=vec3(1.)+slabTone*vec3(.17,.14,.10);
    surfaceDetail=mix(surfaceDetail,.18,surfaceJoint*.65);`:''}
   ${profile==='redPanel'?`float course=surfaceP.y/.42;float edge=min(fract(course),1.0-fract(course));surfaceJoint=1.0-smoothstep(.014,.014+max(fwidth(course),.012),edge);`:''}
   diffuseColor.rgb*=1.0+(surfaceMacro-.5)*${variation.toFixed(3)}+(surfaceDetail-.5)*${(variation*.55).toFixed(3)};
   ${profile==='moss'?`float mossPatch=smoothstep(.36,.67,surfaceFilteredNoise(surfaceP*vec3(1.3,2.0,1.3)));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.12,.18,.052),mossPatch*.65);`:''}
   ${profile==='asphalt'?`
    // Subtle Japanese road patina: wheel-track wear & aggregate micro-grain
    // break flat grey plastic asphalt without introducing noisy sparkle.
    float roadAgg=surfaceFilteredNoise(surfaceP*70.0);
    float roadPatch=surfaceFilteredNoise(surfaceP*vec3(.42,1.0,.42));
    float wheelWear=smoothstep(.44,.88,abs(sin(surfaceP.x*.92+surfaceP.z*.08)));
    surfaceDetail=mix(surfaceDetail,roadAgg,.60);
    diffuseColor.rgb*=vec3(.89+.20*roadAgg)*(.94+.11*roadPatch);
    diffuseColor.rgb*=1.0-wheelWear*.065;
    roughnessFactor=clamp(roughnessFactor-wheelWear*.10,.36,1.0);
   `:''}
   ${['plaster','stone','redPanel','shopTile'].includes(profile)?`
    // Subtle rainwater vertical weathering & ground-contact mineral darkening
    // on exterior vertical walls removes the brand-new plastic model look.
    #ifndef YUKINO_GOUACHE
    if(abs(surfaceNormalWorld.y)<.45 && uSurfaceExposure>.5){
     float rainStreak=surfaceFilteredNoise(vec3(surfaceP.x*2.4+surfaceP.z*2.4,surfaceP.y*.22,5.1));
     float dampFoot=1.0-smoothstep(.04,.55,max(0.0,vSurfaceWorld.y));
     diffuseColor.rgb*=1.0-(rainStreak-.5)*.075-dampFoot*.10;
     roughnessFactor=clamp(roughnessFactor+dampFoot*.06,.08,1.0);
    }
    #endif
   `:''}
   diffuseColor.rgb*=1.0-surfaceJoint*.22;
   diffuseColor.rgb*=1.0-surfaceWet*${profile==='metal'||profile==='glass'?'0.02':'0.24'};
   // Keep the pigment's luminance but restore colour separation lost in pale
   // authored palettes. Neutral masonry stays neutral; grass, paint and timber
   // retain stronger chroma under the same physically lit material model.
   float pigmentLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
   diffuseColor.rgb=max(vec3(0.0),mix(vec3(pigmentLuma),diffuseColor.rgb,${['paint','vermilion','bamboo','redPanel'].includes(profile)?'1.30':profile==='leaf'?'1.18':'1.16'}));
   ${profile==='leaf'?`roughnessFactor=max(roughnessFactor,.88);`:''}
   ${profile==='plaster'?`diffuseColor.rgb*=1.09;`:''}
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.82,.86,.88),surfaceCover*.85);
   roughnessFactor=clamp(roughnessFactor+(surfaceDetail-.5)*.13, .06,1.0);
   roughnessFactor=mix(roughnessFactor,max(.16,roughnessFactor*.43),surfaceWet);
   roughnessFactor=mix(roughnessFactor,.96,surfaceCover);
  `.replaceAll('gl_FrontFacingSign','(gl_FrontFacing ? 1.0 : -1.0)'));
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   #ifndef YUKINO_GOUACHE
   normal=surfaceBump(-vViewPosition,normal,(surfaceDetail-.5-surfaceJoint*.65)*${(relief*scale).toFixed(6)}*(1.0-surfaceWet*.45));
   #endif
   ${profile==='glass'?`float surfaceFresnel=pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),5.0);
    diffuseColor.a=clamp(diffuseColor.a+(1.0-diffuseColor.a)*surfaceFresnel*.7,.06,.88);`:''}
  `);
  if(clearDay){
   shader.fragmentShader='uniform float uClearArchitectureDay;\n'+shader.fragmentShader.replace('#include <aomap_fragment>',`
    #include <aomap_fragment>
    {
    // Work on diffuse light after shadows and ambient occlusion. Specular,
    // glass, emission, the sky and the final exposure keep their own response.
    vec3 daylightLuma=vec3(.2126,.7152,.0722);
    float albLuma=max(dot(diffuseColor.rgb,daylightLuma),.015);
    float peak=max(max(diffuseColor.r,diffuseColor.g),diffuseColor.b);
    float chroma=(peak-min(min(diffuseColor.r,diffuseColor.g),diffuseColor.b))/max(peak,.014);
    vec3 received=reflectedLight.directDiffuse+reflectedLight.indirectDiffuse;
    float headroom=1.-smoothstep(.53,1.04,max(max(received.r,received.g),received.b));
    float white=smoothstep(.48,.85,albLuma)*(1.-smoothstep(.06,.23,chroma));
    float directShare=dot(reflectedLight.directDiffuse,daylightLuma)/max(.015,dot(received,daylightLuma));
    float sunward=smoothstep(.06,.65,directShare);
    vec3 hue=clamp(diffuseColor.rgb/albLuma-1.,vec3(-.7),vec3(.7));
    vec3 colourDirection=hue*(1.-smoothstep(.40,.92,chroma))*.43;
    colourDirection+=(vec3(${sunlitFinish[profile].map(n=>n.toFixed(3)).join(',')})-1.)*
                      (1.-smoothstep(.18,.56,chroma))*(1.-white);
    float dayGrade=uClearArchitectureDay*headroom*smoothstep(.012,.11,albLuma);
    #ifdef YUKINO_GOUACHE
      dayGrade*=.82;
    #endif
    reflectedLight.directDiffuse*=1.+dayGrade*(vec3(.44)+colourDirection*1.36);
    reflectedLight.indirectDiffuse*=1.+dayGrade*(vec3(.045+.22*sunward)+
                                     colourDirection*(.13+.66*sunward));
    }
   `);
  }
 };
 material.customProgramCacheKey=()=>`${cache}|architectural-surface-v5:${profile}:${scale}:${leafUv}:${Boolean(clearDay)}:${cladding}`;
 material.needsUpdate=true;
 return uniforms;
}

export function upgradeSurfaces(root,id){
 const converted=new Map(),uniforms=[],owned=new Set(),materials=new Map(),glass=[];
 const clearDay={value:0};
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
  const architectural=builtArchitecture.has(id)&&Boolean(sunlitFinish[profile])&&
   !material.transparent&&!material.alphaTest&&!(material.emissive?.getHex()>0)&&
   !/shadow|recess|joint|gasket|soot|black-post-foot|rock|boulder|water|glass|pane-depth|window-depth|lamp:|light:/.test(material.name);
  uniforms.push(finishMaterial(material,profile,{exposed,leafUv,clearDay:architectural?clearDay:null}));
 }
 return {
  sync(){
   for(const [source,target]of converted){target.color.copy(source.color);target.emissive.copy(source.emissive);target.emissiveIntensity=source.emissiveIntensity;target.opacity=source.opacity;}
   for(const material of glass){const authored=material.userData.surfaceFinish;material.metalness=0;material.roughness=Number.isFinite(authored?.roughness)?THREE.MathUtils.clamp(authored.roughness,.06,1):.12;material.envMapIntensity=Number.isFinite(authored?.envMapIntensity)?THREE.MathUtils.clamp(authored.envMapIntensity,0,2):.85;}
  },
  setWeather(weather,sunHeight=0){
   const smooth=THREE.MathUtils.smoothstep;
   clearDay.value=smooth(sunHeight,.24,.52)*(1.-smooth(weather?.cloud||0,.30,.82))*
    (1.-smooth(weather?.rain||0,0,.08))*(1.-smooth(weather?.fog||0,.02,.30))*(1.-smooth(weather?.snow||0,0,.10));
   for(const u of uniforms){u.uSurfaceRain.value=THREE.MathUtils.clamp(weather?.rain||0,0,1);u.uSurfaceSnow.value=THREE.MathUtils.clamp(weather?.snow||0,0,1);}
  },
  dispose(){for(const material of owned)material.dispose();owned.clear();},
  count:uniforms.length,
 };
}
