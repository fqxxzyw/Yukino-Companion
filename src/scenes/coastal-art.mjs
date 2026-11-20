import * as T from 'three';

// These additions live in world coordinates in the original two coastal factories.
// Repeated flowers, stone insets and deck fittings share geometry and draw calls.
function coastalDetails(root, name) {
  const group = new T.Group();
  group.name = name;
  root.add(group);
  const resources = new Set(), batches = new Map();
  const transform = new T.Object3D(), up = new T.Vector3(0, 1, 0);
  function own(resource) { resources.add(resource); return resource; }
  const box = own(new T.BoxGeometry(1, 1, 1));
  const cylinder = own(new T.CylinderGeometry(1, 1, 1, 32));
  function material(name, color, options = {}) {
    const mat = own(new T.MeshStandardMaterial({color, roughness: .78, ...options}));
    mat.name = name;
    return mat;
  }
  function stamp(geometry, mat, position, scale, rotation = [0, 0, 0], tint) {
    const key = geometry.uuid + mat.uuid;
    if (!batches.has(key)) batches.set(key, {geometry, mat, entries: []});
    transform.position.set(...position);
    transform.scale.set(...scale);
    if (rotation.isQuaternion) transform.quaternion.copy(rotation);
    else transform.rotation.set(...rotation);
    transform.updateMatrix();
    batches.get(key).entries.push({matrix: transform.matrix.clone(), tint});
  }
  function rod(start, end, radius, mat) {
    const a = new T.Vector3(...start), b = new T.Vector3(...end), axis = b.clone().sub(a);
    const rotation = new T.Quaternion().setFromUnitVectors(up, axis.clone().normalize());
    stamp(cylinder, mat, a.add(b).multiplyScalar(.5).toArray(), [radius, axis.length(), radius], rotation);
  }
  function mesh(geometry, mat) {
    const item = new T.Mesh(geometry, mat);
    item.name = mat.name;
    item.receiveShadow = true;
    group.add(item);
    return item;
  }
  function finish() {
    for (const {geometry, mat, entries} of batches.values()) {
      const item = new T.InstancedMesh(geometry, mat, entries.length);
      item.name = mat.name;
      item.castShadow = item.receiveShadow = true;
      entries.forEach(({matrix, tint}, i) => {
        item.setMatrixAt(i, matrix);
        if (tint) item.setColorAt(i, new T.Color(tint));
      });
      item.computeBoundingSphere();
      group.add(item);
      own(item);
    }
    return () => {
      group.removeFromParent();
      for (const resource of resources) resource.dispose();
    };
  }
  return {own, box, cylinder, stamp, rod, material, mesh, finish};
}

function flatPolygons(art, mat, triangles, y) {
  const geometry = art.own(new T.BufferGeometry());
  const positions = [], colors = [];
  for (const [points, color] of triangles) {
    const tint = new T.Color(color);
    for (const [x,z] of points) {
      positions.push(x,y,z);
      colors.push(tint.r,tint.g,tint.b);
    }
  }
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  return art.mesh(geometry, mat);
}

