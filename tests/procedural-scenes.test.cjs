const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../src/ui/procedural-scenes.mjs');
const threePromise = import('three');

function meshes(group) {const result = [];group.traverse(object => {if (object.isMesh) result.push(object);});return result;}
function resourceSets(group) {
 const objects = meshes(group);
 return {objects, geometries: new Set(objects.map(mesh => mesh.geometry)), materials: new Set(objects.map(mesh => mesh.material))};
}
function byRole(group, role) {return meshes(group).filter(mesh => mesh.userData.role === role);}
function roleCount(group, role) {return byRole(group, role).reduce((sum, mesh) => sum + mesh.count, 0);}
function requireRoles(group, roles) {for (const role of roles) assert.ok(roleCount(group, role) > 0, `${group.name}: ${role}`);}
function firstHit(THREE, group, origin, direction, far = 100) {
 return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction), 0, far).intersectObjects(group.children)[0];
}

// Apply each instance's full matrix, including rotation; a mesh aggregate or
// unrotated center+size check would miss a protruding canopy/tree/diagonal wire.
function instanceBounds(THREE, mesh) {
 const matrix = new THREE.Matrix4();
 return Array.from({length: mesh.count}, (_, i) => {
  mesh.getMatrixAt(i, matrix);
  return mesh.geometry.boundingBox.clone().applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);
 });
}

