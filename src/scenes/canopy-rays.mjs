import * as T from 'three';

// A bounded atmospheric illustration: three canopy apertures, each terminating
// at the ground plane. No glow volume extends through the opaque path.
export function canopyRays(builder){
 const geometry=builder.own(new T.CylinderGeometry(.045,.48,1,18,1,true));
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,
  uniforms:{uStrength:{value:0}},
  vertexShader:`varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
   void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=-p.xyz;gl_Position=projectionMatrix*p;}`,
  fragmentShader:`uniform float uStrength;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
   void main(){float edge=pow(abs(dot(normalize(vNormal),normalize(vView))),1.7);
    float ends=smoothstep(0.0,.2,vUv.y)*(1.0-smoothstep(.86,1.0,vUv.y));
    gl_FragColor=vec4(vec3(.88,.93,.71),uStrength*edge*ends);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 material.name='canopy:atmospheric-rays';builder.materials.add(material);
 const receivers=[[-.4,.26,5.2],[.15,.26,.5],[-.65,.26,-4.5]],heights=[6.4,7,6.6];
 const rays=receivers.map(p=>{const mesh=builder.mesh(geometry,material,p);mesh.userData.keep=true;mesh.castShadow=false;mesh.receiveShadow=false;return mesh;});
 return (direction,brightness,cloud,rayWindow=1)=>{
  const dir=direction.clone().normalize();material.uniforms.uStrength.value=brightness*(1-cloud)*(1-cloud)*.22*rayWindow;
  rays.forEach((mesh,i)=>{const end=new T.Vector3(...receivers[i]);mesh.visible=brightness>.12&&dir.y>.28&&cloud<.95&&rayWindow>.01;
   const length=(heights[i]-end.y)/Math.max(.28,dir.y),top=end.clone().addScaledVector(dir,length);
   mesh.visible=mesh.visible&&Math.abs(top.x)<10&&Math.abs(top.z)<12;
   mesh.position.copy(end).addScaledVector(dir,length*.5);mesh.scale.set(1,length,1);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),dir);
  });
 };
}
