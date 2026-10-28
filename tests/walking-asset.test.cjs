// Portable, real-asset CPU regression tests. No image decoding, WebGL, network,
// private profile or provider inference. A CPU pass is not a native visual pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const catalog = require('../resources/character-models.json');
const WALK_ID = 'yukino-07-walk14-preview';
const WALK_SHA = '44cdaf1b970662e0a1c3aac1545e515047bf1cfb6bed0ac83b4d2c8b16a88866';
const WIDTHS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};
const TYPES = {5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4]};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function entry(id) {
  const value = catalog.models.find(model => model.id === id);
  assert.ok(value, 'Expected separately registered model: ' + id);
  return value;
}
function load(id) {
  const model = entry(id), file = path.join(root, 'public', model.url.slice(2)), bytes = fs.readFileSync(file);
  assert.equal(bytes.length, model.bytes, id + ' byte length');
  assert.equal(sha(bytes), model.sha256, id + ' digest');
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  let json, bin;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(chunk.length, length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) bin = chunk;
    offset += length + 8;
  }
  assert.ok(json && bin);
  return {model, bytes, json, bin};
}
function viewBytes(asset, viewIndex, count, itemBytes, localOffset = 0) {
  const view = asset.json.bufferViews[viewIndex];
  assert.equal(view.buffer || 0, 0, 'Embedded BIN only');
  const stride = view.byteStride || itemBytes, out = Buffer.alloc(count * itemBytes);
  assert.ok(stride >= itemBytes);
  for (let index = 0; index < count; index++) {
    const offset = (view.byteOffset || 0) + localOffset + index * stride;
    assert.ok(offset + itemBytes <= (view.byteOffset || 0) + view.byteLength);
    asset.bin.copy(out, index * itemBytes, offset, offset + itemBytes);
  }
  return out;
}
function accessor(asset, index) {
  const item = asset.json.accessors[index], type = TYPES[item.componentType], width = WIDTHS[item.type];
  assert.ok(type && width, 'Supported authored accessor');
  const itemBytes = type[1] * width;
  const bytes = item.bufferView === undefined ? Buffer.alloc(item.count * itemBytes) : viewBytes(asset, item.bufferView, item.count, itemBytes, item.byteOffset || 0);
  if (item.sparse) {
    const {count, indices, values} = item.sparse, [read, stride] = TYPES[indices.componentType];
    const indexBytes = viewBytes(asset, indices.bufferView, count, stride, indices.byteOffset || 0);
    const indexView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
    const valueBytes = viewBytes(asset, values.bufferView, count, itemBytes, values.byteOffset || 0);
    for (let n = 0; n < count; n++) {
      const offset = indexView[read](n * stride, true);
      assert.ok(offset < item.count);
      valueBytes.copy(bytes, offset * itemBytes, n * itemBytes, (n + 1) * itemBytes);
    }
  }
  return {componentType: item.componentType, type: item.type, count: item.count, normalized: !!item.normalized, bytes};
}
function numbers(asset, index) {
  const value = accessor(asset, index), [read, stride] = TYPES[value.componentType];
  const view = new DataView(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength);
  return Array.from({length: value.bytes.length / stride}, (_, n) => view[read](n * stride, true));
}
function channelName(asset, channel) { return asset.json.nodes[channel.target.node].name + ':' + channel.target.path; }
function compareAccessor(before, beforeIndex, after, afterIndex, label) {
  assert.deepEqual(accessor(after, afterIndex), accessor(before, beforeIndex), label);
}

test('walking is a distinct digest-pinned review variant, never silently replacing stable school or other outfits', () => {
  const walk = entry(WALK_ID), stable = entry('yukino-07-v1'), micro = entry('yukino-07-micro13-preview');
  assert.equal(walk.sha256, WALK_SHA);
  assert.equal(walk.bytes, 10175144);
  assert.equal(walk.outfitGroup, stable.outfitGroup);
  assert.equal(walk.defaultClip, 'Idle_Breathe');
  assert.equal(walk.bundled, true);
  assert.equal(walk.blink, false);
  assert.match(walk.label, /预览|审阅|评审/);
  assert.equal(stable.sha256, '35ee6553bc0023053cd40b830eb9603d8107904531c4014f79433ff3f8013ae5');
  assert.equal(micro.sha256, 'e070bc7baf5326447df0023769cabda61d20f69781bd15bc39a557807b5142b4');
  assert.equal(Object.keys(stable.clips).length, 8);
  assert.equal(Object.keys(micro.clips).length, 13);
  assert.equal(Object.keys(walk.clips).length, 14);
  assert.deepEqual(catalog.models.filter(model => model.walking).map(model => model.id), [WALK_ID, 'yukino-07-dialogue19-preview', 'yukino-07-garment-normal-v1']);
  assert.equal(walk.thumbnail, stable.thumbnail, 'Same physical outfit, not an eighth distinct outfit');
});