test('deterministic cel miniatures and wet city surfaces stay inside their scene-specific budgets', async () => {
 const {createEnvironment, disposeEnvironment, ENVIRONMENT_IDS, ENVIRONMENT_BUDGET, CITY_ENVIRONMENT_BUDGET, environmentBudget} = await modulePromise;
 const THREE = await threePromise;
 assert.deepEqual(ENVIRONMENT_IDS, ['studio', 'classroom', 'beach', 'forest', 'city']);
 assert.ok(ENVIRONMENT_BUDGET.drawCalls <= 100 && ENVIRONMENT_BUDGET.triangles <= 70000 && ENVIRONMENT_BUDGET.instances <= 1600);
 for (const id of ENVIRONMENT_IDS) {
  const group = createEnvironment(id), again = createEnvironment(id), budget = environmentBudget(id);
  assert.equal(budget, id === 'city' ? CITY_ENVIRONMENT_BUDGET : ENVIRONMENT_BUDGET);
  if(id==='city')assert.deepEqual(budget,{drawCalls:150,triangles:32000,instances:1100});
  try {
   assert.ok(group instanceof THREE.Group);assert.equal(group.userData.environmentId, id);
   assert.equal(group.userData.proceduralEnvironment, true);assert.equal(group.userData.diorama, true);
   assert.deepEqual(group.userData.footprint, {size: 12, min: -6, max: 6});assert.deepEqual(group.userData.focus, [0, 1.5, 0]);
   assert.equal(group.userData.floorY, 0);assert.equal(group.userData.characterHeight, 2);
   const stats = group.userData.stats, objects = meshes(group), repeats = meshes(again);
   console.info(`${id}: ${JSON.stringify(stats)}`);
   assert.ok(stats.drawCalls > 0 && stats.drawCalls <= budget.drawCalls, `${id}: ${stats.drawCalls} draw calls`);
   assert.ok(stats.triangles > 0 && stats.triangles <= budget.triangles, `${id}: triangles`);
   assert.ok(stats.instances > 0 && stats.instances <= budget.instances, `${id}: instances`);
   assert.deepEqual(stats, again.userData.stats);assert.equal(stats.drawCalls, objects.length);
   let computedTriangles = 0, instances = 0;
   for (const [index, mesh] of objects.entries()) {
    const repeat = repeats[index];
    assert.ok(mesh.isInstancedMesh);assert.ok(mesh.geometry.isBufferGeometry);
    const wet=id==='city'&&['road','dim-alley','puddle'].includes(mesh.userData.role);
    assert.ok(wet?mesh.material.isMeshStandardMaterial:mesh.material.isMeshToonMaterial);
    if(wet)assert.ok(mesh.material.roughness>=.15&&mesh.material.roughness<=.4,'wet surfaces respond to actual lights without becoming polished metal');
    assert.ok(mesh.geometry.attributes.normal.count > 0);
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
     assert.ok([...attribute.array].every(Number.isFinite));
     assert.deepEqual(attribute.array, repeat.geometry.attributes[name].array, `${id}/${mesh.name}: deterministic ${name}`);
    }
    assert.deepEqual(mesh.geometry.index?.array, repeat.geometry.index?.array);
    if (mesh.geometry.type === 'IcosahedronGeometry') {
     const normal = mesh.geometry.attributes.normal;
     for (let i = 0; i < normal.count; i += 3) for (let j = 1; j < 3; j++) {
      assert.ok(Math.abs(normal.getX(i) - normal.getX(i + j)) < 1e-6 && Math.abs(normal.getY(i) - normal.getY(i + j)) < 1e-6 && Math.abs(normal.getZ(i) - normal.getZ(i + j)) < 1e-6, 'foliage/rocks use clean per-face normals');
     }
    }
    assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));assert.deepEqual(mesh.instanceMatrix.array, repeat.instanceMatrix.array);
    assert.notEqual(mesh.geometry, repeat.geometry);assert.notEqual(mesh.material, repeat.material);
    assert.equal(mesh.material.color.getHex(), repeat.material.color.getHex());
    assert.equal(mesh.material.emissive.getHex(), repeat.material.emissive.getHex());assert.equal(mesh.material.emissiveIntensity, repeat.material.emissiveIntensity);
    for (const value of Object.values(mesh.material)) assert.ok(!value?.isTexture, 'no network/texture/canvas-backed decoration');
    computedTriangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3 * mesh.count;
    instances += mesh.count;
    assert.ok(mesh.boundingBox && mesh.boundingSphere);assert.equal(mesh.castShadow, false);assert.equal(mesh.receiveShadow, false);
    assert.ok(mesh.userData.role && mesh.name.startsWith(`${id}:`));
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < mesh.count; i++) {mesh.getMatrixAt(i, matrix);assert.ok(matrix.determinant() > 0, 'nondegenerate positive-size instance');}
   }
   assert.equal(computedTriangles, stats.triangles);assert.equal(instances, stats.instances);
   assert.equal(resourceSets(group).geometries.size, stats.geometries);assert.equal(resourceSets(group).materials.size, stats.materials);
   // Even where one scene uses the same palette and shape, no GPU resource
   // overlaps the second factory's resources (not just corresponding meshes).
   for (const resource of resourceSets(group).geometries) assert.ok(!resourceSets(again).geometries.has(resource));
   for (const resource of resourceSets(group).materials) assert.ok(!resourceSets(again).materials.has(resource));
  } finally {disposeEnvironment(group);disposeEnvironment(again);}
 }
});

