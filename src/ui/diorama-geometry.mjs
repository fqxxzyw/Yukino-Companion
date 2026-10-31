import * as THREE from 'three';

// All GPU resources are allocated inside this factory. Unit geometry is shared
// only between batches of a single miniature; there is no cross-scene cache.
export function buildDiorama(id, options, state) {
 const group = new THREE.Group();
 group.name = `environment:${id}`;
 const shadows = options.shadows === true;
 const batches = new Map();
 const geometryCache = new Map();
 const materialCache = new Map();
 const palette = {
  ink: '#343846', wood: '#9e7354', woodLight: '#d7af78', cream: '#f4e9d2',
  metal: '#586775', leaf: '#76936b', leafLight: '#a4b587', stone: '#8b9396'
 };
 function add(role, shape, color, size, position, flags = {}) {
  const {yaw = 0, pitch = 0, roll = 0, glow = 0, opacity = 1, cast = true, receive = true} = flags;
  const key = [role, shape, color, glow, opacity, cast, receive].join(':');
  if (!batches.has(key)) batches.set(key, {role, shape, color, glow, opacity, cast, receive, transforms: []});
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll));
  batches.get(key).transforms.push(new THREE.Matrix4().compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(...size)));
 }
 const box = (role, color, size, position, flags) => add(role, 'box', color, size, position, flags);
 const cylinder = (role, color, size, position, flags) => add(role, 'cylinder', color, size, position, flags);
 function beam(role, color, a, b, thickness = .05, flags) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start), length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  const euler = new THREE.Euler().setFromQuaternion(rotation);
  add(role, 'cylinder', color, [thickness, length, thickness], start.add(end).multiplyScalar(.5).toArray(), {...flags, pitch: euler.x, yaw: euler.y, roll: euler.z});
 }
 function ring(role, color, diameter, thickness, position, flags) {
  // Unit torus has outer diameter 1, tube diameter .07.
  add(role, 'ring', color, [diameter, diameter, thickness / .07], position, flags);
 }
 function rock(x, z, scale = 1, role = 'rock', color = palette.stone) {
  add(role, 'rock', color, [scale, scale * .65, scale * .8], [x, scale * .25, z], {yaw: x * .7, roll: .15});
 }
 function plant(x, y, z, scale = 1) {
  cylinder('plant-pot', '#bb856d', [.42 * scale, .42 * scale, .42 * scale], [x, y + .21 * scale, z]);
  cylinder('plant-soil', '#5a5146', [.35 * scale, .025, .35 * scale], [x, y + .43 * scale, z]);
  for (let i = 0; i < 5; i++) {
   const angle = i * Math.PI * 2 / 5;
   add('plant-leaf', 'leaf', palette.leaf, [.34 * scale, .72 * scale, .21 * scale], [x + Math.cos(angle) * .14 * scale, y + .71 * scale, z + Math.sin(angle) * .14 * scale], {yaw: -angle, roll: .35});
  }
 }
 function bench(x, z, width = 2, {baseY = 0, ...flags} = {}) {
  for (const dz of [-.2, 0, .2]) box('bench-seat', palette.woodLight, [width, .09, .16], [x, baseY + .6, z + dz], flags);
  for (const y of [.92, 1.15]) box('bench-back', palette.woodLight, [width, .17, .075], [x, baseY + y, z - .28], flags);
  for (const dx of [-width * .36, width * .36]) {
   box('bench-leg', palette.metal, [.085, .56, .5], [x + dx, baseY + .28, z], flags);
   box('bench-leg', palette.metal, [.085, .84, .075], [x + dx, baseY + .8, z - .28], flags);
  }
 }
 function railing(x1, x2, z, role = 'railing', color = palette.cream, y = .12) {
  for (let x = x1; x <= x2 + .01; x += (x2 - x1) / 5) cylinder(role, color, [.07, .95, .07], [x, y + .475, z]);
  for (const h of [.4, .92]) beam(role, color, [x1, y + h, z], [x2, y + h, z], .065);
 }
 function books(x, y, z, count, role = 'books', axis = 'x') {
  const colors = ['#a7806c', '#789b9d', '#d8bc87'];
  for (let i = 0; i < count; i++) {
   const offset = (i - (count - 1) / 2) * .15;
   box(role, colors[i % colors.length], [axis === 'x' ? .115 : .28, .38 + (i % 3) * .04, axis === 'x' ? .28 : .115], [x + (axis === 'x' ? offset : 0), y + .21, z + (axis === 'z' ? offset : 0)]);
  }
 }
 const b = {group, add, box, cylinder, beam, ring, rock, plant, bench, railing, books, p: palette};
 // A three-step, visibly edged square collectible plinth; its top is exactly 0.
 box('plinth-lower', '#343b4c', [11.76, .22, 11.76], [0, -.53, 0], {cast: false});
 box('plinth-bevel', '#596378', [12, .14, 12], [0, -.35, 0], {cast: false});
 box('plinth-rim', '#d7cab0', [11.92, .1, 11.92], [0, -.23, 0], {cast: false});
 box('ground', {studio: '#d0b891', classroom: '#bf9871', beach: '#dfc79f', forest: '#7e8c65', city: '#414b61'}[id], [11.8, .18, 11.8], [0, -.09, 0], {cast: false});
 ({studio, classroom, beach, forest, city})[id](b);
 for (const batch of batches.values()) {
  if (!geometryCache.has(batch.shape)) {
   const geometry = batch.shape === 'cylinder' ? new THREE.CylinderGeometry(.5, .5, 1, 10)
    : batch.shape === 'cone' ? new THREE.ConeGeometry(.5, 1, 8)
    : batch.shape === 'rock' ? new THREE.IcosahedronGeometry(.5, 0)
    : batch.shape === 'leaf' ? new THREE.IcosahedronGeometry(.5, 1)
    : batch.shape === 'ring' ? new THREE.TorusGeometry(.465, .035, 5, 24)
    : batch.shape === 'wave' ? new THREE.TorusGeometry(.47, .03, 4, 16, Math.PI * .82)
    : new THREE.BoxGeometry(1, 1, 1);
   // Icosahedra are non-indexed: recomputing normals gives real per-face
   // facets rather than the default sphere-smoothed foliage normals.
   if (batch.shape === 'leaf') geometry.computeVertexNormals();
   geometry.computeBoundingBox();
   geometryCache.set(batch.shape, geometry);state.geometries.add(geometry);
  }
  const wet = id === 'city' && ['road', 'dim-alley', 'puddle'].includes(batch.role);
  const materialKey = `${batch.color}:${batch.glow}:${batch.opacity}:${wet ? batch.role : 'toon'}`;
  if (!materialCache.has(materialKey)) {
   // Keep architecture/props cel shaded. Wet asphalt needs specular response to
   // actual lamps; its bounded planar reflection is separately renderer-owned.
   const common = {color: batch.color, emissive: batch.glow ? batch.color : '#000000', emissiveIntensity: batch.glow, opacity: batch.opacity, transparent: batch.opacity < 1, depthWrite: batch.opacity === 1, side: batch.opacity < 1 ? THREE.DoubleSide : THREE.FrontSide};
   const material = wet
    ? new THREE.MeshStandardMaterial({...common, roughness: batch.role === 'puddle' ? .19 : .34, metalness: .16})
    : new THREE.MeshToonMaterial(common);
   material.forceSinglePass = true;
   materialCache.set(materialKey, material);state.materials.add(material);
  }
  const mesh = new THREE.InstancedMesh(geometryCache.get(batch.shape), materialCache.get(materialKey), batch.transforms.length);
  mesh.name = `${id}:${batch.role}`;mesh.userData.role = batch.role;
  mesh.castShadow = shadows && batch.cast;mesh.receiveShadow = shadows && batch.receive;
  mesh.matrixAutoUpdate = false;
  batch.transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
  state.meshes.add(mesh);group.add(mesh);
 }
 group.updateMatrixWorld(true);
 return group;
}

