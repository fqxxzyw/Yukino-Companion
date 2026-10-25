const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32') throw Error('Build the Windows bootstrap installer on Windows');
const compiler = process.env.MAKENSIS || path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS', 'makensis.exe');
const extractor = require('7zip-bin').path7za;
for (const filename of [compiler, extractor, path.join(root, 'release/app-payload.json')]) {
  if (!fs.existsSync(filename)) throw Error(`Missing installer build input: ${filename}`);
}
const result = spawnSync(compiler, ['/V3', `/DPROJECT_ROOT=${root}`, `/DSEVEN_ZIP=${extractor}`, path.join(root, 'scripts/windows-bootstrap.nsi')], {stdio:'inherit', windowsHide:true});
if (result.error) throw result.error;
process.exitCode = result.status || 0;
