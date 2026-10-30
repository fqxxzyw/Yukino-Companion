const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const modules = Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js'), import('../src/ui/eight-weight-skinning.mjs'), import('./helpers/eight-weight-fixture.mjs')]);
async function setup(options) {
  const [THREE, {GLTFLoader}, api, fixture] = await modules;
  const f = fixture.createEightWeightFixture(options);
  const inspection = api.inspectGlbSkinning(f.json, f.bytes);
  const gltf = await new GLTFLoader().parseAsync(f.bytes, '');
  return {THREE, api, f, inspection, gltf};
}
function assertClose(actual, expected, epsilon = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < epsilon, `${i}: ${value} != ${expected[i]}`));
}
function reference(THREE, mesh, record, index, value, direction = false) {
  const base = new THREE.Vector4(value.x, value.y, value.z, direction ? 0 : 1).applyMatrix4(mesh.bindMatrix);
  const out = new THREE.Vector4(0, 0, 0, 0);
  for (const [j, w] of [[record.joints0, record.weights0], [record.joints1, record.weights1]]) for (let c = 0; c < 4; c++) {
    const k = index * 4 + c, bone = j[k], matrix = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.bones[bone].matrixWorld, mesh.skeleton.boneInverses[bone]);
    out.addScaledVector(base.clone().applyMatrix4(matrix), w[k]);
  }
  return out.applyMatrix4(mesh.bindMatrixInverse);
}
test('GLTFLoader normalization is repaired and 8 weights remain nonzero on body + outline', async () => {
  const {gltf, api, inspection} = await setup();
  assert.equal(inspection.maxInfluences, 8); assert.equal(inspection.verticesWithExtraWeights, 3);
  const main = gltf.scene.getObjectByName('Main'), outline = gltf.scene.getObjectByName('Outline'), four = gltf.scene.getObjectByName('Four');
  assert.equal(main.geometry.getAttribute('skinWeight').getX(0), .25); // Loader normalized 0.5 to 1.
  const originalFour = {geometry: four.geometry, material: four.material, apply: four.applyBoneTransform};
  const originalGeometry = main.geometry, originalMorph = [...main.morphTargetInfluences];
  const result = api.applyEightWeightSkinning(gltf, inspection);
  assert.equal(result.meshes, 2);
  for (const mesh of [main, outline]) {
    assert.equal(mesh.geometry.getAttribute('skinWeight').getX(0), .125);
    assert.equal(mesh.geometry.getAttribute('skinWeight1').getW(0), .125);
    assert.equal(mesh.geometry.getAttribute('skinIndex1').getW(0), 7);
    assert.ok(mesh.customDepthMaterial.isMeshDepthMaterial); assert.ok(mesh.customDistanceMaterial.isMeshDistanceMaterial);
    assert.deepEqual(mesh.morphTargetInfluences, originalMorph);
  }
  assert.notEqual(main.geometry, originalGeometry);
  assert.equal(four.geometry, originalFour.geometry); assert.equal(four.material, originalFour.material); assert.equal(four.applyBoneTransform, originalFour.apply);
  assert.equal(four.material.customProgramCacheKey().includes('eight-weight'), false);
  assert.equal(api.applyEightWeightSkinning(gltf, inspection).meshes, 2);
});
test('a vertex weighted only by JOINTS_1 is restored after loader zero-sum fallback', async () => {
  const [, {GLTFLoader}, api, fixture] = await modules;
  const f=fixture.createEightWeightFixture();
  for(const [index,value] of [[f.indices.w0,0],[f.indices.w1,.25]]){
    const accessor=f.json.accessors[index],offset=f.json.bufferViews[accessor.bufferView].byteOffset;
    for(let i=0;i<12;i++)new DataView(f.bin.buffer).setFloat32(offset+i*4,value,true);
  }
  const bytes=fixture.encodeGlb(f.json,f.bin),inspection=api.inspectGlbSkinning(f.json,bytes);
  assert.equal(inspection.maxInfluences,4);assert.equal(inspection.verticesWithExtraWeights,3);
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  const mesh=gltf.scene.getObjectByName('Main');assert.equal(mesh.geometry.getAttribute('skinWeight').getX(0),1);
  api.applyEightWeightSkinning(gltf,inspection);
  assert.deepEqual([...mesh.geometry.getAttribute('skinWeight').array],new Array(12).fill(0));
  assert.deepEqual([...mesh.geometry.getAttribute('skinWeight1').array],new Array(12).fill(.25));
});
test('CPU bounds, morph positions, direction normals/tangents include all 8 bones and bind matrices', async () => {
  const {gltf, api, inspection, THREE} = await setup();
  api.applyEightWeightSkinning(gltf, inspection);
  const mesh = gltf.scene.getObjectByName('Main'), record = inspection.primitives[0];
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bindMatrix.makeRotationZ(.2).setPosition(.2, -.1, .3);
  mesh.bindMatrixInverse.copy(mesh.bindMatrix).invert();
  mesh.skeleton.bones.forEach((bone, i) => {bone.position.set(i / 5, i / 13, i / 19); bone.rotation.set(i / 20, i / 31, 0);});
  gltf.scene.updateMatrixWorld(true);
  mesh.morphTargetInfluences[0] = .4;
  const position = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 0).add(new THREE.Vector3(.15, 0, 0).multiplyScalar(.4));
  assertClose(mesh.getVertexPosition(0, new THREE.Vector3()).toArray(), reference(THREE, mesh, record, 0, position).toArray().slice(0, 3));
  for (const value of [new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(1, 0, 0, 0)]) {
    assertClose(mesh.applyBoneTransform(0, value.clone()).toArray(), reference(THREE, mesh, record, 0, value, true).toArray());
  }
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  for (let i = 0; i < 3; i++) assert.ok(mesh.boundingBox.containsPoint(mesh.getVertexPosition(i, new THREE.Vector3())));
  const a = mesh.geometry.getAttribute('skinWeight'), b = mesh.geometry.getAttribute('skinWeight1');
  a.setX(0, .25); b.setX(0, .25); mesh.normalizeSkinWeights();
  assertClose([0,1,2,3].map(c => a.getComponent(0,c)).concat([0,1,2,3].map(c => b.getComponent(0,c))).reduce((a,b)=>[a[0]+b],[0]), [1]);
});
test('sparse, interleaved and normalized integer accessors preserve both sets', async () => {
  for (const options of [{sparse: true}, {interleaved: true}, {sparse: true, quantized: true, interleaved: true}, {sparse: true, quantized: 16, interleaved: true}]) {
    const {api, gltf, inspection} = await setup(options);
    assert.equal(inspection.maxInfluences, 8);
    api.applyEightWeightSkinning(gltf, inspection);
    assertClose([...gltf.scene.getObjectByName('Main').geometry.getAttribute('skinWeight1').array], new Array(12).fill(.125));
  }
});
test('shader patch covers main/toon/unlit/outline/depth/distance preserving morph order and bind matrices', async () => {
  const [THREE, , api] = await modules;
  for (const name of ['basic','lambert','phong','standard','physical','toon','depth','distance','normal']) {
    const shader = {vertexShader: THREE.ShaderLib[name].vertexShader, fragmentShader: THREE.ShaderLib[name].fragmentShader};
    const fragment = shader.fragmentShader;
    api.patchEightWeightShader(shader);
    assert.equal(shader.fragmentShader, fragment, name);
    for (const c of ['x','y','z','w']) assert.ok(shader.vertexShader.includes(`skinWeight1.${c}`), name);
    assert.ok(shader.vertexShader.includes('bindMatrixInverse * skinned'), name);
    assert.ok(shader.vertexShader.indexOf('#include <morphtarget_vertex>') < shader.vertexShader.indexOf('vec4 skinVertex ='), name);
    if (THREE.ShaderLib[name].vertexShader.includes('<skinnormal_vertex>')) {
      assert.ok(shader.vertexShader.includes('skinMatrix += skinWeight1.w * boneMatH'), name);
      assert.ok(shader.vertexShader.includes('objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz'), name);
    }
  }
  assert.throws(() => api.patchEightWeightShader({vertexShader: 'void main() {}'}), /着色器接口/);
  assert.throws(() => api.patchEightWeightMaterial(new THREE.ShaderMaterial()), /内置 WebGL 材质/);
});
test('material hooks and cache keys compose, are isolated, and do not double patch', async () => {
  const [THREE, , api] = await modules;
  const material = new THREE.MeshStandardMaterial();
  let called = 0;
  material.onBeforeCompile = shader => {called++; shader.vertexShader = '// custom\n' + shader.vertexShader;};
  material.customProgramCacheKey = () => 'custom-1';
  api.patchEightWeightMaterial(material); api.patchEightWeightMaterial(material);
  const shader = {vertexShader: THREE.ShaderLib.standard.vertexShader};
  material.onBeforeCompile(shader, {});
  assert.equal(called, 1); assert.match(shader.vertexShader, /^\/\/ custom/); assert.match(material.customProgramCacheKey(), /^custom-1\|yukino-eight-weight/);
});
test('shadow program features invalidate after main replacement and grouped materials fail closed', async () => {
  const {THREE,api,gltf,inspection}=await setup();api.applyEightWeightSkinning(gltf,inspection);
  const mesh=gltf.scene.getObjectByName('Main'),depth=mesh.customDepthMaterial,distance=mesh.customDistanceMaterial;
  const v=depth.version,d=distance.version;
  mesh.material=new THREE.MeshStandardMaterial({displacementMap:new THREE.Texture()});api.installEightWeightMesh(mesh);
  assert.ok(depth.version>v);assert.ok(distance.version>d);
  const before=(material,group)=>mesh.onBeforeShadow({},mesh,null,null,mesh.geometry,material,group);
  // Emulate the exact r185 shadow-copy -> onBeforeShadow order.
  before(depth,null);const first=depth.version;
  before(depth,null);assert.equal(depth.version,first);
  depth.map=new THREE.Texture();depth.map.channel=1;depth.alphaTest=.5;before(depth,null);assert.ok(depth.version>first);
  const second=depth.version;depth.map.channel=2;before(depth,null);assert.ok(depth.version>second);
  const third=depth.version;depth.map=null;depth.alphaTest=0;before(depth,null);assert.ok(depth.version>third);
  mesh.material=[new THREE.MeshStandardMaterial(),new THREE.MeshStandardMaterial()];
  assert.throws(()=>api.installEightWeightMesh(mesh),/多材质组/);
});
test('four-weight models have no altered objects or materials', async () => {
  const {api, gltf, inspection} = await setup({eight: false});
  const mesh = gltf.scene.getObjectByName('Main'), before = {geometry: mesh.geometry, material: mesh.material, transform: mesh.applyBoneTransform};
  assert.equal(inspection.primitives.length, 0);
  assert.deepEqual(api.applyEightWeightSkinning(gltf, inspection), {meshes: 0, verticesWithExtraWeights: 0});
  assert.equal(mesh.geometry, before.geometry); assert.equal(mesh.material, before.material); assert.equal(mesh.applyBoneTransform, before.transform);
  assert.equal(mesh.customDepthMaterial, undefined);
});
test('rejects malformed weights, indices, mismatched counts, extra sets, and physical bufferView overflow', async () => {
  const [, , api, fixture] = await modules;
  function invalid(edit, pattern) {
    const f = fixture.createEightWeightFixture(); edit(f); const bytes = fixture.encodeGlb(f.json, f.bin);
    assert.throws(() => api.inspectGlbSkinning(f.json, bytes), pattern);
  }
  function write(f, accessor, value) {const a=f.json.accessors[accessor], bv=f.json.bufferViews[a.bufferView];new DataView(f.bin.buffer).setFloat32(bv.byteOffset+(a.byteOffset||0),value,true);}
  invalid(f => write(f, f.indices.w0, -.1), /0–1/);
  invalid(f => write(f, f.indices.w0, NaN), /0–1/);
  invalid(f => write(f, f.indices.w0, .8), /权重之和/);
  invalid(f => {const a=f.json.accessors[f.indices.j1];new DataView(f.bin.buffer).setUint16(f.json.bufferViews[a.bufferView].byteOffset,8,true);}, /骨骼索引/);
  invalid(f => f.json.accessors[f.indices.w1].count = 2, /数量不一致/);
  invalid(f => delete f.json.meshes[0].primitives[0].attributes.JOINTS_1, /成对/);
  invalid(f => f.json.meshes[0].primitives[0].attributes.WEIGHTS_2 = f.indices.w1, /最多支持八/);
  invalid(f => f.json.bufferViews[f.json.accessors[f.indices.w1].bufferView].byteLength = 4, /范围/);
  invalid(f => f.json.bufferViews[f.json.accessors[f.indices.w1].bufferView].byteStride = 8, /步长/);
  invalid(f => f.json.accessors[f.indices.j1].normalized = true, /归一化/);
  invalid(f => f.json.bufferViews[f.json.accessors[f.indices.w1].bufferView].extensions = {EXT_meshopt_compression: {}}, /压缩/);
  invalid(f => f.json.skins[0].joints[7] = 999, /joints/);
  invalid(f => f.json.accessors[f.indices.w1].count = 2000001, /200 万/);
});
test('sparse accessors reject duplicates and out-of-range indices; GLB bounds are checked', async () => {
  const [, , api, fixture] = await modules;
  for (const index of [0, 3]) {
    const f = fixture.createEightWeightFixture({sparse:true});
    const bv = f.json.bufferViews[f.json.accessors[f.indices.w1].sparse.indices.bufferView];
    f.bin[bv.byteOffset+1] = index;
    assert.throws(() => api.inspectGlbSkinning(f.json, fixture.encodeGlb(f.json,f.bin)), /稀疏索引/);
  }
  const f=fixture.createEightWeightFixture();
  const bytes=f.bytes.slice(0);new DataView(bytes).setUint32(12, 0xfffffffc, true);
  assert.throws(()=>api.inspectGlbSkinning(f.json,bytes),/越界/);
});
test('missing GLTF associations fail instead of silently truncating extra weights', async () => {
  const {api, gltf, inspection} = await setup();
  gltf.parser.associations.clear();
  assert.throws(()=>api.applyEightWeightSkinning(gltf, inspection),/原始数据关联/);
});
test('custom shadow resources are disposed exactly once', async () => {
  const {api, gltf, inspection} = await setup(); api.applyEightWeightSkinning(gltf,inspection);
  const mesh=gltf.scene.getObjectByName('Main');let depth=0,distance=0;
  mesh.customDepthMaterial.addEventListener('dispose',()=>depth++);
  mesh.customDistanceMaterial.addEventListener('dispose',()=>distance++);
  api.disposeEightWeightSkinning(gltf.scene);api.disposeEightWeightSkinning(gltf.scene);
  assert.equal(depth,1);assert.equal(distance,1);assert.equal(mesh.customDepthMaterial,undefined);
});
// Exact bundled-source audit runs in CI; optional override audits the original handoff.
// Set YUKINO_ASSET_HANDOFF to the local source contract; never uploads/modifies GLBs.
test('exact handoff assets: model01 keeps all 34 fifth influences; models02–07 stay four-weight', async () => {
  const [THREE,{GLTFLoader},api,fixture]=await modules;
  const handoff=process.env.YUKINO_ASSET_HANDOFF?JSON.parse(fs.readFileSync(process.env.YUKINO_ASSET_HANDOFF,'utf8')):{models:require('../resources/character-models.json').models.filter(model=>model.bundled).map(model=>({...model,id:model.id.split('-')[1],path:require('node:path').resolve(__dirname,'../public',model.url.slice(2))}))};
  for(const model of handoff.models){
    const filename=model.path||model.candidate_path_do_not_autoload;
    const buffer=fs.readFileSync(filename),bytes=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
    const expectedHash=model.sha256||model.candidate_sha256;
    if(expectedHash)assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'),expectedHash,`exact source SHA-256 ${model.id}`);
    const json=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString());
    const inspection=api.inspectGlbSkinning(json,bytes);
    assert.equal(inspection.verticesWithExtraWeights,model.id==='01'?34:0,model.id);
    assert.equal(inspection.maxInfluences,model.id==='01'?5:4,model.id);
    if(model.id!=='01')continue;
    // CPU-only parse of identical geometry/skin/morph/animation bytes, replacing
    // textures/material definitions in memory to avoid a fake browser image loader.
    const cpuJson=structuredClone(json);delete cpuJson.images;delete cpuJson.textures;delete cpuJson.samplers;
    cpuJson.materials=[{}];for(const m of cpuJson.meshes)for(const p of m.primitives)p.material=0;
    const binAt=28+buffer.readUInt32LE(12),binary=buffer.subarray(binAt,binAt+json.buffers[0].byteLength);
    const gltf=await new GLTFLoader().parseAsync(fixture.encodeGlb(cpuJson,binary),'');
    api.applyEightWeightSkinning(gltf,inspection);
    let checked=0,maxTruncationDelta=0;
    const mixer=new THREE.AnimationMixer(gltf.scene);
    const clip=gltf.animations.find(c=>c.name==='Look_Left')||gltf.animations[0];
    if(clip){mixer.clipAction(clip).play();mixer.update(clip.duration*.4);}
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(mesh=>{
      if(!mesh.isSkinnedMesh||!mesh.geometry.getAttribute('skinWeight1'))return;
      const ref=gltf.parser.associations.get(mesh),record=inspection.primitives.find(r=>r.meshIndex===ref.meshes&&r.primitiveIndex===ref.primitives);
      // Independent reader for this source's uncompressed FLOAT VEC4 weights.
      const prim=json.meshes[ref.meshes].primitives[ref.primitives];
      const raw=(name,row,c)=>{const a=json.accessors[prim.attributes[name]],bv=json.bufferViews[a.bufferView];assert.equal(a.componentType,5126);return new DataView(bytes).getFloat32(binAt+(bv.byteOffset||0)+(a.byteOffset||0)+row*(bv.byteStride||16)+c*4,true);};
      for(let row=0;row<record.vertexCount;row++){
        if(![0,1,2,3].some(c=>raw('WEIGHTS_1',row,c)>0))continue;
        checked++; const sum=[0,1,2,3].reduce((s,c)=>s+raw('WEIGHTS_0',row,c)+raw('WEIGHTS_1',row,c),0);
        for(let c=0;c<4;c++)assertClose([mesh.geometry.getAttribute('skinWeight').getComponent(row,c),mesh.geometry.getAttribute('skinWeight1').getComponent(row,c)],[raw('WEIGHTS_0',row,c)/sum,raw('WEIGHTS_1',row,c)/sum]);
        const pos=new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'),row);
        const expected=reference(THREE,mesh,record,row,pos);
        assertClose(mesh.getVertexPosition(row,new THREE.Vector3()).toArray(),expected.toArray().slice(0,3));
        const firstSum=[0,1,2,3].reduce((s,c)=>s+record.weights0[row*4+c],0);
        const naiveRecord={...record,weights0:record.weights0.slice(),weights1:new Float32Array(record.weights1.length)};
        for(let c=0;c<4;c++)naiveRecord.weights0[row*4+c]/=firstSum;
        const four=reference(THREE,mesh,naiveRecord,row,pos);
        maxTruncationDelta=Math.max(maxTruncationDelta,new THREE.Vector3(four.x,four.y,four.z).distanceTo(new THREE.Vector3(expected.x,expected.y,expected.z)));
      }
    });
    assert.equal(checked,34);assert.ok(maxTruncationDelta>1e-7,'fixture must expose real truncation loss');
    console.log(`Model01 CPU audit: ${checked} affected vertices; max loader-normalized 4-weight delta=${maxTruncationDelta}`);
  }
});