function studio(b) {
 const {box, cylinder, add, beam, plant, books, p} = b;
 box('room-foundation', '#716655', [9.8, .1, 8.3], [-.65, .05, -.65]);
 // Eight woven tatami rectangles, with dark cloth borders and inset seams.
 for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
  const x = -4.2 + col * 2.2, z = -2.85 + row * 3.35;
  box('tatami-border', '#586252', [2.17, .075, 3.3], [x, .13, z]);
  box('tatami', row % 2 ? '#c8c993' : '#d8d3a4', [2.01, .025, 3.16], [x, .18, z]);
  for (let k = 0; k < 10; k++) box('tatami-weave', '#b3b78c', [1.98, .006, .018], [x, .197, z - 1.4 + k * .31], {cast: false});
 }
 box('wall', '#efe5ce', [9.7, 3.5, .16], [-.65, 1.85, -4.9]);
 box('wall', '#e3d6ba', [.16, 3.5, 7.2], [-5.45, 1.85, -1.35]);
 for (const x of [-5.35, -.5, 4.05]) box('timber-post', '#7f6048', [.16, 3.65, .2], [x, 1.92, -4.75]);
 for (const y of [.3, 3.55]) box('timber-beam', '#7f6048', [9.6, .16, .23], [-.65, y, -4.72]);
 // Rice-paper shoji are actual latticed sliding panels, not a UI panel.
 for (const x of [-2.7, .05, 2.65]) {
  box('shoji-paper', '#faf1d9', [2.35, 2.72, .055], [x, 1.83, -4.77], {glow: .13});
  for (let j = 0; j < 5; j++) box('shoji-lattice', p.wood, [.045, 2.76, .075], [x - 1.16 + j * .58, 1.83, -4.69]);
  for (let j = 0; j < 6; j++) box('shoji-lattice', p.wood, [2.4, .045, .075], [x, .47 + j * .54, -4.69]);
  box('shoji-handle', p.ink, [.075, .22, .03], [x + .95, 1.36, -4.63]);
 }
 box('bookshelf-back', '#6d5947', [.12, 2.72, 2.6], [-5.24, 1.55, -.9]);
 for (const z of [-2.25, .45]) box('bookshelf-upright', p.wood, [.62, 2.8, .12], [-4.98, 1.6, z]);
 for (const y of [.25, .98, 1.71, 2.75]) {
  box('bookshelf-shelf', p.woodLight, [.66, .08, 2.8], [-4.98, y, -.9]);
  if (y < 2) books(-4.8, y + .04, -.9, 12, 'books', 'z');
 }
 box('low-table-rim', '#634d40', [3.15, .16, 1.82], [-.5, .78, .1]);
 box('low-table', '#b5845d', [3.02, .065, 1.69], [-.5, .89, .1]);
 for (const x of [-1.65, .65]) for (const z of [-.5, .7]) box('low-table-leg', '#634d40', [.16, .59, .16], [x, .49, z]);
 for (const [x, z, yaw] of [[-.5, 1.85, .04], [-2.8, 0, .1], [1.8, 0, -.1]]) {
  box('cushion-piping', '#435f6b', [1.14, .15, 1.06], [x, .29, z], {yaw});
  box('cushion', '#7c9ca0', [1.05, .13, .96], [x, .4, z], {yaw});
 }
 box('open-book-pages', '#f8edcf', [1.03, .075, .64], [-1.05, .99, .05], {yaw: -.15});
 box('open-book-spine', '#a47660', [.035, .09, .68], [-1.05, .995, .05], {yaw: -.15});
 for (let i = 0; i < 4; i++) box('book-page-edge', '#cfbe9f', [.95, .006, .015], [-1.05, .97 + i * .014, .36], {yaw: -.15});
 cylinder('tea-tray', '#735b49', [.75, .045, .75], [.35, .955, .05]);
 cylinder('teapot', '#758d77', [.32, .27, .32], [.29, 1.1, .06]);
 cylinder('teapot-lid', '#526d5b', [.23, .04, .23], [.29, 1.255, .06]);
 beam('teapot-spout', '#758d77', [.38, 1.13, .06], [.56, 1.24, .06], .1);
 b.ring('teapot-handle', '#526d5b', .26, .045, [.1, 1.13, .06]);
 for (const z of [-.15, .27]) {
  cylinder('teacup', '#f4e9d2', [.16, .15, .16], [.62, 1.06, z]);
  cylinder('tea', '#74885a', [.125, .008, .125], [.62, 1.139, z]);
 }
 cylinder('reading-lamp-foot', p.ink, [.55, .08, .55], [2.75, .25, -2.5]);
 cylinder('reading-lamp-stem', p.wood, [.065, 1.8, .065], [2.75, 1.18, -2.5]);
 add('reading-lamp-shade', 'cone', '#f4dba4', [.95, .65, .95], [2.75, 2.1, -2.5], {glow: .3});
 plant(-3.8, .2, -3.7, .85);
 // The room is open toward a small engawa and enclosed gravel garden.
 for (let i = 0; i < 18; i++) box('veranda-plank', p.wood, [.47, .1, 1.08], [-4.9 + i * .5, .13, 3]);
 box('veranda-fascia', '#6d5947', [9.1, .24, .12], [-.65, .08, 3.59]);
 box('garden-gravel', '#bcc1b0', [10.7, .03, 1.85], [0, .015, 4.76], {cast: false});
 for (const [x, z, s] of [[-3.9, 4.6, .75], [-1.8, 4.75, .56], [.3, 4.65, .65], [3, 4.8, 1]]) b.rock(x, z, s, 'garden-rock');
 for (const x of [-4.95, 4.8]) {
  add('garden-shrub', 'leaf', p.leaf, [1.15, 1.05, 1.15], [x, .44, 4.6]);
  for (let j = 0; j < 3; j++) cylinder('bamboo', '#8c9a63', [.075, 1.7 + j * .2, .075], [x + (j - 1) * .2, .95 + j * .1, 3.6]);
 }
 for (let i = 0; i < 12; i++) box('gravel-rake', '#a3aa99', [8.6, .007, .025], [-.2, .034, 3.97 + i * .13], {cast: false});
}

