// Test launcher only: real main/preload, isolated appData, no inference fixtures.
const {app, session} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.YUKINO_SETTINGS_QA_DATA;
if (!directory || !path.isAbsolute(directory) || !fs.statSync(directory).isDirectory() ||
    !path.basename(directory).startsWith('yukino-settings-qa-')) {
  throw Error('Settings QA requires its own newly created temporary appData directory');
}
const origin = new URL(process.env.YUKINO_DEV_SERVER_URL).origin;
if (!origin.startsWith('http://127.0.0.1:')) throw Error('Settings QA requires a loopback development server');
app.setPath('appData', directory);
globalThis.settingsQaBlockedRequests = [];
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']}, (details, callback) => {
    const allowed = new URL(details.url).origin.replace(/^ws:/,'http:') === origin;
    if (!allowed) globalThis.settingsQaBlockedRequests.push(new URL(details.url).origin);
    callback({cancel:!allowed});
  });
});
require('../electron/main.cjs');
