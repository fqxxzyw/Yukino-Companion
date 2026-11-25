import * as T from 'three';
import {createMeadowPatch} from './sakura-ground.mjs';

export function kasaiLawn(root) {
  const receivers=[];
  root.traverse(o=>{if(o.isMesh&&/^(lawn|bank-left|bank-right|plaza|path-left|path-right)$/.test(o.name))receivers.push(o);});
  root.updateMatrixWorld(true);
  const ray=new T.Raycaster(),points=[],ground=new T.Color('#699553');
  let seed=97337;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  ray.ray.direction.set(0,-1,0);
  // Lush seaside meadow tufts concentrated across the sloped Crystal View banks
  // and visible flanking park lawns so no smooth plastic grass surface shows.
  for(let i=0;i<1850;i++){
    const onBank=i<750;
    const side=random()<.5?-1:1;
    const centerZ=onBank?-14.6+random()*8.2:-6.5+random()*45;
    const centerX=onBank?side*(5.2+random()*32.5):side*(11+random()*30.5);
    const count=onBank?11:8;
    for(let j=0;j<count;j++){
      const x=centerX+(random()-.5)*2.1,z=centerZ+(random()-.5)*1.5;
      ray.ray.origin.set(x,3,z);
      const hit=ray.intersectObjects(receivers,false)[0];
      if(hit?.object.material.name!=='lawn')continue;
      points.push({x,z,y:hit.point.y+.002,size:.14+random()*.19,ry:random()*Math.PI*2});
    }
  }
  const patch=createMeadowPatch(points,{name:'foliage:coastal-meadow',groundColor:ground});
  root.add(patch.mesh);return patch;
}

// Repeated, stationary fittings from the supplied scene share source geometry.
// Preserve named objects for inspection and the original factory's disposal.
export function batchCoastalFittings(root) {
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert(),groups=new Map();
  root.traverseVisible(o=>{
    if(!o.isMesh||o.isInstancedMesh||o.children.length||!o.material?.isMeshStandardMaterial||o.material.transparent)return;
    const key=[o.material.id,o.geometry.id,o.castShadow,o.receiveShadow].join('.');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(o);
  });
  const matrix=new T.Matrix4();
  for(const objects of groups.values()){
    if(objects.length<5)continue;
    const first=objects[0],batch=new T.InstancedMesh(first.geometry,first.material,objects.length);
    batch.name=first.name+'-fixtures';batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;
    objects.forEach((o,i)=>{batch.setMatrixAt(i,matrix.multiplyMatrices(inverse,o.matrixWorld));o.visible=false;});
    batch.computeBoundingSphere();root.add(batch);
  }
}