test('V6 preserves actual mesh, morph, index, material and image payloads across repacked buffer offsets', () => {
  const before = load('yukino-07-micro13-preview'), after = load(WALK_ID);
  assert.equal(before.json.meshes.length, 2);
  assert.equal(after.json.meshes.length, 2);
  assert.deepEqual(after.json.materials, before.json.materials);
  assert.deepEqual(after.json.textures, before.json.textures);
  assert.deepEqual(after.json.samplers, before.json.samplers);
  let arrays = 0;
  before.json.meshes.forEach((mesh, i) => {
    const next = after.json.meshes[i];
    assert.equal(next.name, mesh.name);
    assert.deepEqual(next.extras, mesh.extras);
    assert.deepEqual(next.weights, mesh.weights);
    assert.equal(next.primitives.length, mesh.primitives.length);
    mesh.primitives.forEach((primitive, p) => {
      const replacement = next.primitives[p];
      assert.equal(replacement.mode ?? 4, primitive.mode ?? 4);
      assert.equal(replacement.material, primitive.material);
      compareAccessor(before, primitive.indices, after, replacement.indices, 'indices');
      assert.deepEqual(Object.keys(replacement.attributes).sort(), Object.keys(primitive.attributes).sort());
      for (const key of Object.keys(primitive.attributes)) { compareAccessor(before, primitive.attributes[key], after, replacement.attributes[key], key); arrays++; }
      assert.equal(replacement.targets.length, primitive.targets.length);
      primitive.targets.forEach((target, t) => {
        assert.deepEqual(Object.keys(replacement.targets[t]).sort(), Object.keys(target).sort());
        for (const key of Object.keys(target)) { compareAccessor(before, target[key], after, replacement.targets[t][key], 'morph ' + key); arrays++; }
      });
    });
  });
  assert.equal(arrays, 293);
  assert.equal(after.json.images.length, before.json.images.length);
  before.json.images.forEach((image, i) => {
    const next = after.json.images[i], oldView = before.json.bufferViews[image.bufferView], newView = after.json.bufferViews[next.bufferView];
    assert.equal(next.mimeType, image.mimeType);
    assert.equal(newView.byteLength, oldView.byteLength);
    assert.deepEqual(viewBytes(after, next.bufferView, 1, newView.byteLength), viewBytes(before, image.bufferView, 1, oldView.byteLength));
  });
});

test('all original 13 clips and 55-joint bind data remain exact in the walking asset', () => {
  const before = load('yukino-07-micro13-preview'), after = load(WALK_ID);
  assert.equal(before.json.animations.length, 13);
  assert.equal(after.json.animations.length, 14);
  const newClips = new Map(after.json.animations.map(clip => [clip.name, clip]));
  assert.equal(newClips.size, 14);
  let count = 0;
  for (const clip of before.json.animations) {
    const next = newClips.get(clip.name);
    assert.ok(next, clip.name);
    assert.equal(next.channels.length, clip.channels.length);
    clip.channels.forEach((channel, i) => {
      const replacement = next.channels[i];
      assert.equal(channelName(after, replacement), channelName(before, channel));
      const sampler = clip.samplers[channel.sampler], newSampler = next.samplers[replacement.sampler];
      assert.equal(newSampler.interpolation || 'LINEAR', sampler.interpolation || 'LINEAR');
      for (const side of ['input', 'output']) compareAccessor(before, sampler[side], after, newSampler[side], clip.name + ' ' + side);
      count++;
    });
  }
  assert.equal(count, 2145);
  assert.equal(after.json.skins.length, 1);
  assert.equal(after.json.skins[0].joints.length, 55);
  assert.deepEqual(after.json.skins[0].joints.map(i => after.json.nodes[i].name), before.json.skins[0].joints.map(i => before.json.nodes[i].name));
  const restPose = asset => asset.json.skins[0].joints.map(i => {
    const node = asset.json.nodes[i];
    return {name: node.name, translation: node.translation, rotation: node.rotation, scale: node.scale, matrix: node.matrix, children: (node.children || []).map(child => asset.json.nodes[child].name)};
  });
  assert.deepEqual(restPose(after), restPose(before), 'Authored rest transforms and joint hierarchy');
  compareAccessor(before, before.json.skins[0].inverseBindMatrices, after, after.json.skins[0].inverseBindMatrices, 'bind matrices');
});

