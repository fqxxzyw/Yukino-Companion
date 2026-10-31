const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

// Procedural textures need Canvas2D, not a WebGL renderer. Keep the geometry tests
// runnable offline in Node; actual painting/lighting remains a browser concern.
function canvasDocument() {
  return {
    createElement(name) {
      assert.equal(name, 'canvas');
      const canvas = { width: 0, height: 0 };
      const gradient = { addColorStop() {} };
      const context = new Proxy({
        canvas,
        getImageData(_x, _y, width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
        createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
        createLinearGradient() { return gradient; },
        createRadialGradient() { return gradient; },
        measureText(text) { return { width: text.length * 8 }; },
      }, {
        get(target, key) { return key in target ? target[key] : () => {}; },
      });
      canvas.getContext = kind => { assert.equal(kind, '2d'); return context; };
      return canvas;
    },
  };
}
function withCanvas(run) {
  const old = global.document;
  global.document = canvasDocument();
  try { return run(); } finally {
    if (old === undefined) delete global.document;
    else global.document = old;
  }
}
const project = path.resolve(__dirname, '..');
const configs = [
  ['surf-hall', ['day', 'dusk', 'night'], 4],
  ['school', ['morning', 'afternoon', 'dusk', 'night'], 4],
  ['kasai', ['day', 'dusk'], 5],
];

for (const [id, presets, anchorCount] of configs) {
  test(`${id}: original factory API uses installed Three and supports every preset`, async () => {
    const THREE = await import('three');
    const { createScene } = await import(`../src/scenes/${id}.mjs`);
    withCanvas(() => {
      const scene = new THREE.Scene();
      const oldBackground = new THREE.Color('#102030');
      const oldEnvironment = new THREE.Texture();
      scene.background = oldBackground;
      scene.environment = oldEnvironment;
      scene.environmentIntensity = .431;
      const instance = createScene({ scene });
      assert.ok(instance.root instanceof THREE.Group);
      assert.equal(instance.root.parent, null, 'host owns placement and attachment');
      assert.deepEqual(instance.lightingPresets, presets);
      assert.deepEqual(Object.keys(instance.cameraPresets), ['overview', 'photo', 'companion']);
      assert.equal(Object.keys(instance.anchors).length, anchorCount);
      for (const name of ['Character_Anchor', 'path_enter', 'path_exit']) {
        assert.ok(instance.anchors[name] instanceof THREE.Object3D);
        assert.equal(instance.anchors[name].parent, instance.root);
        assert.ok(instance.anchors[name].position.toArray().every(Number.isFinite));
      }
      let meshCount = 0, cards = 0;
      const resources = new Set(), instances = new Set();
      instance.root.traverse(object => {
        if (!object.isMesh) return;
        meshCount++;
        assert.ok(object instanceof THREE.Mesh);
        assert.ok(object.geometry instanceof THREE.BufferGeometry);
        assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite));
        resources.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          assert.ok(material instanceof THREE.Material);
          resources.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
        }
        if (object.isInstancedMesh) {
          instances.add(object);
          assert.ok(Array.from(object.instanceMatrix.array).every(Number.isFinite));
        }
        if (object.name === 'tree:canopy') {
          cards++;
          assert.ok(object instanceof THREE.InstancedMesh);
          assert.equal(object.geometry.type, 'PlaneGeometry');
          assert.equal(object.userData.foliage, 'instanced-leaf-cards');
          assert.equal(object.material.map.name, 'kit:leaf-card');
          assert.ok(object.count >= 240);
          assert.ok(object.parent.children.some(child => child.name === 'tree:branch'));
          assert.ok(object.parent.children.some(child => child.name === 'tree:twig'));
        }
      });
      assert.ok(meshCount > 100, 'retains actual detailed supplied geometry');
      assert.ok(cards >= 4, 'all supplied trees retain branch/leaf-card canopies');
      for (const preset of presets) {
        assert.equal(instance.setLighting(preset), preset);
        instance.update(1 / 60, 20);
        assert.ok(scene.background?.isTexture);
        assert.ok(Number.isFinite(scene.environmentIntensity));
      }
      assert.equal(instance.setLighting('unsupported-preset'), instance.defaultLighting);
      const disposal = new Map([...resources, ...instances].map(resource => [resource, 0]));
      for (const resource of disposal.keys()) resource.addEventListener('dispose', () => disposal.set(resource, disposal.get(resource) + 1));
      scene.add(instance.root);
      instance.dispose();
      instance.dispose();
      assert.equal(instance.root.parent, null);
      assert.equal(scene.background, oldBackground);
      assert.equal(scene.environment, oldEnvironment);
      assert.equal(scene.environmentIntensity, .431);
      for (const [resource, count] of disposal) assert.equal(count, 1, `${resource.type || resource.name} disposed once`);
      assert.equal(instance.setLighting('night'), instance.defaultLighting, 'disposed handles do not mutate shared state');
      instance.update(1 / 60, 40);
      oldEnvironment.dispose();
    });
  });
}