function classroom(b) {
 const {box, cylinder, add, books, plant, p} = b;
 box('room-foundation', '#756655', [10.5, .12, 10.1], [0, .06, -.25]);
 box('classroom-floor', '#d0ac7e', [10.2, .035, 9.9], [0, .1375, -.25]);
 for (let i = 0; i < 20; i++) box('floor-seam', '#b88e64', [.018, .006, 9.85], [-4.82 + i * .5, .158, -.25], {cast: false});
 // Back wall is segmented, leaving two real apertures (no painted blue boxes).
 box('wall', '#efe4cb', [4.25, 3.55, .18], [0, 1.925, -5.05]);
 for (const x of [-4.75, 4.75]) box('wall', '#efe4cb', [.7, 3.55, .18], [x, 1.925, -5.05]);
 for (const x of [-3.25, 3.25]) {
  box('wall', '#efe4cb', [2.25, .85, .18], [x, .575, -5.05]);
  box('wall', '#efe4cb', [2.25, .55, .18], [x, 3.425, -5.05]);
  for (const dx of [-1.125, 0, 1.125]) box('window-frame', '#7c8a8b', [.055, 2.2, .15], [x + dx, 2.08, -5.02]);
  for (const y of [1, 2.08, 3.15]) box('window-frame', '#7c8a8b', [2.3, .055, .15], [x, y, -5.02]);
  box('window-sill', p.woodLight, [2.45, .08, .35], [x, 1, -4.93]);
  box('curtain-rail', p.metal, [2.65, .045, .08], [x, 3.28, -4.8]);
  for (const side of [-1, 1]) for (let j = 0; j < 3; j++) {
   box('curtain', j % 2 ? '#b0c4b7' : '#c9d8c5', [.12, 2.05, .13], [x + side * (.88 + j * .1), 2.12, -4.75]);
  }
 }
 box('side-wall', '#ded3ba', [.16, 3.55, 9.8], [-5.12, 1.925, -.2]);
 box('side-wall', '#ded3ba', [.16, 1.2, 3.2], [5.12, .75, -3.45]);
 for (const y of [.3, 1.03]) box('wall-trim', '#998466', [10.2, .075, .08], [0, y, -4.91]);
 box('wall-trim', '#998466', [.08, .18, 9.8], [-5, .25, -.2]);
 box('board-frame', '#8a694c', [3.6, 1.65, .14], [0, 2.1, -4.88]);
 box('board', '#3d665c', [3.4, 1.44, .055], [0, 2.1, -4.775]);
 box('board-tray', '#ad9c7c', [3.65, .06, .24], [0, 1.24, -4.75]);
 box('board-eraser', '#9d8569', [.24, .09, .1], [1.2, 1.32, -4.68]);
 cylinder('clock-rim', p.ink, [.55, .06, .55], [0, 3.24, -4.9], {pitch: Math.PI / 2});
 cylinder('clock-face', '#fbf1d7', [.47, .03, .47], [0, 3.24, -4.85], {pitch: Math.PI / 2});
 for (let i = 0; i < 12; i++) {
  const angle = i * Math.PI / 6;
  box('clock-tick', p.ink, [.018, .045, .01], [Math.sin(angle) * .19, 3.24 + Math.cos(angle) * .19, -4.825], {roll: -angle});
 }
 box('clock-hand', p.ink, [.018, .16, .015], [0, 3.30, -4.807], {roll: -.16});
 box('clock-hand', p.ink, [.13, .018, .015], [.052, 3.24, -4.805]);
 for (const z of [-1.75, 1.1]) for (const x of [-2.7, 0, 2.7]) {
  box('desk-edge', '#806049', [1.65, .115, 1.06], [x, 1.18, z]);
  box('desk-top', '#dfbb83', [1.6, .035, 1.01], [x, 1.255, z]);
  box('desk-storage', '#8f9b99', [1.24, .15, .65], [x, .98, z - .08]);
  for (const dx of [-.61, .61]) for (const dz of [-.35, .35]) box('desk-legs', p.metal, [.065, .96, .065], [x + dx, .64, z + dz]);
  box('desk-brace', p.metal, [1.28, .05, .06], [x, .49, z - .35]);
  box('chair-seat', p.woodLight, [.78, .085, .7], [x, .73, z + .98]);
  box('chair-back', p.woodLight, [.78, .37, .08], [x, 1.22, z + 1.28]);
  for (const dx of [-.29, .29]) {
   box('chair-uprights', p.metal, [.05, .75, .05], [x + dx, 1, z + 1.28]);
   for (const dz of [-.24, .24]) box('chair-legs', p.metal, [.05, .55, .05], [x + dx, .435, z + .98 + dz]);
  }
  box('desk-book', '#74989a', [.52, .05, .4], [x - .24, 1.3, z - .1], {yaw: .07});
  box('desk-book-pages', '#f0e7cc', [.47, .025, .36], [x - .24, 1.336, z - .1], {yaw: .07});
 }
 box('teacher-desk', '#b59269', [2.25, .1, .85], [-.2, 1.05, -3.62]);
 for (const x of [-1.1, .7]) box('teacher-desk-leg', p.metal, [.1, .84, .6], [x, .58, -3.62]);
 books(.3, 1.1, -3.62, 4);
 box('book-cabinet-back', '#9b7d59', [.1, 1.3, 1.9], [-4.91, .81, 2.6]);
 for (const y of [.2, .8, 1.42]) box('book-cabinet', p.woodLight, [.6, .075, 2], [-4.65, y, 2.6]);
 books(-4.55, .84, 2.6, 10, 'books', 'z');
 plant(4.3, .15, -4.2, 1.1);plant(-4.4, 1.46, 2.5, .7);
 box('entry-step', '#9b8a70', [2.4, .1, .65], [3.5, .05, 5.15]);
 // Ceiling stays cut away; short beam ends make the construction legible.
 box('cutaway-beam', '#a89676', [10.4, .14, .25], [0, 3.76, -5.03]);
 box('cutaway-beam', '#a89676', [.25, .14, 9.9], [-5.1, 3.76, -.2]);
}

