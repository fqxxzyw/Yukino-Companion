import * as T from 'three';

// Old timber boards inside the bookshop, painted trims and clear storefront
// glazing retain their identity when the host converts the authored toon mats.
export function finishBookshop(m, textures) {
  const finishes = [
    [m.wood,'wood:bookseller-oiled-timber',.54,0,.7],
    [m.woodDark,'wood:bookseller-stained-joinery',.66,0,.55],
    [m.woodTrim,'wood:bookseller-window-trim',.49,0,.65],
    [m.interiorFloor,'wood:bookseller-floorboards',.63,0,.6],
    [m.glass,'glass:bookseller-display-window',.078,0,1.15],
    [m.glassDark,'glass:bookseller-door',.145,0,.8],
    [m.aluminium,'metal:bookseller-aluminium',.34,.85,.8],
    [m.paper,'paper:bookseller-page',.95,0,.25],
    [m.fabric,'interior:bookseller-tablecloth',.98,0,.2],
  ];
  for (const [material,name,roughness,metalness,envMapIntensity] of finishes) {
    material.name=name;
    material.userData.surfaceFinish={roughness,metalness,envMapIntensity};
    if(material.isMeshStandardMaterial)Object.assign(material,{roughness,metalness,envMapIntensity});
  }
  const boards=textures.wood.clone();
  boards.name='bookseller-worn-oak';boards.repeat.set(1.75,9);boards.needsUpdate=true;
  m.interiorFloor.map=boards;m.interiorFloor.color.set('#e3c6a3');
  m.glass.opacity=.085;m.glass.clearcoat=.15;m.glass.clearcoatRoughness=.1;
}

// Eight original dust jackets share one texture and one material. The
// different cover proportions and standing angles still come from the shelf.
export function bookJackets() {
  const titles=['川沿いの季節','町の鳥','花の余白','雨音集','灯りの地図','路地を歩く','硝子と風','暦の森'];
  const colors=['#537873','#bc8862','#916375','#557283','#9c7054','#728064','#a69c81','#535b64'];
  const cellW=192,cellH=256, canvas=document.createElement('canvas');
  canvas.width=4*cellW;canvas.height=2*cellH;
  const ctx=canvas.getContext('2d');
  const planes=[];
  for(let i=0;i<titles.length;i++){
    const col=i%4,row=Math.floor(i/4),x=col*cellW,y=row*cellH;
    ctx.save();ctx.translate(x,y);
    ctx.fillStyle=colors[i];ctx.fillRect(0,0,cellW,cellH);
    ctx.fillStyle='rgba(43,38,39,.24)';ctx.fillRect(4,0,3,cellH);
    ctx.fillStyle='#f1e5bf';ctx.textAlign='center';ctx.font='27px "Yu Mincho",serif';
    Array.from(titles[i]).forEach((ch,j)=>ctx.fillText(ch,cellW-42,42+j*31));
    ctx.strokeStyle='#d9caa5';ctx.lineWidth=1.5;
    for(let line=0;line<4;line++){
      ctx.beginPath();
      for(let n=0;n<=32;n++){
        const t=n/32,xx=17+t*98,yy=137+line*7+Math.sin(t*5+i*.7+line*.14)*12+Math.sin(t*8+i*.4)*4;
        if(n)ctx.lineTo(xx,yy);else ctx.moveTo(xx,yy);
      }
      ctx.stroke();
    }
    ctx.fillStyle=i%2?'#c5ad87':'#d9ceac';ctx.fillRect(0,202,cellW,35);
    ctx.fillStyle='#565047';ctx.font='12px "Yu Mincho",serif';ctx.fillText('街の文庫',51,225);
    ctx.restore();
    const geo=new T.PlaneGeometry(1,1),uv=geo.attributes.uv;
    for(let j=0;j<uv.count;j++)uv.setXY(j,(col+.002+uv.getX(j)*.996)/4,(1-row+.002+uv.getY(j)*.996)/2);
    planes.push(geo);
  }
  const map=new T.CanvasTexture(canvas);map.name='bookshop:printed-jackets';map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
  const paper=new T.MeshStandardMaterial({name:'paper:bookseller-printed-jackets',map,roughness:.87});
  paper.userData.surfaceFinish={roughness:.87,metalness:0,envMapIntensity:.35};
  let count=0;
  return (parent,width,height)=>{
    const face=new T.Mesh(planes[count++%planes.length],paper);face.scale.set(width*.985,height*.99,1);face.position.z=.021;face.receiveShadow=true;parent.add(face);
  };
}

