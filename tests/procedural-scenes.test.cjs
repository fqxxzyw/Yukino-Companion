const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../src/ui/procedural-scenes.mjs');
const threePromise = import('three');

function meshes(group) {const result = [];group.traverse(object => {if (object.isMesh) result.push(object);});return result;}
function resourceSets(group) {
 const objects = meshes(group);
 return {objects, geometries: new Set(objects.map(mesh => mesh.geometry)), materials: new Set(objects.map(mesh => mesh.material))};
}

test('all environments are deterministic, texture-free real geometry within fixed CPU/draw budgets', async () => {
 const {createEnvironment, disposeEnvironment, ENVIRONMENT_IDS, ENVIRONMENT_BUDGET} = await modulePromise;
 const THREE = await threePromise;
 for (const id of ENVIRONMENT_IDS) {
  const group = createEnvironment(id), again = createEnvironment(id);
  assert.ok(group instanceof THREE.Group);assert.equal(group.userData.environmentId, id);
  assert.equal(group.userData.floorY, 0);assert.equal(group.userData.characterHeight, 2);
  const stats = group.userData.stats;
  assert.ok(stats.drawCalls > 0 && stats.drawCalls <= ENVIRONMENT_BUDGET.drawCalls, `${id}: draw calls`);
  assert.ok(stats.triangles > 0 && stats.triangles <= ENVIRONMENT_BUDGET.triangles, `${id}: triangles`);
  assert.ok(stats.instances > 0 && stats.instances <= ENVIRONMENT_BUDGET.instances, `${id}: instances`);
  assert.deepEqual(stats, again.userData.stats);
  let computedTriangles = 0, instances = 0;
  for (const [index, mesh] of meshes(group).entries()) {
   assert.ok(mesh.isInstancedMesh);assert.ok(mesh.geometry.isBufferGeometry);
   assert.ok(mesh.geometry.attributes.normal.count > 0);
   for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok([...attribute.array].every(Number.isFinite));
   assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
   assert.deepEqual(mesh.instanceMatrix.array, meshes(again)[index].instanceMatrix.array);
   assert.notEqual(mesh.geometry, meshes(again)[index].geometry, 'each factory call owns independent resources');
   for (const value of Object.values(mesh.material)) assert.ok(!value?.isTexture, 'no network/texture-backed decoration');
   computedTriangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3 * mesh.count;
   instances += mesh.count;
   assert.ok(mesh.boundingBox && mesh.boundingSphere);assert.equal(mesh.castShadow, false);assert.equal(mesh.receiveShadow, false);
   const matrix = new THREE.Matrix4();
   for (let i = 0; i < mesh.count; i++) {mesh.getMatrixAt(i, matrix);assert.ok(matrix.determinant() > 0, 'nondegenerate positive-size instance');}
  }
  assert.equal(computedTriangles, stats.triangles);assert.equal(instances, stats.instances);
  const bounds = new THREE.Box3().setFromObject(group);
  assert.ok(!bounds.isEmpty());assert.ok([...bounds.min, ...bounds.max].every(Number.isFinite));
  assert.ok(bounds.max.x - bounds.min.x >= 10);assert.ok(bounds.max.z - bounds.min.z >= 10);
  disposeEnvironment(group);disposeEnvironment(again);
 }
});

test('classroom contains six dimensional desks/chairs, board and two actual framed window openings', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, group = createEnvironment('classroom');
 const byRole = role => meshes(group).find(mesh => mesh.userData.role === role);
 assert.equal(byRole('desk-top').count, 6);assert.equal(byRole('desk-legs').count, 24);
 assert.equal(byRole('chair-seat').count, 6);assert.equal(byRole('chair-back').count, 6);
 assert.equal(byRole('board').count, 1);assert.equal(byRole('window-glazing').count, 2);
 assert.equal(byRole('window-frame').count, 12);assert.equal(byRole('chalk-marks').count, 3);
 // A ray through the interior of each aperture meets glazing, not the wall.
 for (const x of [-2.85, 2.85]) {
  const hits = new THREE.Raycaster(new THREE.Vector3(x, 2.6, -6.5), new THREE.Vector3(0, 0, -1)).intersectObjects(group.children);
  assert.equal(hits[0]?.object.userData.role, 'window-glazing');
 }
 const top = byRole('desk-top').boundingBox;
 assert.ok(top.max.y > .85 && top.min.y < .85);assert.ok(top.min.z < top.max.z);
 disposeEnvironment(group);
});