test('genuine gait has finite continuous loop keys and retained periodic Root translation, not net drift', () => {
  const asset = load(WALK_ID), clip = asset.json.animations.find(value => value.name === 'Walk_Slow_Loop');
  assert.ok(clip);
  assert.equal(clip.channels.length, 165);
  let rootTranslation = null, varyingTracks = 0, constantTracks = 0;
  for (const channel of clip.channels) {
    const sampler = clip.samplers[channel.sampler], times = numbers(asset, sampler.input), values = numbers(asset, sampler.output), width = WIDTHS[asset.json.accessors[sampler.output].type];
    assert.ok(times.length === 2 || times.length === 45, 'Exporter preserves 45 varying keys or two constant endpoints');
    if (times.length === 45) varyingTracks++; else constantTracks++;
    assert.equal(times[0], 0);
    assert.ok(Math.abs(times.at(-1) - 44 / 30) < 1e-6);
    assert.ok(times.every((time, i) => Number.isFinite(time) && (!i || time > times[i - 1])));
    assert.ok(values.every(Number.isFinite));
    for (let n = 0; n < width; n++) assert.ok(Math.abs(values[n] - values[values.length - width + n]) < 1e-7, channelName(asset, channel) + ' loop endpoint');
    if (channel.target.path === 'rotation') for (let n = 0; n < values.length; n += 4) {
      const q = values.slice(n, n + 4);
      assert.ok(Math.abs(Math.hypot(...q) - 1) < 2e-6, 'Unit quaternion');
      if (n) assert.ok(q.reduce((sum, value, c) => sum + value * values[n - 4 + c], 0) > .99, 'No quaternion sign jump');
    }
    if (channelName(asset, channel) === 'Root:translation') { assert.equal(times.length, 45); rootTranslation = values; }
  }
  assert.ok(rootTranslation, 'Authored periodic Root track must not be removed');
  assert.ok(rootTranslation.some((value, i) => Math.abs(value - rootTranslation[i % 3]) > .001), 'Genuine periodic bob/sway exists');
  assert.equal(varyingTracks, 22);
  assert.equal(constantTracks, 143);
});

test('runtime walking metadata binds stride, duration, facing and conservative floor offset to V6', () => {
  const model = entry(WALK_ID), walk = model.walking;
  assert.ok(walk);
  assert.equal(walk.clip, 'Walk_Slow_Loop');
  assert.equal(walk.durationSeconds, 44 / 30);
  assert.equal(walk.strideModelUnits, .8342623859709787);
  assert.equal(walk.speedModelUnitsPerSecond, .5688152631620309);
  assert.ok(Math.abs(walk.strideModelUnits / walk.durationSeconds - walk.speedModelUnitsPerSecond) < 1e-12);
  assert.deepEqual(walk.forwardAxis, [.02847926409821225, 0, .999594383495838]);
  assert.ok(Math.abs(Math.hypot(...walk.forwardAxis) - 1) < 1e-12);
  assert.equal(walk.sourceHeight, 1.0004711474757642);
  assert.equal(walk.floorOffsetModelUnits, .00067);
  assert.ok(-.0006639419589191675 + walk.floorOffsetModelUnits > 0);
  assert.deepEqual(walk.contactAnchors, [.6166666666666667, 1.2666666666666666]);
  assert.equal(model.clips[walk.clip].loop, true);
  assert.ok(Math.abs(model.clips[walk.clip].duration - walk.durationSeconds) < 1e-6);
});

test('actual Three CPU mixer preserves gait Root bob and reaches the same loop pose without texture/GPU execution', async () => {
  const asset = load(WALK_ID), THREE = await import('three'), {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader().register(() => ({name: 'CPU_QA_TEXTURE_PLACEHOLDER', loadTexture: () => Promise.resolve(new THREE.Texture())}));
  const gltf = await loader.parseAsync(asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength), '');
  const mixer = new THREE.AnimationMixer(gltf.scene), clip = gltf.animations.find(value => value.name === 'Walk_Slow_Loop'), authoredRoot = gltf.scene.getObjectByName('Root');
  assert.ok(clip && authoredRoot);
  const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  mixer.setTime(0); const start = authoredRoot.position.clone();
  mixer.setTime(.4); assert.ok(authoredRoot.position.distanceTo(start) > .001);
  mixer.setTime(clip.duration); assert.ok(authoredRoot.position.distanceTo(start) < 1e-7);
  const meshes = []; gltf.scene.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
  assert.equal(meshes.length, asset.json.meshes.reduce((count, mesh) => count + mesh.primitives.length, 0), 'GLTFLoader splits each authored primitive into a single-material mesh');
  for (const mesh of meshes) assert.equal(mesh.skeleton.bones.length, 55);
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  const geometries = new Set(), materials = new Set(), textures = new Set();
  gltf.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); for (const material of [object.material].flat().filter(Boolean)) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); } });
  for (const value of [...geometries, ...materials, ...textures]) value.dispose();
});