function plantShorePines(art) {
  // A shore pine grows outwards in tiers. Each bough carries a flattened
  // irregular spray with a dark underside, rather than a spherical crown.
  const positions=[], colors=[], indices=[], segments=29;
  const profile=[[.04,-.30,'#355b54'],[.77,-.20,'#497265'],[1,.05,'#648675'],[.72,.38,'#7e9a7e'],[.04,.48,'#90a180']];
  for (const [radius,y,color] of profile) {
    const tint=new T.Color(color);
    for(let j=0;j<segments;j++) {
      const a=j/segments*Math.PI*2;
      const edge=radius*(1+.09*Math.sin(5*a)+.07*Math.cos(9*a)+.035*Math.sin(13*a));
      positions.push(Math.cos(a)*edge,y+.034*Math.sin(5*a)*radius,Math.sin(a)*edge);
      colors.push(tint.r,tint.g,tint.b);
    }
  }
  for(let level=0;level<profile.length-1;level++)for(let i=0;i<segments;i++){
    const a=level*segments+i,b=level*segments+(i+1)%segments;
    indices.push(a,a+segments,b,b,a+segments,b+segments);
  }
  const cushion=art.own(new T.BufferGeometry());
  cushion.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  cushion.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  cushion.setIndex(indices);
  cushion.computeVertexNormals();
  const needles=art.material('foliage:shore-pine-needles','#ffffff',{vertexColors:true,roughness:.95,side:T.DoubleSide});
  const needleSprig=art.own(new T.BufferGeometry()),blades=[];
  for(let i=0;i<7;i++){
    const a=i*2.39996, y=.12+(i%3)*.055,r=.12+(i%4)*.053;
    const x=Math.cos(a)*r,z=Math.sin(a)*r;
    blades.push(-z*.12,0,x*.12,z*.12,0,-x*.12,x,y,z);
  }
  needleSprig.setAttribute('position',new T.Float32BufferAttribute(blades,3));needleSprig.computeVertexNormals();
  const newGrowth=art.material('foliage:pine-shoots','#ffffff',{side:T.DoubleSide});
  const bark=art.material('bark:shore-pine','#605b4f');
  const stone=art.material('paving:tree-seat-stone','#b6b5a5');
  const mulch=art.material('soil:pine-needle-bed','#706c55');
  for (const [x,z,h,phase,lean] of [[-26.9,9.8,6.7,.34,1.4],[27.2,6.5,7.5,2.8,-1.7]]) {
    art.stamp(art.cylinder,stone,[x,.32,z],[2.23,.24,2.23]);
    art.stamp(art.cylinder,mulch,[x,.446,z],[1.88,.025,1.88]);
    const trunk=[[x,.43,z],[x+lean*.26,h*.29,z+.18],[x+lean,h*.51,z-.09],[x+lean*.8,h*.76,z+.20],[x+lean*1.14,h*.96,z+.08]];
    for(let i=1;i<trunk.length;i++)art.rod(trunk[i-1],trunk[i],.24-i*.038,bark);
    for(let j=0;j<11;j++){
      const a=phase+j*2.39996,c=Math.cos(a),s=Math.sin(a),t=j/11,spread=3.2-1.65*t;
      const y=h*(.29+.62*t),sx=x+lean*(.42+.56*t);
      const elbow=[sx+c*spread*.57,y+.11,z+s*spread*.53];
      const end=[sx+c*spread,y+.45+.32*Math.sin(j*5),z+s*spread];
      art.rod([sx,y,z],elbow,.099-.046*t,bark);
      art.rod(elbow,end,.06-.02*t,bark);
      const radius=1.28-.41*t;
      for(let k=0;k<3;k++){
        const twig=a+(k-1)*1.04;
        const tip=[end[0]+Math.cos(twig)*radius*.64,end[1]+.48+(k===1?.17:0),end[2]+Math.sin(twig)*radius*.64];
        art.rod(end,tip,.032,bark);
        art.stamp(cushion,needles,tip,[radius,.99-t*.3,radius*.79],[.10*Math.sin(j),-twig,.12*Math.cos(j+k)]);
        for(let n=0;n<17;n++){
          const angle=n*2.39996, radial=Math.sqrt((n+.4)/17), dx=Math.cos(angle)*radius*radial, dz=Math.sin(angle)*radius*.79*radial;
          const shoot=[tip[0]+dx*Math.cos(twig)-dz*Math.sin(twig),tip[1]+(.43-.39*radial**2)*(.99-t*.3),tip[2]+dx*Math.sin(twig)+dz*Math.cos(twig)];
          art.stamp(needleSprig,newGrowth,shoot,[.75,.75,.75],[.20,angle,.18],n%3?'#699078':'#879f78');
        }
      }
    }
    art.stamp(cushion,needles,trunk.at(-1),[1.3,1.05,1.1],[0,phase,.11]);
  }
}

