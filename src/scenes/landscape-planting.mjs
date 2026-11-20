import * as T from 'three';

// A tussock has a basal fan, leaves that arch back toward the ground, and a
// few fine flowering panicles. All lengths below are in metres at unit scale.
export function tussockGeometry(){
 const p=[],colors=[],uv=[],indices=[];
 const base=new T.Color('#61724e'),tip=new T.Color('#c4d398'),dry=new T.Color('#cabe8f'),tone=new T.Color();
 function vertex(x,y,z,c,u,v){p.push(x,y,z);colors.push(c.r,c.g,c.b);uv.push(u,v);}
 for(let blade=0;blade<16;blade++){
  const angle=blade*2.39996,dx=Math.cos(angle),dz=Math.sin(angle);
  const tall=.27+.25*((blade*7)%13)/12,reach=.16+.20*((blade*3)%11)/10;
  const bladeTip=blade%6===0?dry:tip,first=p.length/3;
  for(let j=0;j<=5;j++){
   const t=j/5,center=.012+reach*Math.pow(t,1.38),y=tall*(1.65*t-.99*t*t);
   const width=.012*(1+.35*Math.sin(Math.PI*t))*Math.pow(1-t,.66);
   tone.copy(base).lerp(bladeTip,Math.sqrt(t));
   for(let side=-1;side<=1;side++)vertex(dx*center-dz*width*side,y+(side===0?width*.58:0),dz*center+dx*width*side,tone,(side+1)*.5,t);
   if(j){const i=first+(j-1)*3;indices.push(i,i+1,i+3,i+1,i+4,i+3,i+1,i+2,i+4,i+2,i+5,i+4);}
  }
 }
 const straw=new T.Color('#bdad76');
 for(let plume=0;plume<3;plume++){
  const angle=plume*2.32+.4,dx=Math.cos(angle),dz=Math.sin(angle),height=.40+plume*.066,start=p.length/3;
  for(let j=0;j<=6;j++){
   const t=j/6,r=.11*t*t,half=.0028*(1-t*.72);
   for(const side of [-1,1])vertex(dx*r-dz*side*half,height*t,dz*r+dx*side*half,straw,(side+1)*.5,t);
   if(j){const i=start+j*2-2;indices.push(i,i+1,i+2,i+2,i+1,i+3);}
  }
  for(let spike=0;spike<13;spike++){
   const t=.70+spike*.022,a=spike*2.39996,r=.11*t*t,x=dx*r,y=height*t,z=dz*r;
   const sx=Math.cos(a)*.027,sz=Math.sin(a)*.027,i=p.length/3;
   vertex(x,y,z,straw,.5,0);vertex(x+sx*.8-sz*.21,y+.020,z+sz*.8+sx*.21,dry,0,.5);
   vertex(x+sx,y+.046,z+sz,dry,.5,1);vertex(x+sx*.8+sz*.21,y+.020,z+sz*.8-sx*.21,dry,1,.5);indices.push(i,i+1,i+2,i,i+2,i+3);
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}

export function plantTussocks(sites,name){
 const material=new T.MeshStandardMaterial({color:'#ffffff',vertexColors:true,side:T.DoubleSide,roughness:.98,metalness:0});
 material.name='leaf:native-sedge';material.userData.botanicalKind='grass';material.userData.surfaceFinish={roughness:.98,metalness:0,envMapIntensity:.08};
 const mesh=new T.InstancedMesh(tussockGeometry(),material,sites.length),o=new T.Object3D(),color=new T.Color(),dry=new T.Color('#e4cf96'),green=new T.Color('#91ab76');
 sites.forEach(({x,y,z,scale,angle,tone},i)=>{
  o.position.set(x,y-.008,z);o.rotation.y=angle;o.scale.set(scale,scale*(.83+.27*tone),scale);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);
  mesh.setColorAt(i,color.copy(green).lerp(dry,tone*.73));
 });
 mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();return mesh;
}
/** Each frond has paired pinnae on an arching rachis, sharing a single mesh. */
export function plantFerns(b,sites,name){
 const positions=[],colors=[],indices=[],uv=[];
 const rootColor=new T.Color('#365c4c'),tipColor=new T.Color('#a1bb70'),tint=new T.Color();
 function addPoint(x,y,z,t,s){positions.push(x,y,z);tint.copy(rootColor).lerp(tipColor,t);colors.push(tint.r,tint.g,tint.b);uv.push(s,t);}
 for(let frond=0;frond<8;frond++){
  const a=frond*2.39996,dx=Math.cos(a),dz=Math.sin(a),reach=.39+.12*(frond%3),height=.42+.05*(frond%4);
  const pos=t=>({x:dx*reach*t*t,z:dz*reach*t*t,y:height*(1.95*t-1.32*t*t)});
  for(let pair=0;pair<9;pair++){
   const t=pair/9,next=(pair+1)/9,p=pos(t),q=pos(next);
   const base=positions.length/3;
   addPoint(p.x-dz*.003,p.y,p.z+dx*.003,t,.4);addPoint(p.x+dz*.003,p.y,p.z-dx*.003,t,.6);
   addPoint(q.x-dz*.003,q.y,q.z+dx*.003,next,.4);addPoint(q.x+dz*.003,q.y,q.z-dx*.003,next,.6);indices.push(base,base+1,base+2,base+1,base+3,base+2);
   if(pair===0)continue;
   const span=.135*Math.pow(Math.sin(t*Math.PI),.73);
   for(const side of [-1,1]){
    const sx=-dz*side*span,sz=dx*side*span,i=positions.length/3;
    addPoint(p.x,p.y,p.z,t*.73,.5);addPoint(p.x+sx*.55,p.y+.010,p.z+sz*.55,t*.90,0);
    addPoint(p.x+sx+dx*.073,p.y-.018,p.z+sz+dz*.073,t*.9+.10,.5);
    addPoint(p.x+sx*.48+dx*.052,p.y+.029,p.z+sz*.48+dz*.052,t*.75,1);
    indices.push(i,i+1,i+2,i,i+2,i+3);
   }
  }
 }
 const g=b.own(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
 const m=b.mat('leaf:fern-fronds','#ffffff',{vertexColors:true,side:T.DoubleSide,roughness:.97});m.userData.botanicalKind='fern';
 const mesh=new T.InstancedMesh(g,m,sites.length),o=new T.Object3D(),c=new T.Color();
 sites.forEach(({x,y,z,scale,angle,tone},i)=>{o.position.set(x,y-.015,z);o.rotation.y=angle;o.scale.setScalar(scale);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,c.setRGB(.71+tone*.27,.82+tone*.15,.71+tone*.26));});
 mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();b.instances.push(mesh);b.root.add(mesh);return mesh;
}
