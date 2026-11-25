const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/ui/scene-cel-materials.mjs')]);

function selectAndCompile(material, mesh, chunk) {
  material.onBeforeRender(null, null, null, mesh.geometry, mesh, null);
  const shader = { fragmentShader: '#include <' + chunk + '>', uniforms: {} };
  material.onBeforeCompile(shader, null);
  return shader;
}

test('leaf, wood and stone change only the direct diffuse term of supported lighting models', async () => {
  const [T, { setSceneCelShading }] = await modules;
  const root = new T.Group();
  const examples = [
    ['leaf', new T.MeshStandardMaterial({ transparent: true, alphaTest: .4 }), 'lights_physical_pars_fragment'],
    ['wood', new T.MeshPhongMaterial(), 'lights_phong_pars_fragment'],
    ['stone', new T.MeshLambertMaterial(), 'lights_lambert_pars_fragment'],
    ['surface', new T.MeshToonMaterial(), 'lights_toon_pars_fragment'],
  ];
  const meshes = examples.map(([name, material]) => {
    material.name = name;
    const mesh = new T.Mesh(new T.BoxGeometry(), material);
    root.add(mesh);
    return mesh;
  });
  setSceneCelShading(root, true);
  const ramps = new Set();
  examples.forEach(([name, material, chunk], index) => {
    const { fragmentShader } = selectAndCompile(material, meshes[index], chunk);
    assert.ok(material.customProgramCacheKey().endsWith(':' + name));
    assert.ok(fragmentShader.includes('directLight.color * sceneCelCosine(dot(geometryNormal, directLight.direction))'));
    // The official chunk continues to own all terms except its irradiance factor in directDiffuse.
    const original = fragmentShader.replace('(directLight.color * sceneCelCosine(dot(geometryNormal, directLight.direction)))', 'irradiance');
    assert.ok(original.endsWith(T.ShaderChunk[chunk]));
    ramps.add(original.slice(0, -T.ShaderChunk[chunk].length));
  });
  assert.equal(ramps.size, 4);
  setSceneCelShading(root, false);
  for (const mesh of meshes) {
    assert.equal(Object.hasOwn(mesh.material, 'onBeforeCompile'), false);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

test('a shared material selects the program per mesh and restores its authored hooks after the last root releases it', async () => {
  const [T, { setSceneCelShading }] = await modules;
  const material = new T.MeshStandardMaterial();
  const geometry = new T.BoxGeometry();
  const uniforms = { value: 3 };
  const authoredCompile = shader => { shader.uniforms.wind = uniforms; };
  const authoredKey = () => 'authored-wind';
  const draws = [];
  const authoredDraw = (_gl, _scene, _camera, _geometry, object) => { draws.push(object); };
  Object.assign(material, { onBeforeRender: authoredDraw, onBeforeCompile: authoredCompile, customProgramCacheKey: authoredKey });
  let disposals = 0;
  material.addEventListener('dispose', () => { disposals++; });
  const first = new T.Group(), second = new T.Group();
  const wood = new T.Mesh(geometry, [material, material]), stone = new T.Mesh(geometry, material);
  const glass = new T.Mesh(geometry, material);
  wood.name = 'wood'; stone.name = 'stone'; glass.name = 'window-glass';
  first.add(wood, glass); second.add(stone);
  const chunk = 'lights_physical_pars_fragment';
  function expectDraw(mesh, type) {
    const shader = selectAndCompile(material, mesh, chunk);
    assert.equal(material.customProgramCacheKey(), 'authored-wind' + (type ? '|scene-cel-diffuse-v1:' + type : ''));
    assert.equal(shader.uniforms.wind, uniforms);
    assert.equal(shader.fragmentShader.includes('sceneCelCosine'), Boolean(type));
    assert.equal(draws.at(-1), mesh);
  }
  setSceneCelShading(first, true);
  const installed = material.onBeforeRender;
  setSceneCelShading(first, true);
  expectDraw(wood, 'wood');
  const version = material.version;
  expectDraw(wood, 'wood');
  assert.equal(material.version, version);
  expectDraw(glass, null);
  expectDraw(stone, null);
  setSceneCelShading(second, true);
  expectDraw(stone, 'stone');
  expectDraw(wood, 'wood');
  assert.equal(material.onBeforeRender, installed);
  setSceneCelShading(first, false);
  setSceneCelShading(first, false);
  expectDraw(wood, null);
  expectDraw(stone, 'stone');
  setSceneCelShading(second, false);
  assert.equal(material.onBeforeRender, authoredDraw);
  assert.equal(material.onBeforeCompile, authoredCompile);
  assert.equal(material.customProgramCacheKey, authoredKey);
  assert.equal(wood.material[0], material);
  assert.equal(stone.material, material);
  assert.equal(disposals, 0);
  geometry.dispose(); material.dispose();
});

test('water, unlit surfaces, glass, polished metal and authored shaders retain their original draw path', async () => {
  const [T, { setSceneCelShading }] = await modules;
  const root = new T.Group(), geometry = new T.BoxGeometry();
  const materials = [
    ['pond:surface', new T.MeshStandardMaterial()], ['glass', new T.MeshPhysicalMaterial()],
    ['', new T.MeshPhysicalMaterial({ transmission: .5 })], ['', new T.MeshStandardMaterial({ transparent: true })],
    ['', new T.MeshStandardMaterial({ metalness: 1 })], ['', new T.MeshBasicMaterial()], ['', new T.ShaderMaterial()],
  ];
  for (const [name, material] of materials) {
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    root.add(mesh);
  }
  const versions = materials.map(([, material]) => material.version);
  setSceneCelShading(root, true);
  materials.forEach(([, material], index) => {
    assert.equal(material.version, versions[index]);
    assert.equal(Object.hasOwn(material, 'onBeforeRender'), false);
    assert.equal(Object.hasOwn(material, 'onBeforeCompile'), false);
  });
  setSceneCelShading(root, false);
  geometry.dispose();
  for (const [,material] of materials) material.dispose();
});

test('painted crowns keep their native alpha and share a seamless atlas until the final owner releases it', async () => {
  const [T, {setSceneCelShading}] = await modules;
  const geometry = new T.PlaneGeometry();
  geometry.setAttribute('crownCenter', new T.InstancedBufferAttribute(new Float32Array([0,-.4,0]),3));
  const materials = [new T.MeshStandardMaterial({alphaTest:.3}), new T.MeshStandardMaterial({alphaTest:.3})];
  const roots = materials.map(material => {
    material.name = 'flower:sakura-spray';
    const root = new T.Group();
    root.add(new T.InstancedMesh(geometry, material, 1));
    return root;
  });
  const compile = (root, id) => {
    setSceneCelShading(root,true,id);
    const mesh=root.children[0], material=mesh.material;
    material.onBeforeRender(null, null, null, geometry, mesh, null);
    const shader={vertexShader:T.ShaderLib.standard.vertexShader, fragmentShader:T.ShaderLib.standard.fragmentShader, uniforms:{}};
    material.onBeforeCompile(shader,null);
    return shader;
  };
  const first=compile(roots[0],'sakura'), second=compile(roots[1],'kyoto');
  const atlas=first.uniforms.uGouacheAtlas.value;
  assert.equal(atlas, second.uniforms.uGouacheAtlas.value);
  assert.equal(atlas.image.width,512);assert.equal(atlas.image.height,512);
  assert.equal(atlas.wrapS,T.RepeatWrapping);assert.equal(atlas.generateMipmaps,true);
  assert.match(first.vertexShader,/paintLocal.xyz - crownCenter/);
  assert.match(first.fragmentShader,/include <alphatest_fragment>/);
  assert.notEqual(first.fragmentShader,second.fragmentShader);
  let disposals=0;atlas.addEventListener('dispose',()=>disposals++);
  setSceneCelShading(roots[0],false);assert.equal(disposals,0);
  setSceneCelShading(roots[1],false);assert.equal(disposals,1);
  const imported=compile(roots[0],'custom-park');
  assert.equal(imported.uniforms.uGouacheAtlas,undefined);
  assert.doesNotMatch(imported.fragmentShader,/YUKINO_GOUACHE/);
  setSceneCelShading(roots[0],false);
  geometry.dispose();materials.forEach(material=>material.dispose());
});

test('both styles draw exactly once through the scene renderer, including factories with authored reflections', async () => {
  const { EnvironmentBackdrop } = await import('../src/ui/environment-backdrop.mjs');
  const scene = {}, camera = {}, calls = [];
  const gl = { render: (...args) => calls.push(args) };
  for (const renderStyle of ['lit', 'toon']) {
    const backdrop = { scene, camera, gl, renderStyle, resize: () => true, current: {} };
    EnvironmentBackdrop.prototype.render.call(backdrop);
    backdrop.current.render = (...args) => calls.push(args);
    EnvironmentBackdrop.prototype.render.call(backdrop);
    assert.deepEqual(calls.splice(0), [[scene, camera], [gl, scene, camera]]);
  }
});
