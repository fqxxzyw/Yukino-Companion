import * as T from 'three';

// Root-anchored world-space bend shared by culms, their branches and leaf sprays.
// The same deformation runs in the shadow depth pass (not a detached leaf wiggle).
export function bambooSway(builder,root){
 const uniforms={uBambooTime:{value:0},uBambooWind:{value:.25}};
 const body=`
  mat4 bambooModel=modelMatrix;
  #ifdef USE_INSTANCING
   bambooModel=bambooModel*instanceMatrix;
  #endif
  vec3 bambooWorld=(bambooModel*vec4(transformed,1.0)).xyz;
  float bambooHeight=max(0.0,bambooWorld.y-.2)/12.0;
  float bambooPhase=uBambooTime*.62+bambooWorld.x*.12+bambooWorld.z*.14;
  vec3 bambooBend=vec3(sin(bambooPhase),0.0,cos(bambooPhase*.83)*.42)*bambooHeight*bambooHeight*(.075+uBambooWind*.16);
  transformed+=inverse(mat3(bambooModel))*bambooBend;
 `;
 const patched=new Set();
 const patch=material=>{
  if(patched.has(material))return;patched.add(material);
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material),cache=key();
  material.onBeforeCompile=(shader,renderer)=>{previous.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uBambooTime;uniform float uBambooWind;').replace('#include <project_vertex>',body+'\n#include <project_vertex>');};
  material.customProgramCacheKey=()=>cache+'|rooted-bamboo-bend-v1';material.userData.bambooSway=uniforms;
 };
 root.traverse(o=>{if(!o.isMesh||!/^bamboo:/.test(o.material?.name))return;patch(o.material);
  const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});patch(depth);builder.materials.add(depth);o.customDepthMaterial=depth;
 });
 let shadowTime=-1;
 builder.animations.push(t=>{uniforms.uBambooTime.value=t;if(t-shadowTime>.18){builder.renderer.shadowMap.needsUpdate=true;shadowTime=t;}});
 return wind=>{uniforms.uBambooWind.value=T.MathUtils.clamp(wind??.25,0,1);};
}
