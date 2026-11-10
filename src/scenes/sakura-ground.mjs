import * as T from 'three';
import {randomSeed} from './diorama-kit.mjs';

const clamp=T.MathUtils.clamp,mix=T.MathUtils.lerp;
const smooth=t=>(t=clamp(t,0,1),t*t*(3-2*t));
const hash=(x,y)=>{let n=Math.imul(x,374761393)^Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};

// A soil/grass-root carpet below the blades: irregular interwoven fibres,
// dark root pockets and small mineral grains, with a separate height field.
// At 512 pixels per metre these are millimetre features, not metre-wide stripes.
function turfTexture(b){
 const size=512,albedo=new Uint8Array(size*size*4),height=new Uint8Array(size*size*4),rng=randomSeed(55913);
 const noise=(x,y,n)=>{const px=x*n/size,py=y*n/size,ix=Math.floor(px),iy=Math.floor(py),u=smooth(px-ix),v=smooth(py-iy),h=(a,c)=>hash((a+n)%n,(c+n)%n);return mix(mix(h(ix,iy),h(ix+1,iy),u),mix(h(ix,iy+1),h(ix+1,iy+1),u),v);};
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const macro=noise(x,y,8),root=noise(x,y,47),grit=hash(x,y),k=(y*size+x)*4;
  const tone=clamp(190+(macro-.5)*43+(root-.5)*26+(grit-.5)*25,145,236),relief=clamp(90+root*55+(grit-.5)*43,25,190);
  albedo[k]=tone-2;albedo[k+1]=tone+2;albedo[k+2]=tone-7;albedo[k+3]=255;
  height[k]=height[k+1]=height[k+2]=relief;height[k+3]=255;
 }
 // Short bent stalks lie in varied directions; no repeating lawn comb pattern.
 for(let stalk=0;stalk<13500;stalk++){
  const x=rng()*size,y=rng()*size,a=rng()*Math.PI*2,length=3+rng()*16,bend=(rng()-.5)*3,dry=rng()<.23;
  for(let step=0;step<=length;step++){
   const t=step/length,px=Math.round(x+Math.cos(a)*step+Math.sin(a)*bend*t*t),py=Math.round(y+Math.sin(a)*step-Math.cos(a)*bend*t*t),k=(((py+size)%size)*size+(px+size)%size)*4;
   const edge=Math.sin(t*Math.PI)*.6+.18,shade=dry?223:172+rng()*38;
   albedo[k]=mix(albedo[k],shade+(dry?9:-5),edge);albedo[k+1]=mix(albedo[k+1],shade+(dry?3:7),edge);albedo[k+2]=mix(albedo[k+2],shade-(dry?19:9),edge);
   height[k]=height[k+1]=height[k+2]=mix(height[k],162,edge);
  }
 }
 const texture=(data,name,colorSpace)=>{
  const t=new T.DataTexture(data,size,size,T.RGBAFormat);t.name=name;t.colorSpace=colorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=4;t.needsUpdate=true;b.textures.add(t);return t;
 };
 return {color:texture(albedo,'sakura:interwoven-roots-and-dry-stalks',T.SRGBColorSpace),height:texture(height,'sakura:root-and-grit-height',T.NoColorSpace)};
}

const groundFunctions=/* glsl */`
varying vec3 vMeadowWorld;
uniform sampler2D uMeadowRoots;
uniform sampler2D uMeadowHeight;
float meadowHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float meadowNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(meadowHash(i),meadowHash(i+vec2(1,0)),f.x),mix(meadowHash(i+vec2(0,1)),meadowHash(i+vec2(1,1)),f.x),f.y);}
float meadowFilteredNoise(vec2 p){float footprint=max(length(dFdx(p)),length(dFdy(p)));return mix(meadowNoise(p),.5,smoothstep(.25,.9,footprint));}
vec3 meadowBump(vec3 p,vec3 n,float h){vec3 dx=dFdx(p),dy=dFdy(p),a=cross(dy,n),b=cross(n,dx);float d=dot(dx,a);return normalize(abs(d)*n-sign(d)*(dFdx(h)*a+dFdy(h)*b));}
`;