test('beach sand, sea, horizon and wave relief occupy separate actual spatial surfaces', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, group = createEnvironment('beach');
 const byRole = role => meshes(group).find(mesh => mesh.userData.role === role);
 for (const role of ['ground', 'water', 'horizon-water', 'water-crest', 'palm-trunk', 'palm-leaf', 'dune', 'shore-stone']) assert.ok(byRole(role), role);
 const sand = byRole('ground').boundingBox, sea = byRole('water').boundingBox, horizon = byRole('horizon-water').boundingBox;
 assert.ok(Math.abs(sand.min.z - sea.max.z) < 1e-5, 'shoreline has no geometric gap');
 assert.ok(Math.abs(sea.min.z - horizon.max.z) < 1e-5, 'sea joins horizon');
 assert.ok(sea.max.y < sand.max.y, 'water does not cover character floor');
 for (const [z, expected] of [[0, 'ground'], [-11, 'water'], [-35, 'horizon-water']]) {
  const hits = new THREE.Raycaster(new THREE.Vector3(0, 2, z), new THREE.Vector3(0, -1, 0)).intersectObjects(group.children);
  assert.equal(hits[0]?.object.userData.role, expected);
 }
 disposeEnvironment(group);
});

test('all scenes keep a clear foreground around the two-unit character and floor exactly at zero', async () => {
 const {createEnvironment, disposeEnvironment, ENVIRONMENT_IDS} = await modulePromise;
 const THREE = await threePromise;
 for (const id of ENVIRONMENT_IDS) {
  const group = createEnvironment(id);
  const floorHits = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0)).intersectObjects(group.children);
  assert.ok(floorHits.length);assert.ok(Math.abs(floorHits[0].point.y) < 1e-6, `${id}: floor y=0`);
  for (const mesh of meshes(group)) if (mesh.boundingBox.max.y > .001) assert.ok(mesh.boundingBox.max.z <= -1.25, `${id}/${mesh.userData.role}: raised object in foreground`);
  const camera = new THREE.Vector3(0, 1, 5);
  for (const x of [-.6, 0, .6]) for (const y of [.1, 1, 1.95]) {
   const target = new THREE.Vector3(x, y, 0), direction = target.clone().sub(camera).normalize();
   const ray = new THREE.Raycaster(camera, direction, 0, camera.distanceTo(target));
   assert.deepEqual(ray.intersectObjects(group.children), [], `${id}: scene cannot obscure character at ${x},${y}`);
  }
  disposeEnvironment(group);
 }
});

test('portrait-camera rays can see classroom windows/board and beach sea/horizon, not just offscreen props', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, camera = new THREE.PerspectiveCamera(30, .6, .01, 100);
 camera.position.set(0, 1, 5);camera.lookAt(0, 1, 0);camera.updateMatrixWorld(true);
 for (const [id, points] of [
  ['classroom', [[[-1.9, 2.6, -7.62], 'window-glazing'], [[1.9, 2.6, -7.62], 'window-glazing'], [[0, 2.46, -7.3], 'board']]],
  ['beach', [[[0, 0, -3], 'ground'], [[0, -.02, -15], 'water'], [[0, -.02, -35], 'horizon-water']]]
 ]) {
  const group = createEnvironment(id);
  for (const [point, role] of points) {
   const ndc = new THREE.Vector3(...point).project(camera);
   assert.ok(Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && Math.abs(ndc.z) < 1, `${id}/${role} in portrait frustum`);
   const ray = new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
   const hits = ray.intersectObjects(group.children);
   assert.equal(hits[0]?.object.userData.role, role, `${id}/${role} visible along camera ray`);
  }
  disposeEnvironment(group);
 }
});

test('forest and city have recognizable solid geometry, not alternate background gradients', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const forest = createEnvironment('forest'), city = createEnvironment('city');
 const roleCount = (group, role) => meshes(group).find(mesh => mesh.userData.role === role)?.count || 0;
 assert.equal(roleCount(forest, 'tree-trunk'), 8);assert.equal(roleCount(forest, 'tree-crown'), 8);assert.equal(roleCount(forest, 'fern'), 4);
 assert.equal(roleCount(city, 'building'), 5);assert.ok(roleCount(city, 'building-window') >= 80);
 assert.equal(roleCount(city, 'bench-seat'), 2);assert.equal(roleCount(city, 'street-lamp'), 2);
 disposeEnvironment(forest);disposeEnvironment(city);
});

test('shadow opt-in is explicit; sky/glazing never cast or receive and ground only receives', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 for (const id of ['classroom', 'beach']) {
  const group = createEnvironment(id, {shadows: true});
  assert.equal(group.userData.shadows, true);
  assert.ok(meshes(group).some(mesh => mesh.castShadow));
  for (const mesh of meshes(group)) {
   if (['sky', 'window-glazing'].includes(mesh.userData.role)) {assert.equal(mesh.castShadow, false);assert.equal(mesh.receiveShadow, false);}
   if (mesh.userData.role === 'ground') {assert.equal(mesh.castShadow, false);assert.equal(mesh.receiveShadow, true);}
  }
  disposeEnvironment(group);
 }
 const group = createEnvironment('studio', {shadows: 'yes'});assert.equal(group.userData.shadows, false);disposeEnvironment(group);
});