test('optional dialogue19 preserves all original14 clips and carries only five reviewed fixed-root actions',()=>{
 const before=load(WALK_ID),after=load('yukino-07-dialogue19-preview'),contract=require('../resources/character-dialogue07-v1.json');
 assert.equal(after.model.sha256,'0ce5fb17fb3150e3a812e71200ed47341050669b562cf0c457c4c22c80bbe1f9');assert.equal(after.model.sha256,contract.sha256);assert.equal(after.json.animations.length,19);assert.equal(after.model.outfitGroup,'yukino-07');assert.equal(after.model.blink,false);
 const clips=new Map(after.json.animations.map(clip=>[clip.name,clip]));let unchanged=0;
 for(const clip of before.json.animations){const next=clips.get(clip.name);assert.equal(next.channels.length,clip.channels.length);clip.channels.forEach((channel,i)=>{const replacement=next.channels[i];assert.equal(channelName(after,replacement),channelName(before,channel));const old=clip.samplers[channel.sampler],value=next.samplers[replacement.sampler];for(const side of ['input','output'])compareAccessor(before,old[side],after,value[side],clip.name);unchanged++})}
 assert.equal(unchanged,2310);assert.deepEqual(after.json.materials,before.json.materials);assert.deepEqual(after.json.textures,before.json.textures);compareAccessor(before,before.json.skins[0].inverseBindMatrices,after,after.json.skins[0].inverseBindMatrices,'bind');
 for(let m=0;m<before.json.meshes.length;m++){const mesh=before.json.meshes[m],next=after.json.meshes[m];assert.deepEqual(next.weights,mesh.weights);assert.deepEqual(next.extras,mesh.extras);for(let p=0;p<mesh.primitives.length;p++){const a=mesh.primitives[p],b=next.primitives[p];compareAccessor(before,a.indices,after,b.indices,'indices');assert.deepEqual(Object.keys(b.attributes),Object.keys(a.attributes));for(const k of Object.keys(a.attributes))compareAccessor(before,a.attributes[k],after,b.attributes[k],k);assert.equal(b.targets.length,a.targets.length);for(let i=0;i<a.targets.length;i++)for(const k of Object.keys(a.targets[i]))compareAccessor(before,a.targets[i][k],after,b.targets[i][k],'morph');}}
 before.json.images.forEach((image,i)=>{const next=after.json.images[i],av=before.json.bufferViews[image.bufferView],bv=after.json.bufferViews[next.bufferView];assert.equal(bv.byteLength,av.byteLength);assert.deepEqual(viewBytes(after,next.bufferView,1,bv.byteLength),viewBytes(before,image.bufferView,1,av.byteLength));});
 for(const item of contract.clips.filter(c=>c.newInThisVariant)){const entry=after.model.clips[item.name],clip=clips.get(item.name);assert.ok(clip);assert.equal(entry.autonomous,false,'semantic clips cannot enter random idle scheduler');assert.equal(entry.loop,false);assert.equal(entry.maxSpeechWeight,.4);assert.deepEqual(entry.conflictGroups,['body_action','neck_head_follow','walk','skin_transition']);
  for(const channel of clip.channels){assert.notEqual(channel.target.path,'weights');const sampler=clip.samplers[channel.sampler],values=numbers(after,sampler.output),width=WIDTHS[after.json.accessors[sampler.output].type];for(let n=0;n<width;n++)assert.ok(Math.abs(values[n]-values[values.length-width+n])<1e-6,item.name+' returns to Idle');const name=after.json.nodes[channel.target.node].name;if(/^(Root|J_Bip_C_Hips)$|J_Bip_[LR]_(UpperLeg|LowerLeg|Foot|ToeBase)/.test(name))for(let n=width;n<values.length;n++)assert.ok(Math.abs(values[n]-values[n%width])<1e-7,item.name+' fixed legs/root');}
 }
 assert.deepEqual(Object.keys(after.model.clips).filter(name=>after.model.clips[name].speechEligible),['Speak_PhraseCadence','Clarify_LowHand']);
});
