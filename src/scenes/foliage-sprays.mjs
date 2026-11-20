import * as T from 'three';

// A spray of leaves on a curved twig, baked once into a cutout texture for stable
// subpixel coverage. The three bent faces have actual depth and share one map.
function sprayTexture(){
 const size=192,pixels=new Uint8Array(size*size*4);
 const pale=[152,184,142];
 let seed=42017;
 const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const ink=(x,y,r,g,b,a)=>{
  if(x<0||y<0||x>=size||y>=size)return;
  const i=(y*size+x)*4;
  pixels[i]=r;pixels[i+1]=g;pixels[i+2]=b;pixels[i+3]=Math.max(pixels[i+3],a);
 };
 // Edge dilation preserves colour when fully transparent pixels enter a mip.
 for(let i=0;i<pixels.length;i+=4){pixels[i]=140;pixels[i+1]=165;pixels[i+2]=111;}
 function stroke(ax,ay,bx,by,width,color){
  const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
  for(let n=0;n<=len*1.5;n++){
   const t=n/(len*1.5),px=ax+dx*t,py=ay+dy*t;
   for(let y=Math.floor(py-width);y<=py+width;y++)for(let x=Math.floor(px-width);x<=px+width;x++){
    const alpha=Math.min(1,width-Math.hypot(x-px,y-py)+.65);
    if(alpha>0)ink(x,y,...color,alpha*255);
   }
  }
 }
 function blade(ax,ay,bx,by,width,tone){
  const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;
  const xmin=Math.max(0,Math.floor(Math.min(ax,bx)-width-1)),xmax=Math.min(size-1,Math.ceil(Math.max(ax,bx)+width+1));
  const ymin=Math.max(0,Math.floor(Math.min(ay,by)-width-1)),ymax=Math.min(size-1,Math.ceil(Math.max(ay,by)+width+1));
  for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){
   const u=((x-ax)*dx+(y-ay)*dy)/(len*len);if(u<=0||u>=1)continue;
   const cross=(x-ax)*nx+(y-ay)*ny,span=Math.pow(Math.sin(u*Math.PI),.80)*width*(1-.20*u);
   const alpha=Math.min(1,span-Math.abs(cross)+.55);if(alpha<=0)continue;
   const face=cross>0?1.03:.89,vein=1-Math.min(1,Math.abs(cross-u*.6)/1.05);
   const value=(tone+u*.09+vein*.06)*face;
   ink(x,y,pale[0]*value,pale[1]*value,pale[2]*value,alpha*255);
  }
 }
 for(let fan=0;fan<10;fan++){
  const t=(fan+.5)/10,side=fan%2?1:-1;
  const base=[79+13*t,12+85*t],tip=[96+side*(42+26*Math.sin(t*Math.PI*.9)),65+84*t];
  stroke(...base,...tip,.95,[101,112,71]);
  for(let pair=0;pair<7;pair++){
   const u=(pair+.3)/7,px=T.MathUtils.lerp(base[0],tip[0],u),py=T.MathUtils.lerp(base[1],tip[1],u);
   for(const outer of [-1,1]){
    const angle=Math.atan2(tip[1]-base[1],tip[0]-base[0])+outer*(.48+random()*.64);
    const length=(15+random()*14)*(1-.35*u);
    blade(px,py,px+Math.cos(angle)*length,py+Math.sin(angle)*length,3.5+random()*3,.69+t*.35+random()*.18);
   }
  }
 }
 const texture=new T.DataTexture(pixels,size,size);
 texture.name='foliage:compound-leaf-spray';texture.colorSpace=T.SRGBColorSpace;
 texture.generateMipmaps=true;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
 return texture;
}

