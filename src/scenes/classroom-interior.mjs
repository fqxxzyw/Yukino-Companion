import * as T from 'three';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';

let classroomCount=0,ownedAreaTables=[];

// The gallery can look into this open model from above. Only the downward
// face of the acoustic ceiling is visible; it still casts a real roof shadow.
export function finishClassroomInterior(room){
 const group=new T.Group();group.name='classroom:ceiling-and-fixtures';room.add(group);
 const plaster=new T.MeshStandardMaterial({name:'classroom:acoustic-ceiling',color:'#e5e8e6',roughness:.95});
 plaster.shadowSide=T.DoubleSide;
 plaster.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 tilePosition;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntilePosition=position.xy;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 tilePosition;')
   .replace('#include <color_fragment>',`#include <color_fragment>
    vec2 grid=tilePosition/vec2(.91,.61)+.5;
    vec2 edge=min(fract(grid),1.-fract(grid)),aa=max(fwidth(grid),vec2(.0005));
    vec2 seam=(1.-smoothstep(vec2(.0018),.0024+aa,edge))*(1.-smoothstep(vec2(.06),vec2(.35),aa));
    diffuseColor.rgb*=1.-.18*max(seam.x,seam.y);`);
 };
 plaster.customProgramCacheKey=()=>'classroom-acoustic-tile-v1';
 const ceiling=new T.Mesh(new T.PlaneGeometry(10.33,9.13),plaster);
 ceiling.name='classroom:ceiling-underside';ceiling.position.y=3.245;ceiling.rotation.x=Math.PI/2;
 ceiling.castShadow=true;ceiling.receiveShadow=true;group.add(ceiling);
 // The frontal camera looks through the open, cutaway end of the miniature.
 // Continue its ceiling overhead in that view without enlarging the gallery
 // framing bounds or casting a fictitious roof shadow on the outside garden.
 const overhangGeometry=new T.PlaneGeometry(10.33,6);
 overhangGeometry.translate(0,9.13/2+3,0);
 const overhang=new T.Mesh(overhangGeometry,plaster);overhang.name='classroom:ceiling-camera-return';
 overhang.position.y=ceiling.position.y;overhang.rotation.x=ceiling.rotation.x;overhang.receiveShadow=true;

 const housing=new T.MeshStandardMaterial({name:'classroom:painted-light-housing',color:'#c7cbc2',roughness:.72});
 const opal=new T.MeshStandardMaterial({name:'classroom:lamp-opal-tube',color:'#edf0ef',roughness:.57,emissive:'#f3f7ff',emissiveIntensity:.68});
 const metal=new T.InstancedMesh(new T.BoxGeometry(1.27,.052,.21),housing,6);
 const glassTube=new T.CylinderGeometry(.018,.018,1.16,12);glassTube.rotateZ(Math.PI/2);
 const tube=new T.InstancedMesh(glassTube,opal,12);
 const sockets=new T.InstancedMesh(new T.BoxGeometry(.049,.057,.172),housing,12);
 const matrix=new T.Matrix4(),lamps=[];let index=0;
 for(const z of [-3.12,-.05,2.88])for(const x of [-2.45,2.4]){
  metal.setMatrixAt(index,matrix.makeTranslation(x,3.202,z));
  for(const [i,dz] of [-.055,.055].entries())tube.setMatrixAt(index*2+i,matrix.makeTranslation(x,3.166,z+dz));
  for(const [i,dx] of [-.594,.594].entries())sockets.setMatrixAt(index*2+i,matrix.makeTranslation(x+dx,3.173,z));
  index++;
 }
 metal.name='classroom:ceiling-fixture-housings';tube.name='classroom:ceiling-lamps';
 sockets.name='classroom:fluorescent-sockets';
 for(const fixture of [metal,tube,sockets]){fixture.computeBoundingSphere();group.add(fixture);}
 // The board has its own shielded, full-length wall washer. Its emitter faces
 // the writing surface, so the wall above it is lit only by reflected light.
 if(!T.UniformsLib.LTC_FLOAT_1){
  RectAreaLightUniformsLib.init();
  ownedAreaTables=['LTC_FLOAT_1','LTC_FLOAT_2','LTC_HALF_1','LTC_HALF_2'].map(name=>T.UniformsLib[name]);
 }
 classroomCount++;
 let disposed=false;
 const boardStrip=new T.RectAreaLight('#f5f8ff',3.1,3.64,.11);
 boardStrip.name='classroom:fluorescent-board';boardStrip.position.set(-2.65,2.375,-4.105);
 boardStrip.lookAt(-2.65,1.47,-4.445);group.add(boardStrip);
 const boardHousing=new T.Mesh(new T.BoxGeometry(3.76,.066,.16),housing);
 boardHousing.name='classroom:board-light-housing';boardHousing.position.copy(boardStrip.position);boardHousing.position.y+=.049;
 const boardLens=new T.Mesh(new T.PlaneGeometry(boardStrip.width,boardStrip.height),opal);
 boardLens.name='classroom:board-light-diffuser';boardLens.position.copy(boardStrip.position);
 boardLens.quaternion.copy(boardStrip.quaternion);boardLens.rotateY(Math.PI);group.add(boardHousing,boardLens);
 function illuminate(name,x,z,target,angle,candela){
  const lamp=new T.SpotLight('#f5f8ff',candela,6.25,angle,.84,2);lamp.name='classroom:fluorescent-'+name;
  lamp.position.set(x,3.13,z);lamp.target.position.fromArray(target);group.add(lamp,lamp.target);lamps.push({lamp,candela});
 }
 illuminate('left-desks',-2.45,-.05,[-2.32,.74,.07],1.10,12.5);
 illuminate('right-desks',2.4,-.05,[2.25,.74,-.42],1.14,12.5);
 illuminate('rear-desks',-2.45,2.88,[-1.8,.74,2.53],1.10,9.5);

 const count=110,positions=new Float32Array(count*6),rainGeometry=new T.BufferGeometry();
 rainGeometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));
 const rain=new T.LineSegments(rainGeometry,new T.LineBasicMaterial({color:'#b3c4ce',transparent:true,opacity:.43,depthWrite:false}));
 rain.name='weather:rain-classroom-exterior';rain.frustumCulled=false;rain.visible=false;
 function placeRain(time){
  for(let i=0;i<count;i++){
   const x=-5.24-(i*43%97)/43,z=-6.4+(i*71%149)/11;
   const y=T.MathUtils.euclideanModulo(i*.81-time*4.3,4.65);
   positions.set([x,y,z,x+.017,y-.19,z-.024],i*6);
  }
  rainGeometry.attributes.position.needsUpdate=true;
 }
 placeRain(0);
 const dust=room.getObjectByName('classroom:light-dust');
 // Soft volumetric sunbeams slanting through the left classroom windows onto
 // the desks and timber floor. Driven by actual sun incidence and cloud cover
 // so they vanish cleanly on overcast days, in rain, and at night.
 const beamGeometry=new T.PlaneGeometry(1.75,4.2);
 beamGeometry.translate(0,-2.1,0);
 const beamUniforms={uStrength:{value:0},uColor:{value:new T.Color('#ffe5b4')}};
 const beamMaterial=new T.ShaderMaterial({
  name:'classroom:window-sunbeam-material',uniforms:beamUniforms,
  transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,
  vertexShader:`varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
   void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`uniform float uStrength;uniform vec3 uColor;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
   void main(){
    float across=sin(clamp(vUv.x,0.,1.)*3.14159265);
    float edge=pow(across,1.35);
    float paneBreak=1.-.42*exp(-pow((vUv.x-.5)*14.,2.));
    float along=smoothstep(0.,.14,vUv.y)*(1.-smoothstep(.70,1.,vUv.y));
    float alpha=uStrength*edge*along*paneBreak;
    gl_FragColor=vec4(uColor,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 });
 const beams=[];
 for(const [i,wz] of [-2.45,.15,2.75].entries()){
  const mesh=new T.Mesh(beamGeometry,beamMaterial);
  mesh.name='classroom:window-sunbeam-'+i;mesh.position.set(-4.88,2.52,wz);
  mesh.castShadow=false;mesh.receiveShadow=false;mesh.renderOrder=3;
  group.add(mesh);beams.push(mesh);
 }
 const roomBounce={value:1};
 const receivers=new Set();
 // The ceiling, plaster and floor return the fluorescent light back into
 // this small room. Apply that local irradiance before the receiver's AO.
 // The shared outdoor sky and the garden materials have separate lighting.
 const roomGroups=['floor','walls','blackboard','teacher','props','desks','reading','curtains','door','wall-clock','ceiling-and-fixtures'];
 for(const name of roomGroups)room.getObjectByName('classroom:'+name)?.traverse(node=>{
  for(const material of [node.material].flat()){
   if(!(material?.isMeshStandardMaterial||material?.isMeshToonMaterial)||material.transparent||material.emissive?.getHex()||
      /outside|exterior|glass|shadow|wall-cut|wall-cap/.test(material.name))continue;
   receivers.add(material);
  }
 });
 for(const material of receivers){
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
   compile.call(this,shader,renderer);
   shader.uniforms.uClassroomBounce=roomBounce;
   shader.fragmentShader='uniform float uClassroomBounce;\n'+shader.fragmentShader.replace('#include <lights_fragment_end>',`
    // The lower envelope is a pale timber floor, the upper envelope neutral
    // ceiling tiles. Both return diffuse light to surfaces facing them.
    float roomUp=transformNormalByInverseViewMatrix(normal,viewMatrix).y;
    vec3 bounced=mix(vec3(.92,.96,1.00),vec3(.78,.86,.94),roomUp*.5+.5);
    irradiance+=bounced*uClassroomBounce;
    #include <lights_fragment_end>`);
  };
  material.customProgramCacheKey=()=>key+'|classroom-interreflection';
 }
 const values={
  'classroom:blackboard':[.94,0,.14], 'classroom:paper':[.98,0,.15], 'classroom:book-pages':[.96,0,.17],
  'classroom:window-metal':[.35,.66,.64], 'classroom:desk-metal':[.43,.46,.51],
  'classroom:desk-edge-wood':[.66,0,.34], 'classroom:wall':[.94,0,.22],
 };
 room.traverse(node=>{
  const m=node.material;
  if(!m?.name)return;
  const response=values[m.name]||(/^classroom:desk-wood-/.test(m.name)?[.55,0,.41]:null);
  if(response){const [roughness,metalness,envMapIntensity]=response;m.metalness=metalness;m.userData.surfaceFinish={roughness,metalness,envMapIntensity};m.userData.weatherExposure=false;}
 });
 return {
  exteriorRain:rain,
  overhang,
  setSunlight(direction,brightness,cloud){
   const clear=Math.max(0,1-cloud);
   const output=.66+.12*brightness+.06*cloud*brightness;
   for(const {lamp,candela} of lamps)lamp.intensity=candela*output;
   boardStrip.intensity=2.45*output;
   roomBounce.value=.96+.065*brightness+.065*cloud*brightness;
   opal.emissiveIntensity=.48+.10*brightness;
   const len=Math.max(.0001,direction.length());
   const windowIncidence=Math.max(0,-direction.x/len);
   const elevation=Math.max(0,direction.y/len);
   const shaftStrength=windowIncidence*brightness*clear*clear;
   if(dust)dust.material.opacity=shaftStrength*.20;
   beamUniforms.uStrength.value=shaftStrength*.14;
   beamUniforms.uColor.value.set('#ffdfa0').lerp(new T.Color('#ffb868'),Math.max(0,1-elevation*2.2)*.65);
   const slant=Math.atan2(Math.max(.22,-direction.x/len),Math.max(.28,elevation));
   const yaw=Math.atan2(-direction.z/len,Math.max(.25,-direction.x/len))*.35;
   for(const mesh of beams){
    mesh.visible=beamUniforms.uStrength.value>.004;
    mesh.rotation.set(0,yaw,Math.min(1.15,Math.max(.42,slant)));
   }
  },
  update(time){if(rain.visible)placeRain(time);},
  dispose(){
   if(disposed)return;
   disposed=true;
   // Keep Three's immutable CPU lookup tables available for the next area
   // light. Release our GPU uploads once the last live classroom goes away.
   if(--classroomCount===0)for(const texture of ownedAreaTables)texture.dispose();
  }
 };
}
