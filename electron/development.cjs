'use strict';
const fs = require('node:fs');
const path = require('node:path');

function developmentURL(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw Error('开发服务器只允许 http://127.0.0.1:端口/');
  }
  return url.href;
}

// Must run before ready, the single-instance lock, sessions, and service imports.
// Every unpackaged launch (including npm start) is isolated from installed data.
function configureDevelopment(app, env = process.env) {
  if (app.isPackaged !== false) return {enabled:false, url:null};
  const directory = path.join(app.getPath('appData'), 'yukino-companion-development');
  fs.mkdirSync(directory, {recursive:true});
  const sessions = path.join(directory, 'chromium');
  fs.mkdirSync(sessions, {recursive:true});
  app.setPath('userData', directory);
  app.setPath('sessionData', sessions);
  app.setName('Yukino Companion (Development)');
  return {enabled:true, url:developmentURL(env.YUKINO_DEV_SERVER_URL), directory};
}
function developmentRendererURL(app, filename, env = process.env) {
  if (app?.isPackaged !== false) return null;
  const base = developmentURL(env.YUKINO_DEV_SERVER_URL);
  if (!base) return null;
  if (!['model-window.html','visual-window.html'].includes(filename)) throw Error('未知开发页面');
  return new URL(filename, base).href;
}
module.exports = {configureDevelopment, developmentURL, developmentRendererURL};