function addTidalFlats(art) {
  const sea=art.material('water:open-bay','#ffffff',{roughness:.46,metalness:.04,vertexColors:true,side:T.DoubleSide});
  const waterRows=[[36,175,-.72,'#638c91'],[-42.55,175,-.16,'#57979b'],[-46,178,.12,'#619da0'],[-78,240,.05,'#77a8aa'],[-202,320,0,'#8db1b4'],[-730,650,0,'#a5c0c3']];
  const positions=[],colors=[],indices=[];
  for (const [z,width,y,tone] of waterRows) {
    const color=new T.Color(tone);
    for(const x of [-width,width]){
      positions.push(x,y,z);
      colors.push(color.r,color.g,color.b);
    }
  }
  for(let i=0;i<waterRows.length-1;i++){const j=i*2;indices.push(j,j+1,j+2,j+2,j+1,j+3);}
  function surface(m,vertices,pigments,faces){
    const g=art.own(new T.BufferGeometry());
    g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
    g.setAttribute('color',new T.Float32BufferAttribute(pigments,3));
    g.setIndex(faces);g.computeVertexNormals();return art.mesh(g,m);
  }
  surface(sea,positions,colors,indices);
  const wavelets=[];
  for(let i=0;i<230;i++){
    const x=-149+(i*61.781)%298,z=-50-(i*37.173)%285,span=1.7+(i*2.17)%5.3;
    wavelets.push([[[x,z],[x+span,z+.03],[x+span*.27,z+.24]],i%5?'#9cbdbb':'#c0d1c9']);
  }
  flatPolygons(art,art.material('water:bay-wavelets','#ffffff',{vertexColors:true,side:T.DoubleSide}),wavelets,.142);
  // The east and west artificial beaches are low sand bars in Tokyo Bay.
  // Model their intertidal slopes behind the building so parallax, weather
  // and the view through an open bay all agree with the glazed openings.
  const tidal=art.material('soil:tidal-flats','#ffffff',{roughness:1,vertexColors:true,side:T.DoubleSide});
  const reed=art.material('foliage:distant-reeds','#ffffff',{roughness:1,side:T.DoubleSide});
  const reedGeometry=art.own(new T.BufferGeometry()),blades=[];
  for(let i=0;i<9;i++){
    const a=i*2.4,r=Math.sqrt(i/9),x=Math.cos(a)*r,z=Math.sin(a)*r;
    const width=.17+.08*Math.cos(i),h=.63+.35*Math.sin(i*3.7);
    blades.push(x-width,0,z,x+width,0,z,x+.17,h,z+.12);
  }
  reedGeometry.setAttribute('position',new T.Float32BufferAttribute(blades,3));reedGeometry.computeVertexNormals();
  for(const [cx,cz,rx,rz,rise,phase] of [[-77,-116,72,13,1.32,.7],[80,-135,73,17,1.86,2.1]]){
    const vertices=[],pigments=[],faces=[],segments=52;
    const rings=[[1,-.07,'#899e94'],[.91,.22,'#c5ba95'],[.69,.52,'#c3b485'],[.52,.77,'#8a9c78'],[.05,1,'#74947a']];
    for(const [r,y,tone] of rings){
      const tint=new T.Color(tone);
      for(let j=0;j<segments;j++){
        const a=j/segments*Math.PI*2,w=1+.055*Math.cos(3*a+phase)+.035*Math.sin(5*a);
        const x=cx+rx*r*Math.cos(a)*w,z=cz+rz*r*Math.sin(a)*w+Math.cos(a)*3.6;
        const k=.97+.04*Math.sin(3*a+phase);
        vertices.push(x,y*rise*k,z);pigments.push(tint.r*k,tint.g*k,tint.b*k);
      }
    }
    for(let band=0;band<rings.length-1;band++)for(let i=0;i<segments;i++){
      const a=band*segments+i,b=band*segments+(i+1)%segments;
      faces.push(a,a+segments,b,b,a+segments,b+segments);
    }
    const center=vertices.length/3, top=new T.Color('#74947a');
    vertices.push(cx,rise,cz);pigments.push(top.r,top.g,top.b);
    for(let i=0;i<segments;i++)faces.push(center,center-segments+(i+1)%segments,center-segments+i);
    surface(tidal,vertices,pigments,faces);
    for(let i=0;i<52;i++){
      const a=i*2.39996,r=.51*Math.sqrt((i+.5)/52),x=cx+rx*r*Math.cos(a),z=cz+rz*r*Math.sin(a)+Math.cos(a)*2;
      const height=1.05+.68*Math.sin(i*2.8)**2;
      art.stamp(reedGeometry,reed,[x,rise*(.86-.20*r),z],[1.7,height,1.38],[0,a,0],i%3?'#849980':'#96a181');
    }
  }
}