// Remove the old garden furnishings in precisely the new shop's footprint
// before any of those meshes are merged with the original street.
export function reserveRamenRoom(groups) {
  const point=new T.Vector3(), matrix=new T.Matrix4(), off=new T.Matrix4().makeScale(0,0,0);
  const inside=p=>p.x>3.48&&p.x<11&&p.z>-.85&&p.z<4.63;
  for(const group of groups){
    group.updateWorldMatrix(true,true);
    group.traverse(o=>{
      if(!o.isMesh)return;
      if(o.isInstancedMesh){
        for(let i=0;i<o.count;i++){
          o.getMatrixAt(i,matrix);
          point.setFromMatrixPosition(matrix).applyMatrix4(o.matrixWorld);
          if(inside(point))o.setMatrixAt(i,off);
        }
        o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();
      }else{
        o.geometry.computeBoundingBox();
        o.geometry.boundingBox.getCenter(point).applyMatrix4(o.matrixWorld);
        if(inside(point))o.visible=false;
      }
    });
  }
}

function tileMap(builder,name,{floor=false}={},mode='color'){
  const side=512, count=floor?4:8, cell=side/count;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=side;
  const ctx=canvas.getContext('2d');
  const rough=mode==='roughness',relief=mode==='relief';
  ctx.fillStyle=rough?'#f8f8f8':relief?'#555':'#797972';ctx.fillRect(0,0,side,side);
  const seed=73;let n=seed;
  const random=()=>((n=Math.imul(n,1664525)+1013904223>>>0)/4294967296);
  for(let row=0;row<count;row++){
    for(let col=0;col<count;col++){
      const tone=(random()-.5)*(floor?17:11);
      const x=col*cell+1.6,y=row*cell+1.6,size=cell-3.2;
      if(rough){const v=Math.round((floor?172:105)+tone);ctx.fillStyle=`rgb(${v},${v},${v})`;}
      else if(relief)ctx.fillStyle='#a7a7a7';
      else{
        const base=floor?[180,161,138]:[213,213,196];
        ctx.fillStyle=`rgb(${base[0]+tone},${base[1]+tone},${base[2]+tone})`;
      }
      ctx.fillRect(x,y,size,size);
      if(!rough&&!relief){
        ctx.fillStyle='rgba(255,250,230,.17)';ctx.fillRect(x,y,size,1.1);ctx.fillRect(x,y,1.1,size);
        ctx.fillStyle='rgba(83,77,67,.14)';ctx.fillRect(x,y+size-1,size,1);ctx.fillRect(x+size-1,y,1,size);
      }
    }
  }
  const map=new T.CanvasTexture(canvas);
  map.name=name;map.colorSpace=mode==='color'?T.SRGBColorSpace:T.NoColorSpace;
  map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=4;builder.textures.add(map);return map;
}

export function ceramicFinish(builder,material,floor=false){
  const id=floor?'ramen:quarry-floor':'ramen:glazed-wall';
  material.map=tileMap(builder,id,{floor});
  material.roughnessMap=tileMap(builder,id+'-roughness',{floor},'roughness');
  material.bumpMap=tileMap(builder,id+'-relief',{floor},'relief');
  material.bumpScale=floor?.002:.0015;
}

