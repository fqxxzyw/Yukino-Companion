'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { motionEditorFile, sanitizeTheme } = require('../electron/motion-editor.cjs');

const editor = path.resolve(__dirname, '../dist/motion-editor');
const characters = path.resolve(__dirname, '../dist/characters');

test('embedded editor serves its built pages, bundles and the host character directory', () => {
  const resolveFile = (name) => motionEditorFile('yukino-motion://local/' + name, characters);
  assert.equal(resolveFile('index.html'), path.join(editor, 'index.html'));
  assert.equal(resolveFile('player.html'), path.join(editor, 'player.html'));
  assert.equal(resolveFile('assets/editor-chunk_2.js'), path.join(editor, 'assets/editor-chunk_2.js'));
  assert.equal(resolveFile('models/Yukino04_UVPartsClean_PORTABLE.glb'),
    path.join(characters, 'Yukino04_UVPartsClean_PORTABLE.glb'));
});

test('editor protocol refuses unrelated hosts and paths outside its packaged surface', () => {
  for (const url of [
    'https://local/index.html', 'yukino-motion://other/index.html',
    'yukino-motion://user@local/index.html', 'yukino-motion://local/assets/%2e%2e%2fpackage.json',
    'yukino-motion://local/models/Yukino04.glb', 'yukino-motion://local/../package.json',
  ]) assert.equal(motionEditorFile(url, characters), null, url);
});

test('theme bridge accepts only bounded colors and strips unrelated user data', () => {
  const names = ['--accent', '--accent-text', '--on-accent', '--bg', '--surface', '--surface-soft',
    '--text', '--secondary', '--tertiary', '--line', '--hover', '--shadow', '--danger', '--danger-bg'];
  const colors = Object.fromEntries(names.map((name) => [name, '#123456']));
  const value = sanitizeTheme({ colors: { ...colors, secret: 'private' }, scheme: 'dark', reduce: true, conversations: ['private'] });
  assert.deepEqual(value, { colors, scheme: 'dark', reduce: true });
  assert.equal(sanitizeTheme({ colors: { ...colors, '--accent': 'url(https://example.test)' }, scheme: 'dark', reduce: true }), null);
  assert.equal(sanitizeTheme({ colors, scheme: 'other', reduce: true }), null);
  assert.equal(sanitizeTheme({ colors, scheme: 'light', reduce: 'true' }), null);
});