test('sunlight presets are bounded, distinct, safe copies and can drive real Three lights', async () => {
 const {sunlightConfig, createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, configs = ['morning', 'noon', 'evening'].map(sunlightConfig);
 for (const config of configs) {
  const key = new THREE.DirectionalLight(config.color, config.intensity);
  const ambient = new THREE.HemisphereLight(config.ambientColor, config.groundColor, config.ambient);
  key.position.set(...config.position);
  assert.ok(key.intensity > 0 && key.intensity < 5);assert.ok(ambient.intensity > 0 && ambient.intensity < 3);
  assert.ok(key.position.y > 0);assert.ok(key.color.r >= 0 && key.color.r <= 1);
  const group = createEnvironment('beach', {timeOfDay: config.timeOfDay});
  const sky = meshes(group).find(mesh => mesh.userData.role === 'sky');
  assert.equal(sky.material.color.getHexString(), new THREE.Color(config.skyColor).getHexString());
  disposeEnvironment(group);
 }
 assert.notDeepEqual(configs[0], configs[1]);assert.notDeepEqual(configs[1], configs[2]);
 configs[0].position[0] = 999;configs[0].intensity = 999;
 assert.ok(sunlightConfig('morning').position[0] < 0);assert.ok(sunlightConfig('morning').intensity < 5);
 assert.deepEqual(sunlightConfig('night'), sunlightConfig('noon'));assert.deepEqual(sunlightConfig('__proto__'), sunlightConfig('noon'));
});

test('dispose releases every owned instance buffer, geometry and material exactly once, without touching models', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 const THREE = await threePromise, scene = new THREE.Scene(), group = createEnvironment('classroom'), sibling = createEnvironment('beach');
 const resources = resourceSets(group), siblingResources = resourceSets(sibling);
 scene.add(group, sibling);
 const foreign = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());group.add(foreign);
 const events = new Map();
 for (const item of [...resources.objects, ...resources.geometries, ...resources.materials, ...siblingResources.objects, ...siblingResources.geometries, ...siblingResources.materials, foreign.geometry, foreign.material]) {
  events.set(item, 0);item.addEventListener('dispose', () => events.set(item, events.get(item) + 1));
 }
 assert.equal(disposeEnvironment(group), true);assert.equal(group.parent, null);
 for (const item of [...resources.objects, ...resources.geometries, ...resources.materials]) assert.equal(events.get(item), 1);
 for (const item of [...siblingResources.objects, ...siblingResources.geometries, ...siblingResources.materials, foreign.geometry, foreign.material]) assert.equal(events.get(item), 0);
 assert.deepEqual(group.children, [foreign]);assert.equal(sibling.parent, scene);
 assert.equal(disposeEnvironment(group), false);assert.equal(disposeEnvironment(new THREE.Group()), false);assert.equal(disposeEnvironment(null), false);
 for (const item of [...resources.objects, ...resources.geometries, ...resources.materials]) assert.equal(events.get(item), 1);
 disposeEnvironment(sibling);foreign.geometry.dispose();foreign.material.dispose();
});

test('repeated scene changes detach old geometry and dispose independent resources without cumulative live objects', async () => {
 const {createEnvironment, disposeEnvironment, ENVIRONMENT_IDS} = await modulePromise;
 const THREE = await threePromise, scene = new THREE.Scene();
 let live = 0, previous;
 for (let i = 0; i < 40; i++) {
  const next = createEnvironment(ENVIRONMENT_IDS[i % ENVIRONMENT_IDS.length]);
  const resources = resourceSets(next);
  for (const item of [...resources.objects, ...resources.geometries, ...resources.materials]) {live++;item.addEventListener('dispose', () => live--);}
  if (previous) disposeEnvironment(previous);
  scene.add(next);previous = next;
  assert.equal(scene.children.length, 1);assert.equal(live, resources.objects.length + resources.geometries.size + resources.materials.size);
 }
 disposeEnvironment(previous);assert.equal(live, 0);assert.equal(scene.children.length, 0);
});

test('unknown scene IDs and null options fall back to the real studio safely', async () => {
 const {createEnvironment, disposeEnvironment} = await modulePromise;
 for (const id of ['missing', '__proto__', null, undefined]) {
  const group = createEnvironment(id, null);assert.equal(group.userData.environmentId, 'studio');
  assert.ok(group.getObjectByName('studio:studio-backdrop'));disposeEnvironment(group);
 }
});