// Single four-panel dyed cotton noren atlas. The slits, slack bottom hem
// and crease normals belong to the mesh and shade with the street light.
export function ramenNoren(b,x,y,z,rod){
  const width=1.55,height=.77;
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=384;
  const c=canvas.getContext('2d');c.fillStyle='#31545c';c.fillRect(0,0,768,384);
  for(let row=0;row<384;row+=3){c.fillStyle=row%9?'rgba(238,224,188,.06)':'rgba(18,46,49,.12)';c.fillRect(0,row,768,1);}
  for(let col=0;col<768;col+=4){c.fillStyle='rgba(230,227,201,.045)';c.fillRect(col,0,1,384);}
  c.fillStyle='#eee2bd';c.font='bold 135px "Yu Mincho",serif';c.textAlign='center';c.textBaseline='middle';
  Array.from('中華そば').forEach((ch,i)=>c.fillText(ch,(i+.5)*192,188,151));
  c.strokeStyle='#9ca99e';c.lineWidth=2;c.setLineDash?.([3,3]);
  for(const seam of [26,367]){c.beginPath();c.moveTo(0,seam);c.lineTo(768,seam);c.stroke();}
  const atlas=new T.CanvasTexture(canvas);atlas.name='ramen:cotton-screenprint';atlas.colorSpace=T.SRGBColorSpace;atlas.anisotropy=4;b.textures.add(atlas);
  const fabric=b.mat('interior:cotton-noren','#ffffff',{map:atlas,side:T.DoubleSide,roughness:.98});
  fabric.userData.surfaceFinish={roughness:.98,metalness:0,envMapIntensity:.18};
  const positions=[],uv=[],indices=[];
  const cols=9,rows=4;
  for(let panel=0;panel<4;panel++){
    const first=positions.length/3;
    for(let j=0;j<=rows;j++){
      const v=j/rows;
      for(let i=0;i<=cols;i++){
        const u=i/cols, s=(panel+u)/4;
        const pleat=Math.sin(u*Math.PI*3.5+panel*.85);
        positions.push((s-.5)*width+(u-.5)*(-.013)+v*v*.008*Math.sin(panel),-height*v+v*v*(.013*pleat+.014*panel/4),.018*pleat+.034*v*Math.sin(u*4+panel*.7));
        uv.push(s,1-v);
        if(i<cols&&j<rows){const k=first+j*(cols+1)+i;indices.push(k,k+cols+1,k+1,k+1,k+cols+1,k+cols+2);}
      }
    }
  }
  const geo=b.own(new T.BufferGeometry());geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
  b.mesh(geo,fabric,[x,y,z]);b.tube([x-width*.57,y+.01,z],[x+width*.57,y+.01,z],.018,rod);
}

export function entranceLanterns(b,x,front,cap) {
  const chars=Array.from('中華そば天下一品'),cell=192,h=240;
  const canvas=document.createElement('canvas');canvas.width=chars.length*cell;canvas.height=h;
  const c=canvas.getContext('2d');
  c.fillStyle='#f8e1b2';c.fillRect(0,0,canvas.width,h);
  for(let i=0;i<19;i++){
    const y=8+i*12.4;
    c.fillStyle='rgba(123,81,47,.18)';c.fillRect(0,y,canvas.width,1.4);
    c.fillStyle='rgba(255,248,218,.45)';c.fillRect(0,y+1.4,canvas.width,1);
  }
  c.fillStyle='#493734';c.textAlign='center';c.textBaseline='middle';c.font='bold 96px "Yu Mincho",serif';
  for(const [i,ch]of chars.entries())c.fillText(ch,(i+.5)*cell,h*.51,50);
  const atlas=new T.CanvasTexture(canvas);atlas.name='ramen:ink-on-lantern-paper';atlas.colorSpace=T.SRGBColorSpace;atlas.anisotropy=4;b.textures.add(atlas);
  const paper=b.mat('paper:inked-lantern','#fff6e5',{map:atlas,emissive:'#e9c992',emissiveMap:atlas,emissiveIntensity:.1});
  b.lamps.push({material:paper,day:.08,night:.56});
  const profile=[];
  for(let j=0;j<=40;j++){const t=j/40;profile.push(new T.Vector2(.086+.12*Math.pow(Math.sin(t*Math.PI),.7)+.0018*Math.cos(Math.PI*j),.55*t-.275));}
  const yy=2.57,zz=front+.82;
  for(let i=0;i<chars.length;i++){
    const xx=x-3.12+i*.87,geo=b.own(new T.LatheGeometry(profile,28,Math.PI,Math.PI*2)),uv=geo.attributes.uv;
    for(let k=0;k<uv.count;k++)uv.setX(k,(i+uv.getX(k))/chars.length);
    b.mesh(geo,paper,[xx,yy,zz]);b.cylinderAt([xx,yy+.283,zz],.087,.034,cap);b.cylinderAt([xx,yy-.282,zz],.087,.032,cap);
    b.tube([xx,yy+.30,zz],[xx,2.92,zz],.009,cap);
  }
}