test('every rotated instance stays on the square plinth, with a zero-height floor and visible stepped edges', async () => {
 const {createEnvironment, disposeEnvironment, ENVIRONMENT_IDS} = await modulePromise;
 const THREE = await threePromise;
 for (const id of ENVIRONMENT_IDS) {
  const group = createEnvironment(id);
  try {
   requireRoles(group, ['ground', 'plinth-lower', 'plinth-bevel', 'plinth-rim']);
   for (const mesh of meshes(group)) for (const [i, bounds] of instanceBounds(THREE, mesh).entries()) {
    const label = `${id}/${mesh.userData.role}/${i}`;
    assert.ok(bounds.min.x >= -6 - 1e-5 && bounds.max.x <= 6 + 1e-5, `${label}: x ${bounds.min.x}..${bounds.max.x}`);
    assert.ok(bounds.min.z >= -6 - 1e-5 && bounds.max.z <= 6 + 1e-5, `${label}: z ${bounds.min.z}..${bounds.max.z}`);
    assert.ok(bounds.max.y <= 7 && bounds.min.y >= -.65, `${label}: no giant backdrop or underground mesh`);
   }
   const floor = byRole(group, 'ground')[0].boundingBox;
   assert.ok(Math.abs(floor.max.y) < 1e-6, `${id}: plinth floor y=0`);
   const lower = byRole(group, 'plinth-lower')[0].boundingBox, bevel = byRole(group, 'plinth-bevel')[0].boundingBox, rim = byRole(group, 'plinth-rim')[0].boundingBox;
   assert.ok(lower.max.y < bevel.max.y && bevel.max.y < rim.max.y && rim.max.y < floor.max.y);
   assert.ok(Math.abs(bevel.min.x + 6) < 1e-6 && Math.abs(bevel.max.x - 6) < 1e-6);
   assert.ok(Math.abs(bevel.min.z + 6) < 1e-6 && Math.abs(bevel.max.z - 6) < 1e-6);
   for (const mesh of meshes(group)) assert.ok(!/sky|horizon|backdrop|billboard|hud|logo|lettering|car-|person|avatar/.test(mesh.userData.role));
   assert.ok(group.children.every(object => object.isInstancedMesh), 'no hidden lights, external assets, lines or overlays');
   const bounds = new THREE.Box3().setFromObject(group);assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).x - 12) < 1e-5);assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).z - 12) < 1e-5);
   // The replaced portrait rule is intentionally gone: a collectible may put
   // interesting geometry in the foreground and must be inspectable in orbit.
   assert.ok(meshes(group).some(mesh => mesh.boundingBox.max.z > 2 && mesh.boundingBox.max.y > .1 && !mesh.userData.role.startsWith('plinth')));
  } finally {disposeEnvironment(group);}
 }
});

test('classroom has six complete desks/chairs, a blank board, clock, books, curtains and genuine window apertures', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, group = createEnvironment('classroom');
 try {
  requireRoles(group, ['desk-top', 'desk-storage', 'desk-brace', 'chair-seat', 'chair-back', 'board', 'board-tray', 'clock-face', 'clock-hand', 'books', 'curtain', 'plant-pot', 'plant-leaf', 'cutaway-beam']);
  assert.equal(roleCount(group, 'desk-top'), 6);assert.equal(roleCount(group, 'desk-legs'), 24);
  assert.equal(roleCount(group, 'chair-seat'), 6);assert.equal(roleCount(group, 'chair-back'), 6);assert.equal(roleCount(group, 'chair-legs'), 24);
  assert.equal(roleCount(group, 'window-sill'), 2);assert.equal(roleCount(group, 'window-frame'), 12);
  assert.equal(roleCount(group, 'clock-tick'), 12);assert.equal(roleCount(group, 'board'), 1);
  for (const x of [-3.65, 2.85]) {
   assert.equal(firstHit(THREE, group, [x, 2.5, -4.4], [0, 0, -1], 2), undefined, 'unfilled opening, not an opaque painted window');
   assert.equal(firstHit(THREE, group, [x, 2.5, -5.7], [0, 0, 1], .9), undefined, 'opening genuinely clear from the back too');
  }
  assert.equal(firstHit(THREE, group, [0, 2, -3.8], [0, 0, -1])?.object.userData.role, 'board');
 } finally {disposeEnvironment(group);}
});