export function finishMeadowGround(b,bankMaterial,pathMaterial){
 const textures=turfTexture(b);
 for(const [material,path]of [[bankMaterial,false],[pathMaterial,true]]){
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey.bind(material),cache=priorKey();
  material.userData.meadowSurface={fibres:true,worldScale:1,heightMap:true,path};
  material.onBeforeCompile=(shader,renderer)=>{
   prior.call(material,shader,renderer);shader.uniforms.uMeadowRoots={value:textures.color};shader.uniforms.uMeadowHeight={value:textures.height};
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMeadowWorld;').replace('#include <project_vertex>','#include <project_vertex>\nvMeadowWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+groundFunctions);
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    vec2 meadowP=vMeadowWorld.xz;
    float meadowMacro=meadowFilteredNoise(meadowP*.34),meadowMid=meadowFilteredNoise(meadowP*1.4+17.3);
    vec2 meadowUv=meadowP+vec2(meadowNoise(meadowP*.19),meadowNoise(meadowP*.23+7.0))*.23;
    float meadowFootprint=max(length(dFdx(meadowUv)),length(dFdy(meadowUv)));
    float meadowDetail=1.0-smoothstep(.025,.16,meadowFootprint);
    vec3 meadowRoots=mix(vec3(.53),texture2D(uMeadowRoots,meadowUv).rgb,meadowDetail)/.53;
    float meadowHeight=texture2D(uMeadowHeight,meadowUv).r;
    ${path?`
    // Compacted grit stays warm; roots and moss creep in at irregular margins.
    float meadowCentre=.45+1.15*sin(meadowP.y*.075)+.42*sin(meadowP.y*.19+.6)-(2.35+.28*sin(meadowP.y*.12+1.2))-3.35+.075*sin(meadowP.y*.77)+.04*sin(meadowP.y*1.6+.8);
    float meadowEdge=smoothstep(.46,.86,abs(meadowP.x-meadowCentre)+(meadowMid-.5)*.24);
    diffuseColor.rgb*=mix(vec3(.78+.35*meadowMid),meadowRoots,.42)*(.88+.20*meadowMacro);
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.65,.89,.43),meadowEdge*.42);
    `:`
    // Wetter root pockets, straw and small bare patches cross the broad vertex
    // palette. The bank's rising shoulder controls the soil-to-grass transition.
    float meadowTurf=smoothstep(.45,1.56,vMeadowWorld.y);
    float meadowDry=smoothstep(.47,.76,meadowMacro)*meadowTurf;
    float meadowBare=smoothstep(.72,.94,meadowMid)*meadowTurf;
    float meadowMoss=smoothstep(.58,.79,meadowFilteredNoise(meadowP*2.1+43.0))*(1.0-meadowTurf*.65);
    diffuseColor.rgb*=mix(vec3(.82+.33*meadowMid),meadowRoots,meadowTurf*.85)*(.76+.4*meadowMacro);
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.27,1.04,.7),meadowDry*.48);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.18,.127,.074)*(.78+.35*meadowMid),meadowBare*.34);
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.6,.83,.43),meadowMoss*.37);
    `}
   `);
   shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    normal=meadowBump(-vViewPosition,normal,(meadowHeight-.5)*${path?'.003':'.008'}*meadowDetail);
   `);
  };
  material.customProgramCacheKey=()=>`${cache}|sakura-meadow-roots-v1:${path}`;material.needsUpdate=true;
 }
 return textures;
}

// Three curved blades share a buried root. Geometry carries the taper, folded
// midrib and bend, so silhouettes remain convincing without alpha rectangles.
export function addMeadowBlades(b,points,{reed=false,name='foliage:stream-bank-grass'}={}){
 const positions=[],uvs=[],colors=[],indices=[],root=new T.Color('#737a52'),tip=new T.Color('#edf0c0');
 for(let blade=0;blade<3;blade++){
  const a=blade*2.39996,height=[1,.78,.9][blade],base=positions.length/3;
  for(let row=0;row<=4;row++){
   const u=row/4,reach=(reed?.12:.24)*u*u,width=(reed?.025:.047)*Math.pow(1-u,.72),rise=height*(u-.075*u*u),color=root.clone().lerp(tip,Math.pow(u,.52));
   for(let side=-1;side<=1;side++){
    const sideways=side*width,x=Math.cos(a)*reach-Math.sin(a)*sideways,z=Math.sin(a)*reach+Math.cos(a)*sideways;
    positions.push(x,rise,z+(side===0?.024:0)*Math.sin(u*Math.PI));uvs.push((side+1)/2,u);colors.push(color.r,color.g,color.b);
   }
   if(row)for(let side=0;side<2;side++){const i=base+(row-1)*3+side;indices.push(i,i+3,i+1,i+1,i+3,i+4);}
  }
 }
 const geometry=b.own(new T.BufferGeometry());geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.userData={rooted:true,curved:true,tapered:true,blades:3};
 const material=b.mat(name,'#ffffff',{side:T.DoubleSide,roughness:.97,vertexColors:true});material.userData.surfaceFinish={roughness:.97,metalness:0,envMapIntensity:.06};material.userData.botanicalKind='grass';
 const wind={uWindTime:{value:0},uWindStrength:{value:reed?.09:.12}};material.userData.windUniforms=wind;
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,wind);shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uWindTime;uniform float uWindStrength;');
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   float meadowPhase=instanceMatrix[3].x*1.7+instanceMatrix[3].z*.8;
   transformed.x+=sin(uWindTime*1.5+meadowPhase)*uWindStrength*position.y*position.y;
   transformed.z+=sin(uWindTime*1.2+meadowPhase*.7)*uWindStrength*.6*position.y*position.y;
  `);
 };
 material.customProgramCacheKey=()=>`meadow-rooted-blade-v1:${reed}`;
 const mesh=new T.InstancedMesh(geometry,material,points.length),object=new T.Object3D(),color=new T.Color(),baseColor=new T.Color(reed?'#719047':'#6e8e3f'),dryColor=new T.Color('#b1a167'),rng=randomSeed(reed?1853:91853);
 points.forEach((p,i)=>{
  const height=p.size*2;object.position.set(p.x,groundContact(p),p.z);object.rotation.set((p.rx||0)*.3,p.ry||0,(p.rz||0)*.3);object.scale.set(height,height,height);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);
  const drought=smooth(.5+.3*Math.sin(p.x*.7+p.z*.31)+.2*Math.sin(p.x*2.6-p.z*1.7));
  color.copy(baseColor).lerp(dryColor,drought*(rng()<.14?.85:.28)).multiplyScalar(.75+rng()*.37);mesh.setColorAt(i,color);
 });
 mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();b.root.add(mesh);b.instances.push(mesh);b.animations.push(t=>{wind.uWindTime.value=t;});return mesh;
}

function groundContact(point){return point.y-point.size-.003;}
