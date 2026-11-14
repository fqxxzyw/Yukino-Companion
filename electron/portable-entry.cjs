'use strict';

const {app} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function configurePortable() {
  const launcher = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!launcher || !path.isAbsolute(launcher)) throw Error('请用 Yukino Companion 便携 EXE 启动。');

  // Read conversations and Windows-encrypted credentials from the same profile
  // as the installed app. The single-instance lock covers both entry points.
  const profileOverride = app.commandLine.getSwitchValue('user-data-dir');
  if (profileOverride && !path.isAbsolute(profileOverride)) throw Error('用户数据目录必须使用完整路径。');
  const profile = profileOverride || path.join(app.getPath('appData'), 'yukino-companion');
  fs.mkdirSync(profile, {recursive:true});
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  process.env.YUKINO_PORTABLE_LAUNCHER = launcher;

  const viewer = path.join(profile, 'live2d', 'viewer-bridge.js');
  if (!process.env.YUKINO_LIVE2D_DIR && !fs.existsSync(viewer))
    process.env.YUKINO_LIVE2D_DIR = path.join(process.resourcesPath, 'live2d');
}

function seed(file, make) {
  if (fs.existsSync(file)) return;
  const temp = file + '.' + randomUUID() + '.stage';
  try {
    make(temp);
    if (!fs.existsSync(file)) fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, {force:true});
  }
}

function seedPortableAssets() {
  const profile = app.getPath('userData');
  const outfits = path.join(profile, 'local-yukino-outfits');
  const embedded = path.join(process.resourcesPath, 'portable-outfits');
  const catalog = path.join(outfits, 'catalog.json');
  if (fs.existsSync(catalog)) return;

  fs.mkdirSync(outfits, {recursive:true});
  for (const name of fs.readdirSync(embedded)) {
    if (/^[a-f0-9]{64}\.(vrm|actions\.json)$/.test(name)) {
      seed(path.join(outfits, name), temp => fs.copyFileSync(path.join(embedded, name), temp));
    }
  }
  seed(catalog, temp => fs.copyFileSync(path.join(embedded, 'catalog.json'), temp));
}

module.exports = {configurePortable, seedPortableAssets};