test('studio is a furnished tatami reading room with dimensional tea, shoji, books and a small garden/veranda', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, group = createEnvironment('studio');
 try {
  requireRoles(group, ['tatami', 'tatami-border', 'tatami-weave', 'low-table', 'low-table-leg', 'open-book-pages', 'open-book-spine', 'teapot', 'teapot-spout', 'teapot-handle', 'teacup', 'tea', 'cushion', 'shoji-paper', 'shoji-lattice', 'bookshelf-shelf', 'books', 'reading-lamp-shade', 'veranda-plank', 'garden-rock', 'garden-gravel', 'bamboo']);
  assert.equal(roleCount(group, 'tatami'), 8);assert.equal(roleCount(group, 'cushion'), 3);assert.equal(roleCount(group, 'teacup'), 2);
  assert.ok(roleCount(group, 'shoji-lattice') >= 30);assert.ok(roleCount(group, 'books') >= 30);
  assert.equal(firstHit(THREE, group, [-.8, 3, .05], [0, -1, 0])?.object.userData.role, 'open-book-pages');
  assert.ok(byRole(group, 'reading-lamp-shade')[0].material.emissiveIntensity > 0);
 } finally {disposeEnvironment(group);}
});

test('forest has a real crossing footbridge, stream, rooted trees, moss, lantern and bench', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, group = createEnvironment('forest');
 try {
  requireRoles(group, ['woodland-path', 'stream', 'stream-current', 'stream-bank', 'bridge-plank', 'bridge-rail', 'bridge-post', 'tree-trunk', 'tree-root', 'tree-branch', 'tree-crown', 'forest-rock', 'moss', 'fern', 'lantern-glow', 'lantern-roof', 'bench-seat', 'mushroom-cap']);
  assert.equal(roleCount(group, 'tree-trunk'), 8);assert.equal(roleCount(group, 'tree-crown'), 8);assert.equal(roleCount(group, 'bridge-plank'), 9);
  assert.equal(firstHit(THREE, group, [.1, 3, -.4], [0, -1, 0])?.object.userData.role, 'bridge-plank');
  assert.equal(firstHit(THREE, group, [2, 2, -.4], [0, -1, 0])?.object.userData.role, 'stream');
  const stream = byRole(group, 'stream')[0].boundingBox, deck = byRole(group, 'bridge-plank')[0].boundingBox;
  assert.ok(deck.min.y > stream.max.y && deck.min.z < stream.min.z && deck.max.z > stream.max.z);
 } finally {disposeEnvironment(group);}
});

test('beach is a bounded Japanese seaside overlook with sea slice, raised promenade, shelter and safety details', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, group = createEnvironment('beach');
 try {
  requireRoles(group, ['sea', 'sea-shallows', 'shore-foam', 'wave-crest', 'promenade', 'railing', 'seawall', 'shelter-post', 'shelter-roof', 'bench-seat', 'lifebuoy', 'lifebuoy-rope', 'seaside-pole', 'seaside-wire', 'coastal-grass', 'shore-rock']);
  assert.equal(roleCount(group, 'shelter-post'), 4);assert.equal(roleCount(group, 'lifebuoy'), 1);
  assert.equal(firstHit(THREE, group, [0, 3, -4], [0, -1, 0])?.object.userData.role, 'sea');
  const sea = byRole(group, 'sea')[0].boundingBox, promenade = byRole(group, 'promenade')[0].boundingBox;
  assert.ok(sea.max.z < promenade.min.z);assert.ok(sea.max.y < promenade.min.y);
  assert.ok(sea.getSize(new THREE.Vector3()).x < 12 && sea.getSize(new THREE.Vector3()).z < 6);
  assert.ok(byRole(group, 'shore-foam')[0].boundingBox.max.z < 0);
 } finally {disposeEnvironment(group);}
});