export function addBoughs(b,sites,name='foliage:branch-tip-sprays'){
 if(!sites.length)return;
 if(!b.boughResources){
  const texture=sprayTexture();b.textures.add(texture);
  // Root, split shoulders and drooping outer tips. Inclined vertex normals
  // approximate the many small leaf surfaces within each cluster.
  const geometry=b.own(new T.BufferGeometry());
  geometry.setAttribute('position',new T.Float32BufferAttribute([-.46,.04,-.20, 0,0,0, .42,.02,-.17, -.5,.76,.08, -.04,.91,.27, .5,.78,.07],3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,.5,0,1,0,0,1,.5,1,1,1],2));
  geometry.setAttribute('normal',new T.Float32BufferAttribute([-.48,.76,.44,0,.88,.47,.52,.72,.44,-.65,.66,.38,0,.77,.64,.63,.69,.36],3));
  geometry.setIndex([0,1,3,3,1,4,1,2,4,4,2,5]);
  const material=b.mat('foliage:compound-leaf-sprays','#ffffff',{map:texture,alphaTest:.29,side:T.DoubleSide,roughness:.96});
  material.userData.botanicalKind='spray';material.userData.surfaceFinish={roughness:.96,metalness:0,envMapIntensity:.12};
  b.boughResources={geometry,material};
 }
 const {geometry,material}=b.boughResources,mesh=new T.InstancedMesh(geometry,material,sites.length);
 const object=new T.Object3D();
 sites.forEach(({x,y,z,yaw,tilt,width,height,color},i)=>{
  object.position.set(x,y,z);object.rotation.set(0,yaw,0);object.rotateX(tilt);
  object.scale.set(width,height,width);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);mesh.setColorAt(i,color);
 });
 mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();
 b.root.add(mesh);b.instances.push(mesh);return mesh;
}
export function addCedarStand(b,trees){
 if(!trees.length)return;
 const w=128,h=224,data=new Uint8Array(w*h*4);
 // Distant cedar sprays overlap in asymmetric descending tiers, with a
 // continuous green centre. Three intersecting projections give the spire
 // its width around the full orbit.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const t=y/(h-1),lateral=(x+.5-w*.5)/(w*.5),side=lateral>0?1:-1;
  const row=t*9+.10*Math.sin(t*35+side),layer=row-Math.floor(row);
  const crown=Math.pow(1-t,.70)*(.74+.26*(1-layer))*Math.min(1,.5+t*8);
  const grain=Math.sin(x*33.13+y*17.01)*Math.cos(x*.21+y*.81);
  const dist=crown+.045*grain*(1-t)-Math.abs(lateral-.033*Math.sin(t*18));
  const pigment=.68+.23*(1-layer)+.11*Math.cos(lateral*3.8)+.045*grain+.08*t;
  const k=(y*w+x)*4;data[k]=130*pigment;data[k+1]=166*pigment;data[k+2]=145*pigment;
  data[k+3]=Math.round(255*T.MathUtils.clamp(dist*75,0,1));
 }
 const tex=new T.DataTexture(data,w,h);tex.name='foliage:ridge-cedar';tex.colorSpace=T.SRGBColorSpace;
 tex.minFilter=T.LinearMipmapLinearFilter;tex.magFilter=T.LinearFilter;tex.generateMipmaps=true;tex.needsUpdate=true;b.textures.add(tex);
 const g=b.own(new T.PlaneGeometry(1,1,2,2));g.translate(0,.5,0);
 const m=b.mat('foliage:ridge-cedar','#ffffff',{map:tex,alphaTest:.38,roughness:.98,side:T.DoubleSide});
 m.userData.botanicalKind='spray';
 const mesh=new T.InstancedMesh(g,m,trees.length*3),o=new T.Object3D(),color=new T.Color();
 trees.forEach(({x,z,base,h,haze},i)=>{
  color.setRGB(.69+.15*haze,.83+.12*haze,.85+.15*haze);
  for(let face=0;face<3;face++){
   o.position.set(x,base+h*.16,z);o.rotation.y=i*2.39996+face*Math.PI/3;
   o.scale.set(h*.43,h*.86,1);o.updateMatrix();mesh.setMatrixAt(i*3+face,o.matrix);mesh.setColorAt(i*3+face,color);
  }
 });
 mesh.name='sakura-stream:mountain-cedars';mesh.castShadow=false;mesh.receiveShadow=true;mesh.computeBoundingSphere();b.root.add(mesh);b.instances.push(mesh);
}
