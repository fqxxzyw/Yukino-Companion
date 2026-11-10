import * as T from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {Refractor} from 'three/addons/objects/Refractor.js';
import {STREAM_LEVEL,STREAM_START,STREAM_END,streamCenter,streamHalfWidth,streamBedY} from './sakura-stream-layout.mjs';

// The two scene captures use Three's installed planar optics, while the flow
// phase belongs to the scene's explicit simulation time (never a hidden timer).
// The refracted bed supplies the colour; no opaque blue/grey water tint hides
// it. Flow follows the meandering channel, with slower water near its banks.
function normalMap(seed){
 const size=128,data=new Uint8Array(size*size*4),tau=Math.PI*2;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size*tau,v=y/size*tau,phase=seed*.71;
  const nx=.04*Math.sin(u*3+v*4+phase)+.027*Math.sin(u*7-v*2+phase*.7)+.016*Math.cos(u*11+v*9);
  const nz=.07*Math.cos(v*5+u+phase)+.035*Math.sin(v*9-u*3)+.014*Math.sin(v*13+u*7+phase);
  const k=(y*size+x)*4;data[k]=Math.round(128+nx*127);data[k+1]=Math.round(128+nz*127);data[k+2]=255;data[k+3]=255;
 }
 const texture=new T.DataTexture(data,size,size,T.RGBAFormat);texture.name='stream:procedural-flow-normal-'+seed;
 texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
 return texture;
}