test('city has a genuinely open convenience store with directly visible warm interior shelves and counter', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, group = createEnvironment('city', {timeOfDay: 23});
 try {
  requireRoles(group, ['shop-floor', 'shop-back-wall', 'shop-side-wall', 'storefront-sill', 'storefront-frame', 'door-threshold', 'interior-light', 'shelf-back', 'shop-shelf', 'shelf-goods', 'counter', 'counter-top', 'canopy', 'canopy-light', 'sign-band', 'entrance-mat']);
  assert.equal(roleCount(group, 'shop-side-wall'), 2);assert.equal(roleCount(group, 'shelf-goods'), 48);
  // Real transparent panes precede real shelf goods; the shell is not a
  // glass-colored opaque box. Display bays and sliding doors remain distinct.
  const glass=byRole(group,'storefront-glass')[0];assert.equal(glass.count,5);assert.equal(glass.material.transparent,true);assert.ok(glass.material.opacity>0&&glass.material.opacity<.2);assert.equal(glass.material.depthWrite,false);assert.equal(glass.castShadow,false);
  const contentHit=origin=>new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(0,0,-1)).intersectObjects(group.children).find(hit=>!hit.object.material.transparent);
  for (const x of [-1.45, .405]) {assert.equal(firstHit(THREE, group, [x, 1.61, 2], [0, 0, -1])?.object.userData.role, 'storefront-glass');assert.equal(contentHit([x,1.61,2])?.object.userData.role,'shelf-goods');}
  assert.equal(contentHit([2.5,.9,1.9])?.object.userData.role,'counter');
  const openDoor = firstHit(THREE, group, [2.18, 1.8, 1.9], [0, 0, -1]);
  assert.equal(openDoor?.object.userData.role, 'shop-back-wall');assert.ok(openDoor.point.z < -3.5);
  const roof = byRole(group, 'roof-cap')[0].boundingBox;
  assert.ok(Math.abs(roof.getCenter(new THREE.Vector3()).x) < 1 && roof.getCenter(new THREE.Vector3()).z < 0, 'store core centered in upper-middle of base');
  assert.ok(byRole(group, 'interior-light').every(mesh => mesh.material.emissiveIntensity >= 1));
  for (const mesh of byRole(group, 'sign-band')) {
   const size = mesh.boundingBox.getSize(new THREE.Vector3());assert.ok(size.x > 30 * size.y, 'original horizontal unlettered bands');
  }
  assert.equal(group.userData.timeOfDay, 23);
 } finally {disposeEnvironment(group);}
});

test('rainy city includes detailed street life without people/cars, contained wires and broken wet-light geometry', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, group = createEnvironment('city');
 try {
  requireRoles(group, ['vending-machine', 'vending-bottle', 'bicycle-tire', 'bicycle-frame', 'bicycle-spoke', 'bicycle-saddle', 'bicycle-handlebar', 'umbrella-stand', 'closed-umbrella', 'recycling-bin', 'street-lamp', 'utility-pole', 'sagging-wire', 'street-sign', 'guardrail', 'road', 'parking-line', 'drain-grate', 'puddle', 'puddle-ripple', 'wet-reflection', 'zebra-crossing', 'dim-alley', 'outdoor-ac', 'roof-hvac', 'roof-vent', 'back-service-door', 'downpipe']);
  assert.equal(roleCount(group, 'bicycle-tire'), 2);assert.equal(roleCount(group, 'bicycle-spoke'), 16);assert.equal(roleCount(group, 'recycling-bin'), 2);
  assert.equal(roleCount(group, 'utility-pole'), 2);assert.equal(roleCount(group, 'sagging-wire'), 48);
  assert.equal(roleCount(group, 'wet-reflection'), 60);assert.equal(roleCount(group, 'puddle'), 5);assert.equal(roleCount(group, 'zebra-crossing'), 7);
  requireRoles(group,['facade-trim','facade-seam','canopy-rib','canopy-bracket','notice-board','notice-paper','shop-emblem','bottle-neck','goods-cap','roof-seam','mechanical-detail','delivery-crate','wet-asphalt','puddle-edge']);
  assert.equal(roleCount(group,'canopy-light'),3);assert.equal(roleCount(group,'wet-asphalt'),88);assert.equal(roleCount(group,'puddle-ripple'),16);
  const roads = instanceBounds(THREE, byRole(group, 'road')[0]);
  assert.ok(roads.some(bounds => bounds.min.z > 2), 'foreground road');assert.ok(roads.some(bounds => bounds.max.x < -3), 'left road');
  for (const mesh of byRole(group, 'wet-reflection')) {
   const bounds = instanceBounds(THREE, mesh);
   for (const patch of bounds) assert.ok(patch.max.y < .1 && patch.getSize(new THREE.Vector3()).x < 1 && patch.getSize(new THREE.Vector3()).z < .2);
   const zs = bounds.map(patch => patch.min.z).sort((a, c) => a - c);
   const gaps=zs.slice(1).map((z,i)=>z-zs[i]);
   assert.ok(Math.max(...gaps)-Math.min(...gaps)>.05,'wet fragments have irregular placement, not the old equidistant light stripes');
   assert.ok(bounds.some(patch=>patch.getSize(new THREE.Vector3()).x<.15),'fine fragments mixed with larger islands');
  }
  const wires = instanceBounds(THREE, byRole(group, 'sagging-wire')[0]);
  assert.ok(Math.min(...wires.map(bounds => bounds.min.y)) < 4.05);assert.ok(Math.max(...wires.map(bounds => bounds.max.y)) > 4.5);
  assert.equal(firstHit(THREE, group, [-1.55, 1.5, -5], [0, 0, 1])?.object.userData.role, 'shop-back-wall', 'finished rear facade');
 } finally {disposeEnvironment(group);}
});

