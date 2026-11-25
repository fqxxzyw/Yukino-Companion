'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const pkg = require('../package.json');
const characterModels = require('../resources/character-models.json');
const {FORBIDDEN_ASAR_MODULES, FORBIDDEN_RETIRED_GLB_RE} = require('../scripts/build-update-release.cjs');

test('package.json keeps renderer-only bundles in devDependencies so app.asar stays slim', () => {
  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  for (const mod of FORBIDDEN_ASAR_MODULES) {
    assert.equal(Object.hasOwn(deps, mod), false, `${mod} must not be in production dependencies`);
    assert.equal(Object.hasOwn(devDeps, mod), true, `${mod} should remain pinned in devDependencies`);
  }
  for (const requiredRuntime of ['electron-updater', 'js-yaml', 'ws', 'yauzl']) {
    assert.equal(Object.hasOwn(deps, requiredRuntime), true, `${requiredRuntime} is required by Electron main process`);
  }
});

test('package.json unpacks heavy static media out of app.asar for small blockmap diffs', () => {
  const unpack = pkg.build?.asarUnpack || [];
  for (const pattern of [
    'dist/characters/**/*',
    'dist/wallpapers/**/*',
    'dist/textures/**/*',
    'dist/guides/**/*',
    'dist/provider-logos/**/*',
    'dist/scene-previews/**/*',
    'dist/yukino-icon.png',
    'dist/yukino-q.png',
    'dist/assets/**/*.png',
    'electron/companion-view/assets/**/*',
    'electron/companion-view/video-preview/**/*',
  ]) {
    assert.ok(unpack.includes(pattern), `asarUnpack must include ${pattern}`);
  }
  assert.deepEqual(pkg.build?.nsis?.preCompressedFileExtensions, [], 'preCompressedFileExtensions must be [] so unpacked .webm files stay inside yukino-update.nsh atomic staging');
  assert.equal(pkg.build?.nsis?.differentialPackage, 'store-asar', 'NSIS should store slim app.asar verbatim for fine-grained blockmap diffs');
});

test('package.json excludes retired/orphan GLBs without excluding approved V2 or motion-studio models', () => {
  const files = pkg.build?.files || [];
  for (const excluded of [
    '!dist/characters/05-qipao-v2.glb',
    '!dist/characters/Yukino*_GarmentNormal_*.glb',
    '!dist/characters/Yukino01_UVDomainRepair.glb',
    '!dist/characters/Yukino07_MicroActions13_REVIEW.glb',
    '!dist/characters/Yukino07_DialogueMicro19_REVIEW.glb',
  ]) {
    assert.ok(files.includes(excluded), `build.files must exclude ${excluded}`);
  }

  const approvedV2Files = characterModels.models
    .filter(m => m.approvedV2 && m.bundled)
    .map(m => path.basename(m.url));
  assert.equal(approvedV2Files.length, 9);
  for (const name of approvedV2Files) {
    assert.equal(FORBIDDEN_RETIRED_GLB_RE.test(name), false, `Approved V2 model must not be excluded: ${name}`);
  }

  const motionCatalog = fs.readFileSync(path.join(__dirname, '../motion-studio/src/model-catalog.ts'), 'utf8');
  const motionFiles = [...motionCatalog.matchAll(/'([^']+\.glb)'/g)].map(m => m[1]);
  assert.ok(motionFiles.length >= 7);
  for (const name of motionFiles) {
    assert.equal(FORBIDDEN_RETIRED_GLB_RE.test(name), false, `Motion Studio catalog model must not be excluded: ${name}`);
  }
});