test('wedding: 26 original-size steps, landing, tower attachments and sloped posts align', async () => {
  const THREE = await import('three');
  const { createScene } = await import('../src/scenes/surf-hall.mjs');
  withCanvas(() => {
    const instance = createScene();
    const root = instance.root;
    const stairs = root.getObjectByName('grand-stair');
    const steps = stairs.getObjectByName('stairs:steps');
    const rise = 26 * .165, run = 26 * .34, foot = 4.9 + 11 * .34;
    assert.equal(steps.count, 26);
    const transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
    for (let index = 0; index < steps.count; index++) {
      steps.getMatrixAt(index, matrix);
      matrix.decompose(transform.position, transform.quaternion, transform.scale);
      assert.ok(Math.abs(transform.scale.y - (index + 1) * .165) < 1e-6);
      assert.ok(Math.abs(transform.position.z + (index + .5) * .34) < 1e-6);
      assert.ok(Math.abs(transform.scale.z - .35) < 1e-6);
    }
    assert.ok(Math.abs(stairs.position.z - foot) < 1e-9);
    assert.ok(Math.abs(foot - run + .2) < 1e-9, 'top remains attached to original landing plan');
    const slab = root.getObjectByName('landing:slab');
    assert.ok(Math.abs(slab.position.y + slab.geometry.parameters.height / 2 - rise) < 1e-9);
    assert.equal(instance.anchors.Character_Anchor_TopPlatform.position.y, rise);
    const pylon = root.getObjectByName('tower:pylon');
    assert.ok(Math.abs(pylon.position.y - pylon.geometry.parameters.height / 2 - rise) < 1e-9);
    assert.equal(root.getObjectByName('lobby:halo').position.y, rise + 4.675);
    assert.equal(root.getObjectByName('tower:side-slot').position.y, rise + 4.025);
    for (const side of ['left', 'right']) {
      const rail = root.getObjectByName(`stair:handrail-${side}`);
      const posts = rail.children.filter(child => child.geometry?.parameters?.width === .062);
      assert.ok(posts.length >= 10);
      for (const post of posts) {
        const z = post.position.z;
        const slope = z <= foot - run ? rise + .78 : .88 + (rise + .78 - .88) * (foot + .3 - z) / (foot + .3 - (foot - run));
        assert.ok(Math.abs(post.position.y - .95 / 2 - slope - .09) < 1e-8);
      }
      assert.ok(Math.abs(posts[0].position.z - (foot + .2)) < 1e-9);
    }
    instance.dispose();
  });
});

test('school: night warms actual classroom/door glass and resets to daylight', async () => {
  const THREE = await import('three');
  const { createScene } = await import('../src/scenes/school.mjs');
  withCanvas(() => {
    const scene = new THREE.Scene(), renderer = { toneMappingExposure: .77 };
    const instance = createScene({ scene, renderer });
    const materials = new Map();
    instance.root.traverse(object => { if (object.material) materials.set(object.material.name, object.material); });
    assert.equal(instance.setLighting('night'), 'night');
    assert.ok(materials.get('school:glass').emissiveIntensity >= .7);
    assert.ok(materials.get('school:door-glass').emissiveIntensity >= .4);
    assert.ok(materials.get('school:room-glow').opacity > .9);
    assert.equal(renderer.toneMappingExposure, 1.02);
    instance.setLighting('afternoon');
    assert.equal(materials.get('school:glass').emissiveIntensity, 0);
    assert.equal(materials.get('school:door-glass').emissiveIntensity, 0);
    assert.equal(materials.get('school:room-glow').opacity, 0);
    assert.equal(renderer.toneMappingExposure, .9);
    instance.dispose();
    assert.equal(renderer.toneMappingExposure, .77);
  });
});

test('factories leave later host scene state untouched when disposed', async () => {
  const THREE = await import('three');
  for (const [id] of configs) {
    const { createScene } = await import(`../src/scenes/${id}.mjs`);
    withCanvas(() => {
      const scene = new THREE.Scene();
      const instance = createScene({ scene });
      const replacementBackground = new THREE.Color('#abcdef');
      const replacementEnvironment = new THREE.Texture();
      scene.background = replacementBackground;
      scene.environment = replacementEnvironment;
      scene.environmentIntensity = .137;
      instance.dispose();
      assert.equal(scene.background, replacementBackground);
      assert.equal(scene.environment, replacementEnvironment);
      assert.equal(scene.environmentIntensity, .137);
      replacementEnvironment.dispose();
    });
  }
});

test('scene source imports Three rather than carrying standalone renderers or HTML', () => {
  for (const [id] of configs) {
    const source = fs.readFileSync(path.join(project, 'src/scenes', `${id}.mjs`), 'utf8');
    assert.match(source, /from 'three'/);
    assert.match(source, /from 'three\/addons\/geometries\/RoundedBoxGeometry\.js'/);
    assert.doesNotMatch(source, /WebGLRenderer|__THREE__|requestAnimationFrame|iframe|<script|window\./);
    assert.ok(Buffer.byteLength(source) < 100_000);
  }
});