export function addClearStream(b,renderer){
 // These stones interrupt the actual visible current. The same positions own
 // the wake field, so the choppy patches never appear without an obstruction.
 const obstacles=[[-1.28,-17,.45],[.75,-6.6,.52],[-1.18,3.8,.43],[1.05,16.2,.48]].map(([offset,z,radius])=>({x:streamCenter(z)+offset,z,radius}));
 const rockGeometry=b.own(new T.IcosahedronGeometry(1,2));
 const rockPositions=rockGeometry.attributes.position;
 for(let i=0;i<rockPositions.count;i++){
  const x=rockPositions.getX(i),y=rockPositions.getY(i),z=rockPositions.getZ(i),f=1+.09*Math.sin(x*7+z*5)+.045*Math.cos(y*9-z*6);
  rockPositions.setXYZ(i,x*f,y*f,z*f);
 }
 // Retain the radial, smoothly interpolated normals of the rounded stone;
 // recomputing normals on IcosahedronGeometry's unindexed triangles facets it.
 const rockMaterial=b.mat('stone:stream-current-boulders','#777e70',{roughness:.9});
 rockMaterial.userData.surfaceFinish={roughness:.9,metalness:0,envMapIntensity:.16};
 for(const [index,rock]of obstacles.entries()){
  const bed=streamBedY(rock.x,rock.z),halfHeight=(STREAM_LEVEL-bed+[.21,.28,.17,.24][index])/2;
  const mesh=b.mesh(rockGeometry,rockMaterial,[rock.x,bed+halfHeight-.025,rock.z],[rock.radius,halfHeight,rock.radius*.84]);
  mesh.name='stream:current-obstacle';mesh.userData.keep=true;
  rock.bedY=bed;rock.topY=bed+halfHeight*2-.025;
 }
 const positions=[],uvs=[],flowData=[],indices=[],rows=192,columns=8;
 for(let i=0;i<=rows;i++){
  const z=STREAM_START+(STREAM_END-STREAM_START)*i/rows,center=streamCenter(z),width=streamHalfWidth(z);
  const tangentX=(streamCenter(z+.04)-streamCenter(z-.04))/.08;
  for(let j=0;j<=columns;j++){const u=j/columns,lateral=(u*2-1)*width;positions.push(center+lateral,-z,0);uvs.push(u,i/rows);flowData.push(lateral,z,tangentX,width);}
  if(i)for(let j=0;j<columns;j++){const a=(i-1)*(columns+1)+j,c=i*(columns+1)+j;indices.push(a,c,a+1,a+1,c,c+1);}
 }
 const geometry=b.own(new T.BufferGeometry());geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setAttribute('streamFlow',new T.Float32BufferAttribute(flowData,4));geometry.setIndex(indices);geometry.computeVertexNormals();
 const normals=[normalMap(17),normalMap(43)];normals.forEach(t=>b.textures.add(t));
 const reflector=new Reflector(geometry,{textureWidth:768,textureHeight:768,clipBias:.002,multisample:0});
 const refractor=new Refractor(geometry,{textureWidth:1024,textureHeight:1024,clipBias:.002,multisample:0});
 reflector.matrixAutoUpdate=false;refractor.matrixAutoUpdate=false;
 const reflectionTarget=reflector.getRenderTarget(),refractionTarget=refractor.getRenderTarget();
 reflectionTarget.texture.name='stream:scene-reflection';refractionTarget.texture.name='stream:bed-refraction';
 const textureMatrix=new T.Matrix4();
 const uniforms={...T.UniformsUtils.clone(T.UniformsLib.fog),
  uReflection:{value:reflectionTarget.texture},uRefraction:{value:refractionTarget.texture},
  uNormal0:{value:normals[0]},uNormal1:{value:normals[1]},uTextureMatrix:{value:textureMatrix},
  uTime:{value:0},uRippleStrength:{value:.8},uSunDirection:{value:new T.Vector3(-.3,.8,.5).normalize()},uSunStrength:{value:1},
  uObstacles:{value:obstacles.map(o=>new T.Vector4(o.x,o.z,o.radius,1))},
 };
 const material=new T.ShaderMaterial({name:'stream:clear-reflection-refraction',uniforms,transparent:true,depthWrite:false,fog:true,
  vertexShader:/* glsl */`
   #include <common>
   #include <fog_pars_vertex>
   #include <logdepthbuf_pars_vertex>
   uniform mat4 uTextureMatrix;
   attribute vec4 streamFlow;
   varying vec4 vProjected;
   varying vec4 vFlow;
   varying vec3 vWorld;
   varying vec3 vToEye;
   void main(){
    vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;vToEye=cameraPosition-world.xyz;
    vFlow=streamFlow;
    vProjected=uTextureMatrix*vec4(position,1.0);
    vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
   }`,
  fragmentShader:/* glsl */`
   #include <common>
   #include <fog_pars_fragment>
   #include <logdepthbuf_pars_fragment>
   uniform sampler2D uReflection;
   uniform sampler2D uRefraction;
   uniform sampler2D uNormal0;
   uniform sampler2D uNormal1;
   uniform float uTime;
   uniform float uRippleStrength;
   uniform vec3 uSunDirection;
   uniform float uSunStrength;
   uniform vec4 uObstacles[4];
   varying vec4 vProjected;
   varying vec4 vFlow;
   varying vec3 vWorld;
   varying vec3 vToEye;
   void main(){
    #include <logdepthbuf_fragment>
    float bank=clamp(abs(vFlow.x)/max(vFlow.w,.1),0.0,1.0);
    float speed=mix(.82,.36,bank*bank);
    vec2 p=vec2(vFlow.x,vFlow.y-uTime*speed);
    // Two half-cycle-offset phases hide the reset of an advected normal field
    // (the Water2/Valve flow-map method), rather than sliding one flat texture.
    float phase0=fract(uTime/6.0),phase1=fract(phase0+.5);
    vec2 flow=vec2(.018*sin(vFlow.y*.19+vFlow.x),-speed*.58);
    vec2 base=vec2(vFlow.x*.72,vFlow.y*.58);
    vec2 slope0=texture2D(uNormal0,base+flow*(phase0*6.0)).rg*2.0-1.0;
    vec2 slope1=texture2D(uNormal1,base+flow*(phase1*6.0)+vec2(.36,.57)).rg*2.0-1.0;
    vec2 ripple=mix(slope1,slope0,1.0-abs(phase0*2.0-1.0));
    // Broader downstream wavelets survive the walking-height view. Their
    // normals and the refracted stone distortion move together at m/s scale.
    float wave=p.y*12.6+sin(p.x*2.8+p.y*.7)*.7+sin(p.x*4.1+p.y*1.2)*1.3+sin(p.x*1.7-p.y*2.9)*.9;
    float fine=p.y*24.0+p.x*5.8+sin(p.y*1.1)*.5;
    float chop=sin(p.x*3.3+p.y*1.6)*sin(p.y*2.1-p.x*.7);
    vec2 localSlope=(ripple*1.35+vec2(.048*cos(wave+p.x),.105*cos(wave)+.052*cos(fine)))*(uRippleStrength+.12*chop);
    vec2 downstream=normalize(vec2(vFlow.z,1.0));
    vec2 across=vec2(downstream.y,-downstream.x);
    vec2 slope=across*localSlope.x+downstream*localSlope.y;
    float wakeStrength=0.0;
    for(int i=0;i<4;i++){
     vec2 delta=vWorld.xz-uObstacles[i].xy;
     float along=dot(delta,downstream),lateral=dot(delta,across),radius=uObstacles[i].z;
     float tail=max(0.0,along-radius*.4),spread=radius*.8+tail*.21;
     float envelope=smoothstep(0.0,radius*.6,along)*exp(-tail*.42)*exp(-pow(lateral/max(spread,.01),2.0));
     float wakePhase=(tail-abs(lateral)*.82)*15.5-uTime*9.0;
     float pulse=.8+.2*sin(uTime*1.7+float(i)*1.9);
     slope+=(downstream*.22*cos(wakePhase)+across*.14*sin(wakePhase+lateral*5.0))*envelope*pulse;
     wakeStrength+=envelope;
    }
    vec3 normal=normalize(vec3(slope.x,1.0,slope.y));
    vec3 eye=normalize(vToEye);
    float cosine=clamp(dot(normal,eye),0.0,1.0);
    float fresnel=.02+.98*pow(1.0-cosine,5.0);
    vec3 projection=vProjected.xyz/max(vProjected.w,.0001);
    // Strong enough to read moving refraction, small enough for individual
    // submerged pebbles to remain identifiable through the deeper water.
    vec2 distortion=slope*.032*clamp(projection.z,.2,1.0);
    vec2 refractUv=clamp(projection.xy+distortion,vec2(.001),vec2(.999));
    vec2 reflectUv=clamp(vec2(1.0-projection.x,projection.y)+distortion,vec2(.001),vec2(.999));
    vec3 bed=texture2D(uRefraction,refractUv).rgb*vec3(.984,.996,.998);
    vec3 reflected=texture2D(uReflection,reflectUv).rgb;
    // Restrained moving caustic modulation is a visual approximation on the
    // shallow bed, not a claim of a physically solved light transport volume.
    float caustic=pow(.5+.5*sin(p.x*9.0+sin(p.y*6.1)*1.4),12.0);
    caustic*=pow(.5+.5*sin(p.y*8.3+sin(p.x*4.0)),5.0);
    bed*=1.0+caustic*.24*uSunStrength;
    vec3 water=mix(bed,reflected,clamp(fresnel,.02,.84));
    vec3 halfVector=normalize(normalize(uSunDirection)+eye);
    // Directional solar microfacet reflection: surface slopes determine where
    // glints appear. GGX has a broad weak tail and sparse brilliant facets;
    // cloud/night attenuation comes from the scene's real sunlight state.
    float nDotH=max(dot(normal,halfVector),0.0),nDotL=max(dot(normal,normalize(uSunDirection)),0.0);
    float nDotV=max(dot(normal,eye),.035),vDotH=max(dot(eye,halfVector),0.0);
    float roughness=.14+.025*clamp(wakeStrength,0.0,1.0),alpha=roughness*roughness;
    float denom=nDotH*nDotH*(alpha*alpha-1.0)+1.0;
    float distribution=alpha*alpha/(3.14159265*denom*denom);
    float k=pow(roughness+1.0,2.0)/8.0;
    float masking=nDotV/(nDotV*(1.0-k)+k)*nDotL/max(nDotL*(1.0-k)+k,.001);
    float solarFresnel=.02+.98*pow(1.0-vDotH,5.0);
    float glint=min(2.6,distribution*masking*solarFresnel/max(4.0*nDotV,.05)*45.0)*uSunStrength;
    float capillary=pow(.5+.5*sin(p.x*65.0+sin(p.y*29.0)*1.8),16.0)*pow(.5+.5*sin(p.y*54.0+p.x*18.0),11.0);
    water+=vec3(1.0,.97,.86)*glint*(.72+capillary*2.6);
    // Thin, broken reflection streaks travel with the current. They modulate
    // existing reflected light rather than drawing an opaque foam blanket.
    float thread=pow(.5+.5*sin(p.x*19.0+sin(p.y*1.7)*1.2),18.0);
    thread*=pow(.5+.5*sin(p.y*3.4+sin(p.x*4.7)),9.0);
    float streak=thread*(.012+.035*fresnel)*(.15+.85*uSunStrength);
    water+=reflected*streak;
    gl_FragColor=vec4(water,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
   }`,
 });
 b.materials.add(material);
 const mesh=new T.Mesh(geometry,material);mesh.name='stream:clear-water-surface';mesh.rotation.x=-Math.PI/2;mesh.position.y=STREAM_LEVEL;mesh.userData.keep=true;mesh.userData.clearWater=true;mesh.castShadow=false;mesh.receiveShadow=false;b.root.add(mesh);
 let disposed=false,capturing=false,enabled=true,started=false,lastInput=null,flowTime=0;
 const viewport=new T.Vector4();
 mesh.onBeforeRender=(gl,scene,camera)=>{
  if(disposed||capturing||camera.userData.refractor)return;
  capturing=true;const visible=mesh.visible,target=gl.getRenderTarget(),cube=gl.getActiveCubeFace?.(),mip=gl.getActiveMipmapLevel?.(),xr=gl.xr.enabled,shadowAuto=gl.shadowMap.autoUpdate;
  gl.getCurrentViewport(viewport);const savedViewport=viewport.clone();
  try{
   textureMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(mesh.matrixWorld);
   mesh.visible=false;reflector.matrixWorld.copy(mesh.matrixWorld);refractor.matrixWorld.copy(mesh.matrixWorld);
   reflector.onBeforeRender(gl,scene,camera);refractor.onBeforeRender(gl,scene,camera);
  }finally{
   mesh.visible=visible;gl.xr.enabled=xr;gl.shadowMap.autoUpdate=shadowAuto;gl.setRenderTarget(target,cube,mip);gl.state.viewport(savedViewport);capturing=false;
  }
 };
 const metadata={level:STREAM_LEVEL,startZ:STREAM_START,endZ:STREAM_END,flowDirection:'+Z',flowSpeed:{center:.82,bank:.36},flowCycleSeconds:6,fresnelF0:.02,bedTransmission:[.984,.996,.998],reflectionSize:768,refractionSize:1024,authoritativeTime:true,turbulence:'obstacle-wakes',obstacles:obstacles.map(o=>({...o})),solarReflection:'GGX'};
 mesh.userData.waterOptics=metadata;
 return {mesh,material,normalMaps:normals,renderTargets:[reflectionTarget,refractionTarget],metadata,
  update(time){if(disposed||!Number.isFinite(time))return;if(!started){started=true;if(enabled)flowTime=Math.max(0,time);}else if(enabled&&lastInput!==null)flowTime+=Math.max(0,time-lastInput);lastInput=time;uniforms.uTime.value=flowTime;},
  setMotion({enabled:next}){if(disposed||Boolean(next)===enabled)return;enabled=Boolean(next);lastInput=null;},
  setSunlight(direction,brightness=1,cloud=0){if(disposed)return;if(direction?.isVector3)uniforms.uSunDirection.value.copy(direction).normalize();else if(Array.isArray(direction))uniforms.uSunDirection.value.fromArray(direction).normalize();uniforms.uSunStrength.value=T.MathUtils.clamp(brightness,0,1)*(1-T.MathUtils.clamp(cloud,0,1)*.88);},
  setWind(wind){if(disposed)return;uniforms.uRippleStrength.value=.7+(Number.isFinite(wind)?T.MathUtils.clamp(wind,0,1):.25)*.55;},
  dispose(){if(disposed)return;disposed=true;mesh.onBeforeRender=()=>{};reflector.dispose();refractor.dispose();},
 };
}