export function addKasaiWaterfront(root) {
  const art = coastalDetails(root, 'kasai:waterfront');
  plantShorePines(art);
  addTidalFlats(art);

  // Survey-style compass in laid stone along the promenade's central axis.
  const disk = art.material('paving:compass-basalt', '#5d777a');
  const bronze = art.material('metal:inlaid-bronze', '#bcaa77', {roughness:.55,metalness:.24});
  const radius = 3.5, cz = 26;
  art.stamp(art.cylinder, bronze, [0,.223,cz], [radius,.025,radius]);
  art.stamp(art.cylinder, disk, [0,.239,cz], [radius-.085,.012,radius-.085]);
  const rose = [];
  for (let i=0;i<8;i++) {
    const a = i*Math.PI/4, length = i%2 ? 1.65 : 2.83;
    const tip = [Math.sin(a)*length,cz-Math.cos(a)*length];
    const left = [Math.sin(a-.38)*.76,cz-Math.cos(a-.38)*.76];
    const right = [Math.sin(a+.38)*.76,cz-Math.cos(a+.38)*.76];
    rose.push([[[0,cz],left,tip],'#e1cca0'], [[[0,cz],tip,right],'#9ba99f']);
  }
  flatPolygons(art,art.material('paving:compass-stone','#ffffff',{vertexColors:true,side:T.DoubleSide}),rose,.247);
  for(let i=0;i<32;i++) {
    const a = i*Math.PI/16, r = radius-.33;
    art.stamp(art.box,bronze,[r*Math.sin(a),.251,cz-r*Math.cos(a)],[i%4?.038:.075,.008,i%4?.15:.31],[0,-a,0]);
  }

  // The narrow bay behind the terrace stays within the cut edge of the diorama.
  const water = art.material('water:tidal-bay','#4c9b9d',{roughness:.36,metalness:.16});
  const coping = art.material('stone:waterfront-coping','#a9b5ab');
  art.stamp(art.box, water, [0,.15,-39.9], [68,.055,5.9]);
  art.stamp(art.box, coping, [0,.24,-36.91], [68,.28,.33]);
  const ripples = [];
  for (let i=0;i<83;i++) {
    const x = -33.8 + ((i*19.977)%67), z = -37.25 - ((i*1.413)%5.15);
    const length=.32+(1+Math.sin(i*13))*.78;
    ripples.push([[[x,z],[x+length,z-.05],[x+length*.36,z+.075]], i%4 ? '#80b6b2':'#b8d6c9']);
  }
  flatPolygons(art,art.material('water:bay-ripples','#ffffff',{vertexColors:true,side:T.DoubleSide}),ripples,.181);
  return art.finish();
}

