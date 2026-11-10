import * as T from 'three';

// Bundled CC0 photographs, not remote assets loaded by a running scene.
// The cache retains decoded images only. Every scene owns its GPU texture clones.
const names={concrete:'concrete_wall_006',wood:'wood_planks_dirt',stone:'mossy_rock',grass:'leafy_grass'},cache=new Map(),pending=new Map();
export async function prepareArchitectureTextures(id){
 const kinds=id==='inage'?['concrete','grass']:id==='kyoto'?['wood','stone']:['sakura','school','wedding','kasai'].includes(id)?['grass']:[];
 await Promise.all(kinds.map(kind=>{
  if(!pending.has(kind))pending.set(kind,Promise.all(['Diffuse','Rough'].map(async map=>{
   const texture=await new T.TextureLoader().loadAsync(new URL(`textures/architecture/${names[kind]}-${map}.webp`,document.baseURI).href);
   texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=4;
   texture.colorSpace=map==='Diffuse'?T.SRGBColorSpace:T.NoColorSpace;
   return texture;
  })).then(textures=>{cache.set(kind,{textures});}).catch(()=>{cache.set(kind,{textures:null});}));
  return pending.get(kind);
 }));
}

const common=/* glsl */`
varying vec3 vPatinaWorld;
uniform sampler2D uPatinaAlbedo;
uniform sampler2D uPatinaRough;
float patinaHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float patinaNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(patinaHash(i),patinaHash(i+vec3(1,0,0)),f.x),mix(patinaHash(i+vec3(0,1,0)),patinaHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(patinaHash(i+vec3(0,0,1)),patinaHash(i+vec3(1,0,1)),f.x),mix(patinaHash(i+vec3(0,1,1)),patinaHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
vec3 patinaTex(sampler2D tex,vec3 p,vec3 n){vec3 w=pow(abs(n),vec3(6.));w/=max(.001,w.x+w.y+w.z);return texture2D(tex,p.zy).rgb*w.x+texture2D(tex,p.xz).rgb*w.y+texture2D(tex,p.xy).rgb*w.z;}
vec3 patinaBump(vec3 p,vec3 n,float h){vec3 dx=dFdx(p),dy=dFdy(p),r1=cross(dy,n),r2=cross(n,dx);float d=dot(dx,r1);return normalize(abs(d)*n-sign(d)*(dFdx(h)*r1+dFdy(h)*r2));}
`;

// Add actual metre-scale surface identity while preserving Standard's PBR light
// model, shadows, fog and the common scene/weather finish applied afterwards.
export function architectureFinish(b,material,kind,{scale=2.4,amount=1}={}){
 const source=cache.get(kind)?.textures,uniforms={};
 if(source)for(const [i,name]of ['uPatinaAlbedo','uPatinaRough'].entries()){
  const texture=source[i].clone();texture.needsUpdate=true;b.textures.add(texture);uniforms[name]={value:texture};
 }
 const previous=material.onBeforeCompile,oldKey=material.customProgramCacheKey.bind(material),key=oldKey();
 material.onBeforeCompile=(shader,renderer)=>{
  previous.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPatinaWorld;').replace('#include <project_vertex>',`#include <project_vertex>
   vec4 patinaPosition=vec4(transformed,1.);
   #ifdef USE_INSTANCING
    patinaPosition=instanceMatrix*patinaPosition;
   #endif
   vPatinaWorld=(modelMatrix*patinaPosition).xyz;`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+common);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   vec3 pn=normalize(cross(dFdx(vPatinaWorld),dFdy(vPatinaWorld)))*(gl_FrontFacing?1.:-1.);
   vec3 pp=vPatinaWorld/${scale.toFixed(4)};
   float age=patinaNoise(vPatinaWorld*vec3(2.2,.23,2.2));
   float grain=patinaNoise(vPatinaWorld*vec3(${kind==='wood'?'85.,.8,85.':'26.,26.,26.'}));
   float patinaHeight=(grain-.5)*.0014;
   ${source?`vec3 photographed=patinaTex(uPatinaAlbedo,pp,pn);
    float photographedRough=patinaTex(uPatinaRough,pp,pn).r;
    ${kind==='wood'?`float timberLuma=dot(photographed,vec3(.2126,.7152,.0722));diffuseColor.rgb*=.64+timberLuma*1.32;patinaHeight+=(timberLuma-.4)*.003;`:
     kind==='concrete'?`float concreteLuma=dot(photographed,vec3(.2126,.7152,.0722));
      // Retain the bridge's light grey cement colour. The source photograph
      // contributes aggregate, runoff and relief, not its brown illumination.
      // This bundled photograph has mean linear luminance .0871. Normalize
      // around that measured value so aggregate/runoff keeps visible contrast.
      float concreteVariation=clamp(pow(max(concreteLuma,.001)/.0871,.65),.58,1.34);
      vec3 concreteTint=mix(vec3(1.),photographed/max(concreteLuma,.025),.06);
      diffuseColor.rgb*=mix(vec3(1.),concreteTint*concreteVariation,${amount.toFixed(3)});
      patinaHeight+=(concreteLuma-.4)*.005;`:
     kind==='grass'?`float turfMask=${material.name==='soil:stream-bank'?'smoothstep(.55,1.7,vPatinaWorld.y)':'1.0'};
      diffuseColor.rgb=mix(diffuseColor.rgb,photographed*.95,${amount.toFixed(3)}*turfMask);patinaHeight+=(dot(photographed,vec3(.333))-.25)*.008*turfMask;`:
     `diffuseColor.rgb=mix(diffuseColor.rgb,photographed,${amount.toFixed(3)});patinaHeight+=(dot(photographed,vec3(.333))-.4)*.005;`}
    roughnessFactor=mix(roughnessFactor,clamp(photographedRough,.62,.99),.65);`:
    `diffuseColor.rgb*=.86+.2*age+.08*grain;`}
   ${kind==='concrete'?`float form=min(fract(vPatinaWorld.y/1.22),1.-fract(vPatinaWorld.y/1.22));float formSeam=(1.-smoothstep(.001,.0025+fwidth(vPatinaWorld.y),form))*.13;diffuseColor.rgb*=1.-formSeam;patinaHeight-=formSeam*.003;`:''}
   ${kind==='paint'?`float runoff=smoothstep(.58,.8,patinaNoise(vPatinaWorld*vec3(12.,.24,12.)));diffuseColor.rgb*=.94-runoff*.1;roughnessFactor=clamp(roughnessFactor+(age-.5)*.16,.48,.9);`:''}
   ${kind==='stone'?`float moss=smoothstep(.6,.82,age)*smoothstep(.1,.9,max(pn.y,0.));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.11,.026),moss*.38);`:''}
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n normal=patinaBump(-vViewPosition,normal,patinaHeight);');
 };
 material.customProgramCacheKey=()=>`${key}|architecture-patina-v3:${kind}:${Boolean(source)}:${scale}:${amount}`;
 material.userData.architecturalFinish={kind,photographed:Boolean(source),scale};
 material.needsUpdate=true;return material;
}
