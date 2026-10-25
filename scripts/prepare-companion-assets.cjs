'use strict';
// Fetch only the pinned, digest-checked source artwork. No executable or voice archive is downloaded.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../electron/companion-view/assets/provenance.json');
const root = path.resolve(__dirname, '../electron/companion-view');
async function valid(file, entry) {
  try { const data = await fs.readFile(file); return data.length === entry.bytes && crypto.createHash('sha256').update(data).digest('hex') === entry.sha256; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function prepare() {
  for (const entry of manifest.files) {
    if (!/^assets\/[a-z-]+\.png$/.test(entry.path)) continue;
    const target = path.join(root, entry.path);
    if (await valid(target, entry)) { console.log(`Verified ${entry.path}`); continue; }
    const response = await fetch(`https://raw.githubusercontent.com/fqxxzyw/yukino_desktop_pet/${manifest.revision}/src/YukinoPet/${entry.path}`, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw Error(`Artwork download failed (${response.status}): ${entry.path}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== entry.bytes || crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256) throw Error(`Artwork digest mismatch: ${entry.path}`);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(`${target}.tmp`, data); await fs.rename(`${target}.tmp`, target);
    console.log(`Prepared ${entry.path}`);
  }
}
if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare, valid };