// A continuous sea beneath the display slab. Its distant rim is the horizon;
// the gallery camera can orbit without looking across a cut side of a plane.
export function addCoast(scene,{shoreZ,halfWidth,name}) {
  const radius=1250+Math.abs(shoreZ);
  const geometry=new T.RingGeometry(0,radius,160,16);
  geometry.rotateX(-Math.PI/2);
  const position=geometry.attributes.position;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),z=position.getZ(i),ring=Math.hypot(x,z)/radius;
    // Concentrate rings near the plinth. The rear rim keeps the original
    // distance and elevation, including its separation from the Kasai roof.
    const distance=ring*ring;
    position.setXYZ(i,x*ring,-2.8-distance*distance*23,z*ring);
  }
  position.needsUpdate=true;
  geometry.computeBoundingSphere();
  const uniforms={
    uSky:{value:null},uHasSky:{value:0},uSkyIntensity:{value:1},uSun:{value:new T.Vector3()},
    uDay:{value:1},uSunStrength:{value:1},uRain:{value:0},uCloud:{value:0},
    uPainted:{value:0},uTime:{value:0},uShore:{value:shoreZ},uWidth:{value:halfWidth},
  };
  const material=new T.ShaderMaterial({name:'water:coastal-shelf',uniforms,transparent:true,depthWrite:false,
    vertexShader:`
      varying vec3 vBayWorld;
      void main(){
        vec4 world=modelMatrix*vec4(position,1.);
        vBayWorld=world.xyz;
        gl_Position=projectionMatrix*viewMatrix*world;
      }`,fragmentShader:`
      #include <common>
      varying vec3 vBayWorld;
      uniform sampler2D uSky;
      uniform vec3 uSun;
      uniform float uSkyIntensity,uHasSky,uDay,uSunStrength,uRain,uCloud,uPainted,uTime,uWidth,uShore;
      float wave(vec2 p,vec2 direction,float speed){
        float phase=dot(p,direction)+uTime*speed;
        float fw=fwidth(phase);
        return cos(phase)*(1.-smoothstep(.35,1.45,fw));
      }
      void main(){
        vec2 p=vBayWorld.xz;
        vec3 towardEye=cameraPosition-vBayWorld;
        vec3 eye=normalize(towardEye);
        float distanceToEye=length(towardEye);
        float nearField=1.-smoothstep(55.,320.,distanceToEye);
        float midField=1.-smoothstep(140.,640.,distanceToEye);
        // Gentle domain warp breaks periodic striping at overview angles while
        // keeping long-period swell bands parallel to the Tokyo Bay horizon.
        vec2 swells=p+vec2(
          3.4*sin(p.y*.024+p.x*.019)+1.8*cos(p.x*.041-p.y*.031),
          4.8*sin(p.x*.036+p.y*.015)+2.2*cos(p.x*.095-p.y*.028)
        );
        float longWave=wave(swells,vec2(.045,.21),.28)*midField;
        float crossWave=wave(swells,vec2(-.095,.29),-.42)*midField;
        float diagWave=wave(swells,vec2(.16,.18),.36)*nearField;
        float ripple=(wave(swells,vec2(.35,1.55),.92)+.45*wave(swells,vec2(-.55,2.25),1.28))*nearField;
        float slope=(longWave*.038+crossWave*.026+diagWave*.018+ripple*.032)*(1.+uRain*.45);
        vec3 n=normalize(vec3((crossWave*.022-diagWave*.016)*midField,1.,slope));
        vec3 ray=reflect(-eye,n);
        ray.y=max(.014,ray.y);
        vec3 sky=uHasSky>.5?texture2D(uSky,equirectUv(normalize(ray))).rgb*uSkyIntensity:vec3(.28,.54,.68);
        vec3 horizonRay=normalize(vec3(ray.x,.02,ray.z));
        vec3 horizonSky=uHasSky>.5?texture2D(uSky,equirectUv(horizonRay)).rgb*uSkyIntensity:vec3(.45,.66,.78);
        float farBand=smoothstep(65.,780.,distanceToEye);
        float horizonRim=smoothstep(720.,1240.,distanceToEye);
        // Clear-day Tokyo Bay shifts from luminous turquoise-cerulean near the
        // seawall to rich azure marine blue toward the open bay.
        vec3 nearCol=mix(vec3(.012,.275,.385),vec3(.016,.315,.415),uPainted);
        vec3 farCol=mix(vec3(.012,.165,.335),vec3(.018,.195,.375),uPainted);
        vec3 water=mix(nearCol,farCol,farBand);
        water=mix(water,vec3(.11,.17,.21),uCloud*.68);
        water*=.085+.915*uDay;
        float fresnel=.038+.962*pow(1.-max(dot(n,eye),0.),5.);
        water=mix(water,sky,.11+fresnel*(.22+.16*nearField));
        // Anti-aliased painterly current bands in gouache mode: strictly gated
        // by derivative width so overview angles never form zebra moire rings.
        float swellBand=longWave*.52+crossWave*.32+diagWave*.16;
        float bandAA=max(.14,fwidth(swellBand)*1.8);
        float stroke=smoothstep(.24-bandAA,.58+bandAA,swellBand)*midField*(1.-smoothstep(.22,.65,fwidth(swellBand)));
        water+=sky*mix(.011*ripple,.034*stroke,uPainted)*nearField;
        // Crisp distant sea-horizon transition into atmospheric sky colour.
        water=mix(water,mix(water,horizonSky,.65),horizonRim*.45);
        float spark=pow(max(0.,dot(n,normalize(eye+uSun))),160.);
        float paintedSpark=smoothstep(.16,.46,spark)*.38;
        water+=vec3(1.,.88,.64)*mix(spark*.66,paintedSpark,uPainted)*uSunStrength;
        vec2 beyondSlab=max(abs(p)-vec2(uWidth,abs(uShore)),0.);
        float shoreDist=length(beyondSlab);
        float wash=(1.-smoothstep(.0,3.2,shoreDist))*(.76+.24*longWave);
        float foamLine=(1.-smoothstep(.0,.85,shoreDist))*(.65+.35*ripple)*uDay;
        water=mix(water,sky*.72+vec3(.14,.21,.19)*uDay,wash*.46);
        water+=vec3(.32,.39,.40)*foamLine*.24;
        // The open-water side remains opaque. On the landward side the sea
        // gradually yields to the actual background behind the miniature;
        // this is independent of the camera's zoom, style and time of day.
        float coverage=1.-smoothstep(.08,1.78,p.y/uWidth);
        gl_FragColor=vec4(max(vec3(0.),water),coverage);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh=new T.Mesh(geometry,material);mesh.name=name;
  // Composite against the sky before any partially transparent curtain panes.
  mesh.renderOrder=-100;scene?.add(mesh);
  return {
    mesh,
    update(time){uniforms.uTime.value=time;},
    setSky(texture,intensity,{sun,weather,renderStyle}){
      uniforms.uSky.value=texture?.isTexture?texture:null;
      uniforms.uHasSky.value=texture?.mapping===T.EquirectangularReflectionMapping?1:0;
      uniforms.uSkyIntensity.value=intensity;
      uniforms.uSun.value.fromArray(sun.direction);
      uniforms.uDay.value=sun.brightness;uniforms.uSunStrength.value=sun.directScale;
      uniforms.uRain.value=weather?.rain||0;uniforms.uCloud.value=weather?.cloud||0;
      uniforms.uPainted.value=renderStyle==='toon'?1:0;
    },
    dispose(){mesh.removeFromParent();uniforms.uSky.value=null;geometry.dispose();material.dispose();},
  };
}

// Curtain panes have no opaque diffuse coat. Reflect the actual displayed
// panorama using the pane normal while the far stairs remain visible through
// both the front and the back of the building.
export function clearCurtain(root) {
  const sky={value:null},intensity={value:0},painted={value:0},materials=new Set();
  root.traverse(object=>{
    const m=object.material;
    if(m?.name==='glass:sheen')object.visible=false;
    if(!['glass:facade','glass:balustrade'].includes(m?.name)||materials.has(m))return;
    materials.add(m);
    m.userData.surfaceFinish={roughness:.07,metalness:0,envMapIntensity:1};
    const compile=m.onBeforeCompile,cacheKey=m.customProgramCacheKey();
    m.onBeforeCompile=function(shader,renderer){
      compile.call(this,shader,renderer);
      Object.assign(shader.uniforms,{uCurtainSky:sky,uCurtainStrength:intensity,uCurtainPaint:painted});
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
        '#include <common>\nuniform sampler2D uCurtainSky;\nuniform float uCurtainStrength,uCurtainPaint;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        float glassFacing=clamp(abs(dot(normal,normalize(vViewPosition))),0.,1.);
        float glassRim=pow(1.-glassFacing,3.5);
        if(uCurtainStrength>0.){
          vec3 glassRay=inverseTransformDirection(reflect(-normalize(vViewPosition),normal),viewMatrix);
          outgoingLight=texture2D(uCurtainSky,equirectUv(glassRay)).rgb*uCurtainStrength;
          glassRim=mix(glassRim,smoothstep(.06,.90,glassRim),uCurtainPaint*.24);
        }
        diffuseColor.a=.048+glassRim*.78;
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey=()=>cacheKey+'|clear-curtain';
  });
  return (texture,value,{renderStyle})=>{
    sky.value=texture?.isTexture?texture:null;
    intensity.value=texture?.mapping===T.EquirectangularReflectionMapping?value:0;
    painted.value=renderStyle==='toon'?1:0;
  };
}