function forest(b) {
 const {box, add, cylinder, beam, p} = b;
 box('stream-bed', '#526c70', [11.65, .045, 1.9], [0, .025, -.4], {cast: false});
 box('stream', '#7bb3b0', [11.6, .035, 1.55], [0, .065, -.4], {cast: false});
 for (let i = 0; i < 13; i++) {
  const x = -5.25 + i * .85;
  box('stream-current', '#b1d2c3', [.48 + i % 3 * .08, .012, .04], [x, .091, -.72 + (i % 3) * .3], {yaw: -.12, cast: false});
  for (const z of [-1.35, .55]) b.rock(x, z + (i % 2) * .1, .45 + i % 3 * .09, 'stream-bank', '#92978a');
 }
 box('woodland-path', '#baa782', [1.65, .035, 4.4], [.1, .018, 3.15], {cast: false});
 box('woodland-path', '#baa782', [1.65, .035, 4.2], [.1, .018, -3.3], {cast: false});
 for (let i = 0; i < 9; i++) {
  const z = -1.37 + i * .245;
  box('bridge-plank', '#b99265', [2.05, .12, .22], [.1, .4 + Math.sin(i / 8 * Math.PI) * .12, z]);
 }
 for (const x of [-.83, 1.03]) {
  box('bridge-stringer', '#665844', [.12, .22, 2.35], [x, .25, -.4]);
  for (const z of [-1.4, .6]) cylinder('bridge-post', '#776044', [.105, 1.1, .105], [x, .82, z]);
  beam('bridge-rail', '#8f704d', [x, 1.25, -1.4], [x, 1.25, .6], .095);
 }
 const trees = [[-4.3, -4.1, 4.6], [-2.2, -4.1, 5.3], [1.6, -4.05, 4.8], [4.1, -3.7, 5.1], [-4.3, .8, 4], [4.3, .7, 4.5], [-4.2, 4, 3.9], [4.2, 4, 4.1]];
 for (const [x, z, h] of trees) {
  cylinder('tree-trunk', '#79634e', [.32, h * .68, .32], [x, h * .34, z]);
  beam('tree-branch', '#79634e', [x, h * .42, z], [x + .6, h * .68, z + .24], .16);
  add('tree-crown', 'leaf', '#577a62', [2.4, h * .46, 2.25], [x, h * .74, z], {yaw: x});
  add('tree-crown-light', 'leaf', '#8ca273', [1.8, h * .34, 1.8], [x - .25, h * .86, z + .1], {yaw: z});
  for (let i = 0; i < 3; i++) {
   const angle = i * Math.PI * 2 / 3;
   beam('tree-root', '#79634e', [x, .4, z], [x + Math.cos(angle) * .55, .06, z + Math.sin(angle) * .55], .14);
  }
 }
 for (const [x, z, scale] of [[-2.5, -2.6, .9], [2.8, -2, 1.1], [-2.1, 1.8, 1.15], [2.8, 3.9, .85], [-4.9, 2.6, .8], [4.8, 2.5, .75]]) {
  b.rock(x, z, scale, 'forest-rock', '#969c8a');
  add('moss', 'rock', '#96a86f', [scale * .82, .15, scale * .6], [x, scale * .5, z]);
  for (let j = 0; j < 5; j++) {
   const angle = j * Math.PI * 2 / 5;
   add('fern', 'leaf', '#60866a', [.15, .62, .45], [x + .55 + Math.cos(angle) * .12, .3, z + Math.sin(angle) * .12], {yaw: angle, roll: .45});
  }
 }
 b.bench(-2.45, 3.2, 1.9);
 // A squat stone garden lantern, with recessed warm core under a cap.
 box('lantern-foot', '#808a83', [.72, .13, .72], [2.5, .065, 1.9]);
 cylinder('lantern-pedestal', '#929a8e', [.28, .68, .28], [2.5, .47, 1.9]);
 box('lantern-base', '#929a8e', [.62, .1, .62], [2.5, .85, 1.9]);
 box('lantern-glow', '#ffe1a1', [.34, .38, .34], [2.5, 1.1, 1.9], {glow: .55, cast: false, receive: false});
 for (const dx of [-.23, .23]) for (const dz of [-.23, .23]) box('lantern-frame', '#667569', [.07, .46, .07], [2.5 + dx, 1.1, 1.9 + dz]);
 add('lantern-roof', 'cone', '#7d8c80', [1, .35, 1], [2.5, 1.5, 1.9], {yaw: Math.PI / 8});
 for (let i = 0; i < 8; i++) {
  const x = -1.5 + (i % 4) * .8, z = -3 + Math.floor(i / 4) * 7.3;
  add('stepping-stone', 'rock', '#a6a993', [.44, .09, .34], [x, .065, z], {yaw: i});
  cylinder('mushroom-stem', '#d5c9ac', [.045, .13, .045], [x + .35, .09, z + .3]);
  add('mushroom-cap', 'cone', '#b9826c', [.2, .1, .2], [x + .35, .18, z + .3]);
 }
 beam('fallen-branch', '#79634e', [-3.9, .13, -2.4], [-2.8, .13, -1.8], .18);
}

function beach(b) {
 const {box, add, cylinder, beam, p} = b;
 // The sea is a deliberately bounded slice of the square, never a horizon.
 box('sea-bed', '#428e9d', [11.65, .06, 5.1], [0, .03, -3.25], {cast: false});
 box('sea', '#69afbb', [11.6, .025, 4.95], [0, .075, -3.25], {cast: false});
 box('sea-shallows', '#9bcdc6', [11.6, .015, .85], [0, .1, -1.18], {cast: false});
 for (const [x, z, width] of [[-3.6, -4.8, 3], [1.9, -4.5, 3.8], [-1.3, -3.2, 4.1], [3.7, -2.8, 2.4], [-3.8, -1.7, 2.9], [.7, -1.4, 3.3]]) {
  add('wave-crest', 'wave', '#d9f0de', [width, .9, 1], [x, .13, z], {pitch: Math.PI / 2, yaw: .06, cast: false});
  box('wave-glint', '#abdcd4', [width * .62, .012, .04], [x, .115, z - .2], {cast: false});
 }
 for (let i = 0; i < 22; i++) {
  const x = -5.5 + i * .52;
  add('shore-foam', 'rock', '#f4f1d4', [.55, .025, .24], [x, .11, -.72 + Math.sin(i * .8) * .12], {yaw: i, cast: false});
 }
 box('promenade-foundation', '#9b9e99', [11.65, .24, 4.6], [0, .12, 3.15]);
 box('promenade', '#d5cbb2', [11.6, .06, 4.52], [0, .27, 3.15]);
 for (let i = 0; i < 16; i++) box('promenade-seam', '#b8ad98', [.02, .008, 4.5], [-5.5 + i * .72, .305, 3.15], {cast: false});
 box('seawall', '#8b999d', [11.65, .36, .32], [0, .18, .75]);
 b.railing(-5.4, 5.4, .65, 'railing', '#e8e2c9', .35);
 // Hipped-looking paired roof slabs and exposed rafters; no enclosed kiosk.
 for (const x of [-3.9, -1.1]) for (const z of [2, 4]) box('shelter-post', '#81918a', [.13, 2.35, .13], [x, 1.48, z]);
 for (const x of [-3.9, -1.1]) box('shelter-beam', '#566f72', [.16, .16, 2.35], [x, 2.63, 3]);
 for (const side of [-1, 1]) {
  box('shelter-roof', '#6d8c96', [3.6, .13, 1.56], [-2.5, 2.94, 3 + side * .66], {pitch: side * .22});
  for (let i = 0; i < 9; i++) box('roof-seam', '#526f7b', [.035, .025, 1.55], [-4.1 + i * .4, 3.015, 3 + side * .66], {pitch: side * .22});
 }
 box('shelter-ridge', '#526f7b', [3.7, .12, .15], [-2.5, 3.11, 3]);
 b.bench(-2.5, 3.65, 2.25, {baseY: .35});
 // Bench feet sit on a small pad above the raised promenade.
 box('bench-pad', '#8b999d', [2.5, .05, .9], [-2.5, .325, 3.65]);
 b.ring('lifebuoy', '#e5a077', .78, .12, [.55, 1.2, .68]);
 for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
  box('lifebuoy-band', '#fff0ce', [.15, .18, .13], [.55 + Math.sin(angle) * .31, 1.2 + Math.cos(angle) * .31, .67], {roll: -angle});
 }
 beam('lifebuoy-rope', '#bfad85', [.3, .9, .67], [.45, .55, .72], .025);
 for (const x of [3.3, 4.5]) {
  cylinder('seaside-pole', '#7e8581', [.1, 3.45, .1], [x, 2.02, 4.6]);
  box('pole-crossbar', p.wood, [.75, .08, .1], [x, 3.48, 4.6]);
 }
 for (let i = 0; i < 10; i++) {
  const x1 = 3.3 + i * .12, x2 = x1 + .12;
  beam('seaside-wire', '#515f6a', [x1, 3.55 - .18 * Math.sin(i / 10 * Math.PI), 4.6], [x2, 3.55 - .18 * Math.sin((i + 1) / 10 * Math.PI), 4.6], .018, {cast: false});
 }
 for (const [x, z, s] of [[-5.05, -.1, .85], [4.7, -.1, 1], [4.9, -2, .95], [-4.8, -3.2, .7]]) b.rock(x, z, s, 'shore-rock', '#9a9c90');
 for (const [x, z] of [[-5.1, .15], [4.8, .3], [4.9, 5.2], [1.9, 5.2]]) {
  add('grass-mound', 'rock', '#aab58a', [.7, .24, .55], [x, .34, z]);
  for (let i = 0; i < 7; i++) {
   const angle = i * .9;
   beam('coastal-grass', '#899c70', [x, .35, z], [x + Math.sin(angle) * .3, .85 + i % 3 * .1, z + Math.cos(angle) * .2], .035);
  }
 }
 box('overlook-bin', '#749292', [.5, .77, .5], [1.6, .69, 3.8]);
 box('overlook-bin-lid', '#496a73', [.56, .09, .56], [1.6, 1.12, 3.8]);
}