export function addSurfHallGarden(root) {
  const art = coastalDetails(root, 'wedding:ceremony-garden');
  root.traverse(node => {
    const mat = node.material;
    if (mat?.name !== 'wing:glass' && mat?.name !== 'porch:glass') return;
    mat.color.set('#f6faf9');
    mat.transparent=true;
    mat.opacity=.055;
    mat.metalness=0;
    mat.roughness=.06;
    mat.depthWrite=false;
    mat.userData.weatherExposure=false;
    mat.userData.surfaceFinish={roughness:.06,metalness:0,envMapIntensity:.32};
  });
  // The original wing used an opaque pane 4 cm in front of a solid wall.
  // Recess the solid core, preserving its rear edge, so the clear panes look
  // into a shallow lined reveal. The folds and their shadows change with view.
  const wing=root.getObjectByName('wing:body');
  if(wing){
    const inset=.96, originalDepth=6.78;
    wing.position.z-=inset/2;
    wing.scale.z*=1-inset/originalDepth;
    const lining=art.material('plaster:window-reveal','#76817d');
    const curtain=art.material('fabric:window-linen','#d6c9b2');
    const recess=art.material('wood:window-interior','#655b50');
    for(const x of [6.99,16.51])art.stamp(art.box,wing.material,[x,1.925,-3.10],[.18,3.85,.96]);
    for(const [i,x] of [8.4,10.2,12,13.8,15.6].entries()){
      art.stamp(art.box,lining,[x,2.35,-3.526],[1.38,3.0,.06]);
      art.stamp(art.box,recess,[x,1.45,-3.36],[1.3,.064,.18]);
      const side=i%2?-1:1;
      for(let j=0;j<5;j++){
        const z=-3.15+(j%2)*.043;
        art.stamp(art.box,curtain,[x+side*(.35-j*.055),2.37,z],[.067,2.83,.052],[0,side*(j%2?.22:-.22),0]);
      }
    }
  }
  const limestone = art.material('stone:carved-ceremony-vase','#d5cbb4');
  const leaves = art.material('plant:eucalyptus-leaf','#ffffff',{roughness:.91,side:T.DoubleSide});
  const flowers = art.material('flower:ceremony-stock','#ffffff',{roughness:.87});
  const stem = art.material('plant:ceremony-stems','#59775b');
  const pot = art.own(new T.LatheGeometry([[.32,0],[.34,.065],[.27,.105],[.20,.16],[.25,.36],[.40,.61],[.43,.68],[.43,.74],[.38,.74],[.37,.69]].map(([x,y])=>new T.Vector2(x,y)),24));
  const leaf = art.own(new T.SphereGeometry(1,7,4));
  const petal = art.own(new T.IcosahedronGeometry(1,0));
  // A wire-trained climbing rose breaks the long return wall beside the steps.
  // The timber fans stand proud of the masonry and pick up its cast shadows.
  const wire = art.material('metal:espalier-wire','#89918a',{metalness:.46,roughness:.53});
  const wood = art.material('bark:climbing-rose','#776f54');
  for(const y of [.68,1.46,2.24,3.02])art.rod([5.49,y,-6.95],[5.49,y,-2.06],.012,wire);
  for(let i=0;i<8;i++){
    const z=-4.55+(i-3.5)*.11, endZ=-6.62+i*.65, h=1.85+(1+Math.sin(i*2.3))*.53;
    const mid=[5.57,.90+(i%3)*.12,z+(endZ-z)*.42], tip=[5.60,h,endZ];
    art.rod([5.56,.13,z],mid,.024,wood);
    art.rod(mid,tip,.018,wood);
    for(let j=0;j<5;j++){
      const t=(j+1)/5, y=mid[1]+(h-mid[1])*t, startZ=mid[2]+(endZ-mid[2])*t;
      const side=(i+j)%2?1:-1;
      const end=[5.67,y+.13, startZ+side*.26];
      art.rod([5.58,y,startZ],end,.011,stem);
      for(let k=0;k<4;k++)art.stamp(leaf,leaves,[5.68,y+.06+.046*k,startZ+side*(.08+.06*k)],[.054,.089,.044],[.60*side,.25*i,side*(k%2?.78:-.48)],['#7d967b','#648676','#849d79'][j%3]);
      if((i+j)%4===0)for(let k=0;k<5;k++){
        const a=k*Math.PI*2/5;
        art.stamp(petal,flowers,[end[0]+.035,end[1]+Math.cos(a)*.053,end[2]+Math.sin(a)*.053],[.054,.062,.057],[a,0,.22],'#e8bfaf');
      }
    }
  }
  for (const [cx,cz,phase] of [[-3.88,9.1,.2],[3.88,9.1,1.3]]) {
    art.stamp(pot,limestone,[cx,.075,cz],[1,1,1]);
    for(let i=0;i<18;i++) {
      const a=phase+i*2.39996, s=Math.sin(a), c=Math.cos(a);
      const reach=.32 + ((i*7)%11)*.035, height=.53 + ((i*3)%8)*.087;
      const base=[cx+.10*c,.74,cz+.10*s], tip=[cx+reach*c,.74+height,cz+reach*s];
      art.rod(base,tip,.014,stem);
      for(let j=1;j<=4;j++) {
        const k=j/5, side=j%2 ? 1 : -1;
        art.stamp(leaf,leaves,[base[0]+(tip[0]-base[0])*k-side*s*.065, .74+height*k,base[2]+(tip[2]-base[2])*k+side*c*.065],[.069,.142,.037],[.36+c*.45,-a,side*.54],['#9aaf91','#638c78','#75977f'][i%3]);
      }
      const color=['#fff2d9','#eed2cc','#c5cddd','#e7e8d7'][i%4];
      for(let j=0;j<4;j++) {
        const y=.74+height+j*.080, size=.115-j*.014;
        for(let p=0;p<3;p++) {
          const angle=p*Math.PI*2/3+j*.55;
          art.stamp(petal,flowers,[tip[0]+Math.cos(angle)*size*.56,y,tip[2]+Math.sin(angle)*size*.56],[size,size*.67,size*.86],[0,angle,.2],color);
        }
      }
    }
  }
  // Three fan-shaped bands of pale and blue-grey stone mark the staircase arrival.
  const bands=[], mid=8.65;
  for (const [radius,width,color] of [[4.65,.15,'#838e89'],[4.97,.08,'#c1ae8a'],[5.24,.14,'#9da5a0']]) {
    for(let i=0;i<36;i++) {
      const a=(i/36-.5)*Math.PI*.93,b=((i+1)/36-.5)*Math.PI*.93;
      const p=(theta,r)=>[r*Math.sin(theta),mid+r*Math.cos(theta)];
      bands.push([[p(a,radius),p(a,radius+width),p(b,radius)],color],[[p(b,radius),p(a,radius+width),p(b,radius+width)],color]);
    }
  }
  flatPolygons(art,art.material('paving:ceremony-forecourt','#ffffff',{vertexColors:true,side:T.DoubleSide}),bands,.067);
  return art.finish();
}
