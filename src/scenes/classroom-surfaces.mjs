import {
  BoxGeometry, BufferGeometry, CanvasTexture, DataTexture, Float32BufferAttribute,
  LinearFilter, LinearMipmapLinearFilter, Matrix4, MeshStandardMaterial, SRGBColorSpace,
} from 'three';

function texture(data, width, height, name, color = false) {
  const map = new DataTexture(data, width, height);
  map.name = name;
  if (color) map.colorSpace = SRGBColorSpace;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

// Sliced beech veneer. Consecutive earlywood/latewood bands turn around
// the heart of the cut, with finer longitudinal pores in the satin finish.
export function deskVeneer(seed, base) {
  const width = 384, height = 256;
  const color = new Uint8Array(width * height * 4);
  const surface = new Uint8Array(width * height * 4);
  let state = seed * 827;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const fiber = state / 4294967296;
      const warp = .029 * Math.sin(u * 5 + seed) + .009 * Math.sin(u * 17 + v * 4);
      const ring = Math.hypot((u - .37 - .2 * Math.sin(seed)) * .38, v + .17 + warp);
      const growth = .5 + .5 * Math.cos(68 * ring + .8 * Math.sin(21 * ring + seed));
      const latewood = Math.pow(growth, 6);
      const pore = Math.pow(.5 + .5 * Math.sin(v * 409 + warp * 170 + 2 * Math.sin(u * 5 + v * 18)), 8);
      const tone = 2 * Math.sin(ring * 12) - 12 * latewood - 4 * pore + 2.2 * (fiber - .5);
      const i = (y * width + x) * 4;
      color[i] = base[0] - 9 + tone;
      color[i + 1] = base[1] - 13 + tone * .94;
      color[i + 2] = base[2] - 14 + tone * .72;
      color[i + 3] = 255;
      surface[i] = surface[i + 1] = surface[i + 2] = 174 + latewood * 39 + pore * 21;
      surface[i + 3] = 255;
    }
  }
  const map = texture(color, width, height, 'classroom-desk-wood-' + seed, true);
  map.userData.roughness = texture(surface, width, height, 'classroom-veneer-pores-' + seed);
  return map;
}

export function finishClassroomMaterials(m) {
  function finish(material, roughness, metalness, envMapIntensity) {
    Object.assign(material, {roughness, metalness, envMapIntensity});
    material.userData.surfaceFinish = {roughness, metalness, envMapIntensity};
  }
  for (const wood of [m.woodA, m.woodB, m.woodC, m.teacherWood, m.readingWood, m.shelfWood]) {
    wood.roughnessMap = wood.map.userData.roughness;
    finish(wood, .58, 0, .7);
  }
  finish(m.woodEdge, .79, 0, .5);
  finish(m.glass, .075, 0, 1.25);
  finish(m.doorGlass, .54, 0, .55);
  finish(m.windowMetal, .32, .86, 1.1);
  finish(m.windowMetalDark, .46, .76, .9);
  finish(m.curtainRail, .28, .94, 1.15);
  finish(m.deskMetal, .52, 0, .7); // powder coated, including the tube bends
  finish(m.ceramic, .22, 0, 1.15);
  finish(m.ceramicRim, .16, 0, 1.2);
  finish(m.tea, .075, 0, 1.2);
  m.ceramic.color.set('#b9caca');
  m.ceramicRim.color.set('#6b989b');
  m.tea.color.set('#56311e');
  addTeaWindowReflection(m.tea);
  m.glass.opacity = .095;
  finish(m.bookPage, .96, 0, .32);
  finish(m.bookCover, .81, 0, .4);
  const leaves = new Uint8Array(4 * 96);
  for (let row = 0; row < 96; row++) {
    const shade = row % 11 < 2 ? 211 : row % 5 === 0 ? 231 : 251;
    leaves.set([shade, shade, shade - 3, 255], row * 4);
  }
  m.bookPage.map = texture(leaves, 1, 96, 'classroom-trimmed-pages', true);
}

// The global sky probe cannot contain the nearby sashes. Project the mirror
// ray onto the actual west window, so the highlight slips off the tea when
// the camera moves out of alignment. The room's live lighting drives its tint.
function addTeaWindowReflection(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vTeaWorld;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>', '#include <worldpos_vertex>\n vTeaWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = 'varying vec3 vTeaWorld;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 eye = normalize(cameraPosition-vTeaWorld);
      vec3 reflected = reflect(-eye,vec3(0.,1.,0.));
      if (reflected.x < -.02) {
        vec3 hit = vTeaWorld + reflected * ((-5.05-vTeaWorld.x)/reflected.x);
        float opening = smoothstep(.965,1.0,hit.y)*(1.-smoothstep(2.65,2.69,hit.y))*(1.-smoothstep(3.98,4.02,abs(hit.z)));
        opening *= smoothstep(.018,.044,abs(hit.y-2.13))*smoothstep(.006,.026,abs(hit.y-1.545));
        opening *= smoothstep(.012,.038,abs(mod(hit.z+.67,1.34)-.67));
        float fresnel = .0204+.9796*pow(1.-clamp(eye.y,0.,1.),5.);
        vec3 daylight = reflectedLight.indirectDiffuse/max(diffuseColor.rgb,vec3(.008));
        outgoingLight += opening*fresnel*vec3(.69,.88,1.0)*daylight*2.8;
      }
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'classroom-tea-window';
}