function city(b) {
 const {box, add, cylinder, beam, ring} = b;
 const dark = '#30394d', frame = '#5b6b7c', ivory = '#f4ead5';
 const trim = '#929f9e', joint = '#66747d', wet = {cast: false, receive: false};
 // Local, index-addressed noise makes every chip and rain mark reproducible.
 const noise = n => {const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v);};
 // An L-shaped slate-blue street: the warm shop, not the paving, is the focus.
 box('road', '#293547', [11.65, .025, 3.6], [0, .0125, 4.05], {cast: false});
 box('road', '#293547', [2.55, .025, 8.05], [-4.55, .0125, -1.77], {cast: false});
 box('sidewalk', '#626e7a', [7.75, .14, 7.85], [.68, .07, -1.78]);
 box('sidewalk-curb', '#929eaa', [7.85, .17, .16], [.68, .085, 2.12]);
 box('sidewalk-curb', '#929eaa', [.16, .17, 7.9], [-3.25, .085, -1.77]);
 for (let i = 0; i < 9; i++) box('paving-seam', '#515e70', [.012, .006, 7.6], [-2.9 + i * .85, .144, -1.8], {cast: false});
 for (let i = 0; i < 6; i++) box('paving-seam', '#515e70', [7.6, .006, .012], [.65, .144, -5.1 + i * 1.35], {cast: false});
 box('dim-alley', '#374254', [1.35, .015, 6.7], [4.85, .15, -2.25], {cast: false});
 box('dim-alley', '#374254', [7.2, .015, 1.2], [.5, .15, -5.1], {cast: false});
 // Real walls surround real openings. Cladding details remain on the shell,
 // never across the clear display bays or the partly open door's central gap.
 box('shop-floor', '#eee5cd', [6.2, .075, 4.1], [.5, .205, -1.65], {glow: .18});
 box('shop-back-wall', '#d1d1c4', [6.35, 2.6, .16], [.5, 1.5, -3.75]);
 box('shop-side-wall', '#abb7b6', [.16, 2.6, 4.25], [-2.65, 1.5, -1.7]);
 box('shop-side-wall', '#abb7b6', [.16, 2.6, 4.25], [3.65, 1.5, -1.7]);
 for (const x of [-2.75, 3.75]) {
  box('facade-base', joint, [.065, .23, 4.3], [x, .34, -1.7]);
  for (const y of [.48, 2.62]) box('facade-trim', trim, [.065, .065, 4.3], [x, y, -1.7]);
  for (const z of [-3.72, -2.66, -1.6, -.54, .38]) box('facade-seam', joint, [.018, 2.12, .018], [x, 1.53, z]);
 }
 box('facade-base', joint, [6.4, .23, .06], [.5, .34, -3.86]);
 for (const x of [-2.53, -.47, 3.54]) box('facade-seam', joint, [.018, 2.12, .018], [x, 1.53, -3.84]);
 for (const y of [.48, 2.62]) box('facade-trim', trim, [6.45, .065, .065], [.5, y, -3.86]);
 box('storefront-sill', '#b2bfb7', [4.1, .46, .18], [-.55, .44, .42]);
 box('storefront-sill', '#b2bfb7', [.65, .46, .18], [3.3, .44, .42]);
 for (const [x, width] of [[-.55, 4.1], [3.3, .65]]) {
  box('facade-base', joint, [width, .09, .045], [x, .265, .535]);
  box('facade-trim', trim, [width + .035, .055, .25], [x, .68, .46]);
  for (const y of [.38, .53]) box('facade-seam', joint, [width, .012, .018], [x, y, .52]);
 }
 for (const x of [-1.62, .44, 3.25]) box('facade-seam', joint, [.012, .34, .018], [x, .47, .52]);
 for (const x of [-2.6, -.65, 1.55, 2.8, 3.6]) box('storefront-frame', frame, [.075, 2.45, .16], [x, 1.48, .49]);
 for (const y of [.69, 2.54]) box('storefront-frame', frame, [6.25, .065, .16], [.5, y, .49]);
 for (const x of [-2.55, -.7, 1.5, 2.85, 3.55]) box('glass-gasket', '#3e5260', [.012, 1.77, .035], [x, 1.61, .515]);
 for (const y of [.735, 2.49]) box('glass-gasket', '#3e5260', [6.1, .012, .035], [.5, y, .515]);
 box('storefront-lintel', '#d4d7c8', [6.4, .25, .2], [.5, 2.72, .47]);
 box('door-threshold', '#b1b8af', [1.16, .045, .4], [2.18, .25, .49]);
 for (const z of [.4, .55]) box('entrance-detail', trim, [1.14, .012, .018], [2.18, .28, z]);
 box('door-header', ivory, [1.2, .14, .18], [2.18, 2.45, .5]);
 const glass = {opacity: .14, glow: .04, cast: false, receive: false};
 for (const [x, width] of [[-1.625, 1.86], [.45, 2.1], [3.2, .69]]) {
  box('storefront-glass', '#b3d5dc', [width, 1.76, .025], [x, 1.61, .5], glass);
  box('glass-glint', '#deedee', [.018, .6, .009], [x + width * .22, 1.91, .518], {opacity: .22, glow: .1, roll: -.24, ...wet});
  for (let i = 0; i < 3; i++) box('glass-safety-mark', ivory, [.09, .018, .007], [x + (i - 1) * .18, 1.04, .523], {opacity: .35, ...wet});
 }
 for (const x of [1.75, 2.61]) {
  box('storefront-glass', '#b3d5dc', [.4, 2.1, .025], [x, 1.36, .53], glass);
  box('storefront-frame', frame, [.025, 2.12, .06], [x + (x < 2 ? .2 : -.2), 1.36, .55]);
  box('door-handle', '#a4b1b1', [.035, .5, .06], [x + (x < 2 ? .16 : -.16), 1.23, .59]);
  for (const y of [.33, 2.38]) box('entrance-detail', trim, [.4, .025, .045], [x, y, .555]);
 }
 box('door-sensor', dark, [.21, .055, .07], [2.18, 2.5, .61]);
 box('shop-ceiling', '#eee8d5', [6.35, .12, 4.3], [.5, 2.88, -1.68], {glow: .2});
 for (const x of [-1.4, .4, 2.2]) box('interior-light', '#fff6dc', [.95, .035, 2.8], [x, 2.79, -1.65], {glow: 1.3, ...wet});
 // Cartons alternate with necked, capped bottles. Labels sit below the two
 // protected shelf sight-lines; no opaque window stickers fake merchandise.
 for (const x of [-1.55, .5]) {
  box('shelf-back', '#e9e0c7', [1.7, 1.87, .07], [x, 1.2, -3.52], {glow: .12});
  for (const y of [.34, .88, 1.42, 1.96]) {
   box('shop-shelf', '#f4edda', [1.78, .065, .42], [x, y, -3.3], {glow: .18});
   box('shelf-edge', '#91aca6', [1.78, .045, .026], [x, y, -3.075]);
   for (const dx of [-.58, 0, .58]) box('goods-label', ivory, [.16, .026, .01], [x + dx, y, -3.054]);
  }
  for (const dx of [-.85, .85]) box('shelf-upright', '#c1c6be', [.045, 1.85, .43], [x + dx, 1.21, -3.3]);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
   const color = ['#e4b689', '#91b8b6', '#d9d5a6'][col % 3];
   const gx = x - .68 + col * .195, gy = .53 + row * .54;
   const bottle = col === 0 || col === 2 || col === 6;
   if (bottle) {
    cylinder('shelf-goods', color, [.135, .27, .145], [gx, gy, -3.16], {glow: .12});
    cylinder('bottle-neck', '#c8d5c5', [.065, .055, .065], [gx, gy + .157, -3.16]);
    cylinder('goods-cap', frame, [.076, .035, .076], [gx, gy + .198, -3.16]);
   } else {
    box('shelf-goods', color, [.14, .27 + col % 2 * .07, .2], [gx, gy, -3.16], {glow: .12});
    box('goods-label', ivory, [.115, .018, .17], [gx, gy + .15 + col % 2 * .035, -3.16]);
   }
   box('goods-label', ivory, [.087, .06, .009], [gx, gy - .055, bottle ? -3.084 : -3.051]);
  }
 }
 box('counter', '#b7c7c4', [1.05, .9, 1.9], [2.75, .7, -1.7], {glow: .12});
 box('counter-top', '#faf1d9', [1.15, .08, 2], [2.7, 1.2, -1.7], {glow: .22});
 box('shelf-edge', '#91aca6', [.025, .72, 1.75], [2.21, .72, -1.7]);
 box('register-base', frame, [.3, .08, .3], [2.62, 1.28, -1.35]);
 box('register', frame, [.28, .28, .075], [2.68, 1.45, -1.42], {pitch: -.2});
 box('register-screen', '#8fbdb3', [.225, .19, .008], [2.68, 1.46, -1.372], {pitch: -.2, glow: .35});
 box('counter-display', '#e1be8b', [.55, .055, .52], [2.62, 1.285, -2.15]);
 box('counter-display', '#d4e1d6', [.54, .26, .49], [2.62, 1.44, -2.15], {opacity: .2, ...wet});
 for (const x of [2.48, 2.74]) for (const z of [-2.28, -2.03]) box('countertop-detail', '#d4b58c', [.17, .09, .17], [x, 1.36, z], {yaw: .08});
 box('countertop-detail', '#d4b58c', [.22, .035, .18], [2.6, 1.26, -.94]);
 box('paper-bag', '#d3bd95', [.22, .3, .16], [3.02, 1.4, -1.91]);
 box('goods-label', ivory, [.23, .025, .16], [3.02, 1.56, -1.91]);
 for (let i = 0; i < 5; i++) box('floor-tile-seam', '#cacdbf', [6.1, .006, .018], [.5, .247, -3.35 + i * .75], {cast: false});
 // Unlettered notices belong on the side wall and the narrow right jamb,
 // rather than obscuring the broad glass. Abstract blocks/circles are not type.
 box('notice-board', frame, [.065, .97, 1.38], [-2.775, 1.69, -1.78]);
 for (const [z, y, height, color] of [[-2.11, 1.75, .64, ivory], [-1.5, 1.63, .68, '#b8cbc2']]) {
  box('notice-paper', color, [.014, height, .51], [-2.818, y, z]);
  box('notice-art', '#b99781', [.012, height * .32, .4], [-2.831, y - .1, z]);
  for (const dz of [-.19, .19]) cylinder('notice-pin', trim, [.025, .015, .025], [-2.84, y + height * .4, z + dz], {roll: Math.PI / 2});
 }
 box('notice-board', frame, [.42, .58, .035], [3.22, 1.97, .55]);
 box('notice-paper', ivory, [.35, .5, .012], [3.22, 1.97, .575]);
 cylinder('notice-art', '#b99781', [.2, .012, .2], [3.22, 2.03, .591], {pitch: Math.PI / 2});
 // The architectural marker is a small two-disc orbit, not a brand or glyph.
 box('sign-housing', '#cbd5c9', [6.6, .53, .22], [.5, 3.05, .57]);
 box('sign-band', '#79b6b0', [5.7, .14, .035], [.87, 3.17, .705], {glow: .45});
 box('sign-band', '#f4d79e', [5.7, .08, .035], [.87, 2.97, .705], {glow: .45});
 cylinder('shop-emblem', '#527e84', [.4, .035, .4], [-2.36, 3.055, .711], {pitch: Math.PI / 2});
 ring('shop-emblem', ivory, .29, .014, [-2.36, 3.055, .737], {glow: .35});
 cylinder('shop-emblem', ivory, [.09, .018, .09], [-2.27, 3.11, .752], {pitch: Math.PI / 2, glow: .35});
 // Layered fascia, exposed joists, brackets and three recessed warm strips.
 box('canopy', '#526574', [6.85, .12, .95], [.5, 2.68, .94], {pitch: .035});
 box('canopy-edge', '#394b62', [6.85, .18, .09], [.5, 2.64, 1.42]);
 box('facade-trim', trim, [6.9, .025, .1], [.5, 2.74, 1.44]);
 for (let i = 0; i < 11; i++) box('canopy-rib', '#8c9e9e', [.042, .065, .79], [-2.6 + i * .62, 2.58, .96], {pitch: .035});
 for (const x of [-2.7, -.55, 1.55, 3.65]) {
  box('canopy-rib', '#8c9e9e', [.055, .22, .07], [x, 2.43, .62]);
  beam('canopy-bracket', frame, [x, 2.35, .63], [x, 2.575, 1.15], .037);
 }
 for (const x of [-1.65, .5, 2.65]) box('canopy-light', '#ffe7ba', [1.34, .035, .07], [x, 2.555, 1.235], {glow: 1.1, ...wet});
 for (let i = 0; i < 9; i++) cylinder('canopy-fastener', trim, [.022, .012, .022], [-2.55 + i * .76, 2.64, 1.471], {pitch: Math.PI / 2});
 box('entrance-mat', '#334e59', [1.28, .025, .66], [2.18, .17, 1.13]);
 for (let i = 0; i < 12; i++) box('mat-rib', '#587477', [.014, .007, .58], [1.64 + i * .098, .187, 1.13], {cast: false});
 // The roof has purposeful construction: standing seams, capped parapets,
 // equipment feet, fan guards, a cable route and a draining rear scupper.
 box('roof-cap', '#455866', [6.6, .16, 4.55], [.5, 3.29, -1.67]);
 for (const z of [-3.94, .58]) {
  box('roof-parapet', '#7c9097', [6.7, .21, .09], [.5, 3.45, z]);
  box('facade-trim', trim, [6.75, .035, .16], [.5, 3.57, z]);
 }
 for (const x of [-2.81, 3.81]) {
  box('roof-parapet', '#7c9097', [.09, .21, 4.55], [x, 3.45, -1.67]);
  box('facade-trim', trim, [.16, .035, 4.6], [x, 3.57, -1.67]);
 }
 for (const x of [-1.72, -.2, 1.32, 2.84]) box('roof-seam', '#586e79', [.022, .016, 4.3], [x, 3.38, -1.67]);
 for (const z of [-2.97, -2.23]) box('mechanical-detail', frame, [1.46, .1, .12], [2.3, 3.39, z]);
 box('roof-hvac', '#9aa6ab', [1.35, .44, 1.05], [2.3, 3.66, -2.6]);
 for (const x of [1.98, 2.62]) {
  cylinder('hvac-fan', '#526170', [.47, .035, .47], [x, 3.9, -2.6]);
  for (const yaw of [0, Math.PI / 3, Math.PI * 2 / 3]) box('mechanical-detail', frame, [.42, .014, .018], [x, 3.927, -2.6], {yaw});
 }
 for (let i = 0; i < 5; i++) box('hvac-grille', frame, [1.1, .035, .025], [2.3, 3.53 + i * .055, -2.055]);
 cylinder('roof-vent', '#a7b2b3', [.23, .5, .23], [-1.8, 3.64, -2.9]);
 cylinder('mechanical-detail', frame, [.42, .035, .42], [-1.8, 3.39, -2.9]);
 add('roof-vent-cap', 'cone', '#6b7b87', [.47, .15, .47], [-1.8, 3.94, -2.9]);
 for (const [a, c] of [[[2.85, 3.42, -2.8], [3.42, 3.42, -2.8]], [[3.42, 3.42, -2.8], [3.42, 3.42, -3.76]], [[3.42, 3.42, -3.88], [3.42, 1.02, -3.88]]]) beam('service-conduit', frame, a, c, .035);
 beam('downpipe', '#697988', [3.79, .25, -3.7], [3.79, 3.3, -3.7], .08);
 beam('downpipe', '#697988', [3.79, 3.3, -3.7], [3.54, 3.38, -3.7], .08);
 beam('downpipe', '#697988', [3.79, .25, -3.7], [3.96, .19, -3.86], .08);
 for (const y of [.55, 1.8, 2.95]) box('mechanical-detail', frame, [.14, .045, .13], [3.79, y, -3.7]);
 box('back-service-door', '#6d7a83', [1, 1.92, .04], [1.65, 1.17, -3.85]);
 for (const x of [1.11, 2.19]) box('facade-trim', trim, [.055, 1.98, .065], [x, 1.17, -3.88]);
 box('facade-trim', trim, [1.13, .055, .065], [1.65, 2.17, -3.88]);
 box('mechanical-detail', frame, [1.25, .055, .36], [1.65, 2.31, -3.97], {pitch: -.08});
 box('back-door-handle', '#aab8b8', [.15, .025, .04], [1.95, 1.14, -3.89]);
 for (const z of [-2.94, -2.16]) box('mechanical-detail', frame, [.66, .13, .13], [4.07, .23, z]);
 box('outdoor-ac', '#a9b9b9', [.55, .83, 1.05], [4.07, .71, -2.55]);
 cylinder('outdoor-ac-fan', frame, [.58, .04, .58], [4.36, .73, -2.55], {roll: Math.PI / 2});
 for (let i = 0; i < 5; i++) box('ac-grille', '#8c999c', [.035, .6, .025], [4.395, .74, -2.79 + i * .12]);
 beam('service-conduit', frame, [3.78, .72, -2.95], [3.78, 1.94, -2.95], .045);
 // Generic vending case with a recessed tray and blank selection buttons.
 box('vending-machine', '#816c85', [.85, 1.85, .73], [4.55, 1.08, .1]);
 box('vending-window', '#a7cccf', [.62, 1.04, .035], [4.5, 1.32, .48], {glow: .4});
 for (const x of [4.16, 4.84]) box('entrance-detail', trim, [.025, 1.13, .055], [x, 1.32, .5]);
 for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
  const x = 4.3 + col * .19, y = 1 + row * .29;
  cylinder('vending-bottle', '#e3c79c', [.09, .2, .09], [x, y, .53]);
  cylinder('goods-cap', frame, [.065, .027, .065], [x, y + .113, .53]);
  box('vending-button', '#f6e7c8', [.06, .035, .03], [x, .85 + row * .29, .55], {glow: .3});
 }
 box('vending-slot', dark, [.53, .18, .04], [4.53, .49, .49]);
 box('entrance-detail', trim, [.56, .025, .12], [4.53, .39, .55]);
 // Retain the small existing spoked bicycle, without adding street traffic.
 for (const x of [-2.45, -1.24]) {
  ring('bicycle-tire', '#293443', .75, .07, [x, .56, 1.47]);
  ring('bicycle-rim', '#acb9b8', .64, .025, [x, .56, 1.47]);
  for (let i = 0; i < 8; i++) {
   const angle = i * Math.PI / 4;
   beam('bicycle-spoke', '#8b9ba4', [x, .56, 1.47], [x + Math.cos(angle) * .31, .56 + Math.sin(angle) * .31, 1.47], .013);
  }
 }
 for (const [a, c] of [
  [[-2.45, .56, 1.47], [-2.02, 1.12, 1.47]], [[-2.02, 1.12, 1.47], [-1.79, .56, 1.47]],
  [[-1.79, .56, 1.47], [-2.45, .56, 1.47]], [[-2.02, 1.12, 1.47], [-1.39, 1.15, 1.47]],
  [[-1.39, 1.15, 1.47], [-1.79, .56, 1.47]], [[-1.39, 1.15, 1.47], [-1.24, .56, 1.47]]
 ]) beam('bicycle-frame', '#a9b9a8', a, c, .045);
 box('bicycle-saddle', dark, [.3, .055, .16], [-2.03, 1.22, 1.47]);
 beam('bicycle-handlebar', '#a9b9a8', [-1.39, 1.15, 1.47], [-1.42, 1.35, 1.47], .04);
 beam('bicycle-handlebar', '#a9b9a8', [-1.42, 1.35, 1.25], [-1.42, 1.35, 1.67], .04);
 beam('bicycle-stand', '#8b9ba4', [-1.79, .56, 1.47], [-1.65, .17, 1.65], .025);
 // Slatted umbrella drip rack, open delivery crate, and two folded packages.
 box('umbrella-stand', frame, [.46, .065, .38], [3.25, .2, 1.1]);
 for (const z of [.92, 1.28]) {
  box('umbrella-stand', frame, [.46, .035, .025], [3.25, .56, z]);
  for (let i = 0; i < 4; i++) box('umbrella-stand', frame, [.023, .33, .025], [3.05 + i * .133, .38, z]);
 }
 for (let i = 0; i < 3; i++) {
  const x = 3.1 + i * .14;
  cylinder('umbrella-shaft', '#acb5b6', [.025, .86, .025], [x, .79, 1.1]);
  add('closed-umbrella', 'cone', i % 2 ? '#8ba3ba' : '#ae8ca1', [.17, .65, .17], [x, .69, 1.1], {roll: Math.PI});
  ring('umbrella-handle', '#acb5b6', .12, .018, [x, 1.24, 1.1]);
 }
 box('delivery-crate', '#9d8272', [.43, .05, .64], [-2.97, .18, -.25]);
 for (const x of [-3.17, -2.77]) {
  for (const y of [.3, .46]) box('delivery-crate', '#9d8272', [.026, .06, .64], [x, y, -.25]);
  for (const z of [-.55, .05]) box('delivery-crate', '#9d8272', [.026, .34, .026], [x, .35, z]);
 }
 for (const z of [-.55, .05]) box('delivery-crate', '#9d8272', [.43, .06, .025], [-2.97, .46, z]);
 for (const z of [-.4, -.14]) box('paper-bag', '#d3bd95', [.25, .31, .19], [-2.97, .36, z]);
 for (const z of [-1.15, -.35]) {
  box('recycling-bin', '#6d8b8f', [.57, .84, .6], [4.75, .57, z]);
  box('bin-lid', '#91a9a8', [.62, .09, .64], [4.75, 1.03, z]);
  box('bin-opening', '#384b5b', [.3, .12, .025], [4.75, .87, z + .31]);
 }
 cylinder('street-lamp', '#53677c', [.095, 3.35, .095], [-3.07, 1.82, 1.75]);
 beam('lamp-arm', '#53677c', [-3.07, 3.4, 1.75], [-2.78, 3.45, 1.75], .07);
 box('lamp-head', '#f4e0b4', [.45, .14, .3], [-2.7, 3.45, 1.75], {glow: .9, ...wet});
 for (const x of [-4.55, 4.9]) {
  cylinder('utility-pole', '#6f7581', [.14, 4.85, .14], [x, 2.43, -4.85]);
  box('utility-crossbar', '#7f8a94', [.8, .075, .12], [x, 4.35, -4.85]);
  for (const dx of [-.28, .28]) cylinder('insulator', '#b9c6c3', [.09, .16, .09], [x + dx, 4.47, -4.85]);
 }
 for (const z of [-4.92, -4.72]) for (let i = 0; i < 24; i++) {
  const t = i / 24, next = (i + 1) / 24;
  beam('sagging-wire', '#384456', [-4.55 + 9.45 * t, 4.57 - .58 * Math.sin(t * Math.PI), z], [-4.55 + 9.45 * next, 4.57 - .58 * Math.sin(next * Math.PI), z], .024, {cast: false});
 }
 cylinder('street-sign-post', '#85989e', [.055, 2.03, .055], [-3.08, 1.16, -1.75]);
 box('street-sign', '#8aa6b0', [.63, .31, .065], [-3.08, 2.03, -1.75]);
 b.railing(-2.5, .45, 2.12, 'guardrail', '#9daeb0', .15);
 for (let i = 0; i < 7; i++) box('zebra-crossing', '#9daeb0', [1.65, .01, .22], [-4.4, .035, 2.75 + i * .4], {cast: false});
 for (const x of [-1.8, .3, 2.4]) {
  box('parking-line', '#8f9d9e', [.04, .01, 1.45], [x, .035, 4.75], {cast: false});
  box('parking-line', '#8f9d9e', [1.4, .01, .04], [x + .7, .035, 5.45], {cast: false});
 }
 box('drain', '#29384b', [1, .015, .3], [1.2, .04, 2.4], {cast: false});
 for (let i = 0; i < 9; i++) box('drain-grate', '#788999', [.035, .018, .27], [.77 + i * .11, .052, 2.4], {cast: false});
 // Ragged pools have dark scalloped margins, not four perfect bright ovals.
 const pools = [[-1.4, 3.1, 2.1, .65], [2.7, 4.1, 1.8, .8], [-4.55, .6, 1.3, 1.1], [.1, 5.55, 1.4, .3]];
 pools.forEach(([x, z, sx, sz], i) => {
  for (let k = 0; k < 3; k++) cylinder('puddle-edge', '#354b5c', [sx * (.55 + noise(i * 9 + k) * .4), .005, sz * (.7 + noise(i * 9 + k + 30) * .45)], [x + (k - 1) * sx * .22, .035, z + (noise(i * 9 + k + 80) - .5) * sz * .4], {yaw: noise(i + k) * .5, ...wet});
  cylinder('puddle', '#405b70', [sx, .006, sz], [x, .04, z], {yaw: (noise(i + 20) - .5) * .18, ...wet});
  for (let k = 0; k < 3; k++) ring('puddle-ripple', '#6d899a', (.14 + k * .16) * Math.min(1, sz / .65), .005, [x + sx * .14, .05 + k * .001, z], {pitch: Math.PI / 2, opacity: .48, ...wet});
 });
 cylinder('puddle', '#405b70', [.53, .005, .32], [3.25, .151, 1.46], wet);
 // Fine aggregate and irregular damp patches remain quiet under the lighting.
 for (let i = 0; i < 88; i++) {
  const left = i % 4 === 0, x = left ? -5.58 + noise(i + 101) * 2.05 : -2.8 + noise(i + 101) * 8.35;
  const z = left ? -5.45 + noise(i + 301) * 7.4 : 2.52 + noise(i + 301) * 3.1;
  box('wet-asphalt', i % 3 ? '#334256' : '#415267', [.035 + noise(i + 501) * .2, .003, .018 + noise(i + 701) * .095], [x, .029, z], {yaw: noise(i + 901) * 3, ...wet});
 }
 // Independent little reflection islands: no regular rows, light columns or
 // zebra-like repeating widths. Muted tints let the real local lights lead.
 for (const [cx, cz, sx, sz, color, seed] of [[-.9, 3.15, 1.65, 1.1, '#949b80', 1], [1.2, 3.85, 1.2, 1.8, '#6d969d', 71], [4.45, 3.05, .95, 1.05, '#8c798e', 141], [-4.55, .55, 1.05, 1.7, '#6d969d', 211]]) {
  for (let i = 0; i < 15; i++) {
   const n = seed + i * 7, x = cx + (noise(n) - .5) * sx, z = cz + (noise(n + 1) - .5) * sz;
   box('wet-reflection', color, [.055 + noise(n + 2) * .34, .004, .012 + noise(n + 3) * .041], [x, .055, z], {yaw: (noise(n + 4) - .5) * .5, glow: .08, opacity: .56, ...wet});
  }
 }
 for (const [x, z, d] of [[-.65, 3.25, .16], [2.96, 4.11, .21], [-4.72, .29, .18], [4.5, 2.76, .13]]) ring('puddle-ripple', '#6d899a', d, .005, [x, .052, z], {pitch: Math.PI / 2, opacity: .48, ...wet});
}