test('shadow opt-in is explicit and never adds lights; luminous and wet accents do not cast shadows', async () => {
 const {createEnvironment, disposeEnvironment, ENVIRONMENT_IDS} = await modulePromise;
 const neverCast = new Set(['ground', 'plinth-lower', 'plinth-bevel', 'plinth-rim', 'sea', 'sea-bed', 'sea-shallows', 'shore-foam', 'wave-crest', 'wave-glint', 'stream', 'stream-bed', 'stream-current', 'interior-light', 'canopy-light', 'lamp-head', 'lantern-glow', 'puddle', 'puddle-ripple', 'wet-reflection']);
 for (const id of ENVIRONMENT_IDS) {
  const group = createEnvironment(id, {shadows: true});
  try {
   assert.equal(group.userData.shadows, true);assert.ok(meshes(group).some(mesh => mesh.castShadow));assert.ok(meshes(group).some(mesh => mesh.receiveShadow));
   for (const mesh of meshes(group)) {
    if (neverCast.has(mesh.userData.role)) assert.equal(mesh.castShadow, false, mesh.userData.role);
    if (['interior-light', 'canopy-light', 'lamp-head', 'lantern-glow', 'wet-reflection'].includes(mesh.userData.role)) assert.equal(mesh.receiveShadow, false);
    if (mesh.userData.role === 'ground') assert.equal(mesh.receiveShadow, true);
   }
   assert.ok(group.children.every(object => !object.isLight));
  } finally {disposeEnvironment(group);}
 }
 for (const value of ['yes', 1, false]) {const group = createEnvironment('studio', {shadows: value});assert.equal(group.userData.shadows, false);assert.ok(meshes(group).every(mesh => !mesh.castShadow && !mesh.receiveShadow));disposeEnvironment(group);}
});