// The illustration and short Japanese passage belong to this notebook.
function printedSpread() {
  const canvas = globalThis.document?.createElement?.('canvas');
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || typeof ctx.fillText !== 'function') return null;
  canvas.width = 768; canvas.height = 480;
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, 768, 480);
  const serif = '"Yu Mincho", "Noto Serif CJK JP", serif';
  ctx.fillStyle = '#40464a';
  ctx.textAlign = 'center';
  const column = (str, x, y, spacing) => {
    Array.from(str).forEach((ch, i) => ctx.fillText(ch, x, y + i * spacing));
  };
  ctx.font = '28px ' + serif;
  column('窓辺の記録', 684, 76, 33);
  ctx.font = '16px ' + serif;
  const lines = ['午後の鐘が鳴る。','風はカーテンの裾をほどき、','木の机に落ちた光が揺れた。','窓ぎわに置いたお茶には、','空の青が少し映っている。'];
  lines.forEach((line, i) => column(line, 602 - 36 * i, 76, 21));
  ctx.strokeStyle = '#5d7376'; ctx.lineWidth = 2;
  ctx.strokeRect(92, 104, 201, 154);
  for (const x of [97, 190, 195, 288]) {
    ctx.beginPath();ctx.moveTo(x, 106);ctx.lineTo(x, 254);ctx.stroke();
  }
  for (const y of [155, 159, 243]) {
    ctx.beginPath();ctx.moveTo(95, y);ctx.lineTo(290, y);ctx.stroke();
  }
  ctx.fillStyle = '#566366';ctx.font = '15px ' + serif;
  ctx.fillText('教室の西窓', 192, 292);
  ctx.font = '13px ' + serif;
  ctx.fillText('24', 75, 444);ctx.fillText('25', 691, 444);
  const gutter = ctx.createLinearGradient?.(351, 0, 416, 0);
  if (gutter) {
    gutter.addColorStop(0, 'rgba(85,64,40,0)');gutter.addColorStop(.5, 'rgba(85,64,40,.22)');gutter.addColorStop(1, 'rgba(85,64,40,0)');
    ctx.fillStyle = gutter;ctx.fillRect(351, 0, 65, 480);
  }
  const map = new CanvasTexture(canvas);map.name = 'classroom-reading-spread';map.colorSpace = SRGBColorSpace;map.anisotropy = 4;
  return map;
}

export function addReadingBook(batch, materials, transform) {
  const mat = new MeshStandardMaterial({name:'classroom:printed-paper',color:'#faf9f5',map:printedSpread(),roughness:.96});
  mat.userData.surfaceFinish = {roughness:.96, metalness:0, envMapIntensity:.32};
  const positions = [], uvs = [], indices = [];
  const half = .145, depth = .239, segments = 20;
  for (let i = 0; i <= segments; i++) {
    const x = i / segments * 2 - 1, distance = Math.abs(x);
    const y = .011 + .018 * Math.sin(Math.PI * Math.pow(distance, .68)) + .003 * distance;
    for (const side of [-1, 1]) {
      positions.push(x * half, y + .0015 * side * x, side * depth / 2);
      uvs.push(i / segments, (1 - side) / 2);
    }
    if (i < segments) {const k = i * 2;indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);}
  }
  const spread = new BufferGeometry();spread.setAttribute('position',new Float32BufferAttribute(positions,3));spread.setAttribute('uv',new Float32BufferAttribute(uvs,2));spread.setIndex(indices);spread.computeVertexNormals();
  batch.add('book-pages', spread, mat, transform, {cast:true,receive:true});
  // Bound page blocks taper into the binding beneath the lifted top leaves.
  const edges=[], edgeUvs=[], triangles=[];
  for(const side of [0,1]){
    for(let i=0;i<=segments;i++){
      const source=(i*2+side)*3, x=positions[source], y=positions[source+1], z=positions[source+2];
      const k=edges.length/3;
      edges.push(x,.005,z,x,y,z);edgeUvs.push(i/segments,0,i/segments,1);
      if(i<segments){if(side)triangles.push(k,k+2,k+1,k+1,k+2,k+3);else triangles.push(k,k+1,k+2,k+1,k+3,k+2);}
    }
  }
  for(const i of [0,segments]){
    const p=i*6, k=edges.length/3, x=positions[p];
    edges.push(x,.005,-depth/2,x,positions[p+1],-depth/2,x,.005,depth/2,x,positions[p+4],depth/2);
    edgeUvs.push(0,0,0,1,1,0,1,1);
    if(i)triangles.push(k,k+1,k+2,k+1,k+3,k+2);else triangles.push(k,k+2,k+1,k+1,k+2,k+3);
  }
  const block=new BufferGeometry();block.setAttribute('position',new Float32BufferAttribute(edges,3));block.setAttribute('uv',new Float32BufferAttribute(edgeUvs,2));block.setIndex(triangles);block.computeVertexNormals();
  batch.add('book-page-edge',block,materials.bookPage,transform,{cast:false});
  const box = new BoxGeometry(half*2+.009,.005,depth+.008);
  batch.add('book-cover',box,materials.bookCover,transform.clone().multiply(new Matrix4().makeTranslation(0,.003,0)));
  spread.dispose(); block.dispose(); box.dispose();
}