test('sunlight presets remain bounded, distinct, safe copies and usable by avatar lights without sky geometry', async () => {
 const {sunlightConfig, createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, configs = ['morning', 'noon', 'evening'].map(sunlightConfig);
 for (const config of configs) {
  const key = new THREE.DirectionalLight(config.color, config.intensity), ambient = new THREE.HemisphereLight(config.ambientColor, config.groundColor, config.ambient);
  key.position.set(...config.position);
  assert.ok(key.intensity > 0 && key.intensity < 5);assert.ok(ambient.intensity > 0 && ambient.intensity < 3);
  assert.ok(key.position.y > 0);assert.ok(key.color.r >= 0 && key.color.r <= 1);
  const group = createEnvironment('beach', {timeOfDay: config.timeOfDay});
  assert.deepEqual(group.userData.sunlight, config);assert.equal(roleCount(group, 'sky'), 0);disposeEnvironment(group);
 }
 assert.notDeepEqual(configs[0], configs[1]);assert.notDeepEqual(configs[1], configs[2]);
 configs[0].position[0] = 999;configs[0].intensity = 999;
 assert.ok(sunlightConfig('morning').position[0] < 0);assert.ok(sunlightConfig('morning').intensity < 5);
 for (const invalid of ['night', '__proto__', NaN, Infinity, {}, null]) assert.deepEqual(sunlightConfig(invalid), sunlightConfig('noon'));
});

test('numeric daylight remains continuous and updates metadata without recoloring geometry or creating resources', async () => {
 const {sunlightConfig,createEnvironment,updateEnvironmentSunlight,disposeEnvironment}=await modulePromise;
 const midnight=sunlightConfig(0),sunrise=sunlightConfig(7),noon=sunlightConfig(12),sunset=sunlightConfig(18);
 assert.equal(noon.color,sunlightConfig('noon').color);assert.equal(sunrise.color,sunlightConfig('morning').color);assert.equal(sunset.color,sunlightConfig('evening').color);
 assert.notEqual(midnight.color,noon.color);assert.ok(midnight.intensity>0&&midnight.ambient>0,'night retains fill');
 assert.deepEqual(sunlightConfig(24),midnight);assert.deepEqual(sunlightConfig(-1),sunlightConfig(23));
 for(let hour=0;hour<24;hour+=.25){const a=sunlightConfig(hour),c=sunlightConfig(hour+1/60);assert.ok(a.intensity>0&&a.ambient>0&&a.position.every(Number.isFinite));assert.ok(Math.abs(a.intensity-c.intensity)<.02,'brightness cannot jump between minutes');}
 const group=createEnvironment('beach',{timeOfDay:12}),objects=meshes(group),colors=objects.map(mesh=>mesh.material.color.getHexString()),stats={...group.userData.stats};
 try {
  updateEnvironmentSunlight(group,18);assert.deepEqual(group.userData.sunlight,sunset);assert.equal(group.userData.timeOfDay,18);
  assert.deepEqual(meshes(group),objects);assert.deepEqual(objects.map(mesh=>mesh.material.color.getHexString()),colors);assert.deepEqual(group.userData.stats,stats);
  updateEnvironmentSunlight(null,12);
 } finally {disposeEnvironment(group);}
 const {localDaylightHour}=await import('../src/ui/use-local-daylight.mjs');assert.equal(localDaylightHour(new Date(2026,1,1,18,30,0)),18.5);
});

test('solar elevation/hour-angle blending preserves snapshots and smooth twilight with bounded directional light', async () => {
 const {sunlightConfig, createEnvironment, updateEnvironmentSunlight, disposeEnvironment} = await modulePromise;
 const morning={kind:'solar',elevation:8,hourAngle:-70}, evening={kind:'solar',elevation:8,hourAngle:70}, night={kind:'solar',elevation:-30,hourAngle:160}, noon={kind:'solar',elevation:60,hourAngle:0};
 const a=sunlightConfig(morning),c=sunlightConfig(evening),n=sunlightConfig(night),day=sunlightConfig(noon);
 assert.notEqual(a.color,c.color);assert.ok(a.position[0]<0&&c.position[0]>0);assert.ok(day.intensity>n.intensity);
 assert.deepEqual(day.timeOfDay,noon);assert.ok(n.ambient>0&&n.intensity>0);assert.deepEqual(day.position,[0,6.5,3]);
 for(let elevation=-8;elevation<=40;elevation+=.25){const x=sunlightConfig({kind:'solar',elevation,hourAngle:50}),y=sunlightConfig({kind:'solar',elevation:elevation+.01,hourAngle:50});assert.ok(Math.abs(x.intensity-y.intensity)<.01);assert.ok(x.position.every(Number.isFinite));}
 for(const value of [{kind:'solar',elevation:91,hourAngle:0},{kind:'solar',elevation:10,hourAngle:181},{kind:'solar',elevation:NaN,hourAngle:0},{kind:'solar',elevation:10}]) assert.deepEqual(sunlightConfig(value),sunlightConfig('noon'));
 const group=createEnvironment('studio',{timeOfDay:morning});
 try {assert.deepEqual(group.userData.timeOfDay,morning);assert.deepEqual(group.userData.sunlight,a);updateEnvironmentSunlight(group,evening);assert.deepEqual(group.userData.timeOfDay,evening);assert.deepEqual(group.userData.sunlight,c);assert.equal(roleCount(group,'sky'),0);} finally {disposeEnvironment(group);}
});

test('dispose releases every owned instance buffer, geometry and material exactly once without touching foreign models', async () => {
 const {createEnvironment, disposeEnvironment, ENVIRONMENT_IDS} = await modulePromise;
 const THREE = await threePromise;
 for (const id of ENVIRONMENT_IDS) {
  const scene = new THREE.Scene(), group = createEnvironment(id), sibling = createEnvironment('beach');
  const resources = resourceSets(group), siblingResources = resourceSets(sibling);scene.add(group,sibling);
  const foreign = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());group.add(foreign);
  const events = new Map();
  for(const item of [...resources.objects,...resources.geometries,...resources.materials,...siblingResources.objects,...siblingResources.geometries,...siblingResources.materials,foreign.geometry,foreign.material]){events.set(item,0);item.addEventListener('dispose',()=>events.set(item,events.get(item)+1));}
  assert.equal(disposeEnvironment(group),true);assert.equal(group.parent,null);
  for(const item of [...resources.objects,...resources.geometries,...resources.materials]) assert.equal(events.get(item),1);
  for(const item of [...siblingResources.objects,...siblingResources.geometries,...siblingResources.materials,foreign.geometry,foreign.material]) assert.equal(events.get(item),0);
  assert.deepEqual(group.children,[foreign]);assert.equal(sibling.parent,scene);
  assert.equal(disposeEnvironment(group),false);assert.equal(disposeEnvironment(new THREE.Group()),false);assert.equal(disposeEnvironment(null),false);
  for(const item of [...resources.objects,...resources.geometries,...resources.materials]) assert.equal(events.get(item),1);
  disposeEnvironment(sibling);foreign.geometry.dispose();foreign.material.dispose();
 }
});

test('repeated scene changes detach old geometry without cumulative live GPU resources', async () => {
 const {createEnvironment, disposeEnvironment, ENVIRONMENT_IDS} = await modulePromise;
 const THREE = await threePromise, scene = new THREE.Scene();let live=0,previous;
 for(let i=0;i<40;i++){
  const next=createEnvironment(ENVIRONMENT_IDS[i%ENVIRONMENT_IDS.length]),resources=resourceSets(next);
  for(const item of [...resources.objects,...resources.geometries,...resources.materials]){live++;item.addEventListener('dispose',()=>live--);}
  if(previous)disposeEnvironment(previous);scene.add(next);previous=next;
  assert.equal(scene.children.length,1);assert.equal(live,resources.objects.length+resources.geometries.size+resources.materials.size);
 }
 disposeEnvironment(previous);assert.equal(live,0);assert.equal(scene.children.length,0);
});

test('unknown IDs and null options fall back to a real furnished studio safely', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 for(const id of ['missing','__proto__',null,undefined]){const group=createEnvironment(id,null);assert.equal(group.userData.environmentId,'studio');assert.ok(group.getObjectByName('studio:tatami'));assert.ok(group.getObjectByName('studio:low-table'));disposeEnvironment(group);}
});
