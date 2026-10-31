const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const read=file=>fs.readFile(path.join(__dirname,'..',file),'utf8');
test('control motion and model glass styles parse without error recovery',async()=>{
 const {createRequire}=require('node:module'),fromVite=createRequire(require.resolve('vite'));
 const {transform}=fromVite('lightningcss');
 for(const file of ['src/ui/control-motion.css','src/model-window.css','src/style.css']){const code=Buffer.from(await read(file));assert.doesNotThrow(()=>transform({filename:file,code,errorRecovery:false}),file);}
});
test('moving selections use locally scoped CSS anchors and retain old-engine fallback',async()=>{
 const css=await read('src/ui/control-motion.css');
 assert.match(css,/@supports \(anchor-name:--control-selection\) and \(anchor-scope:--control-selection\)/);
 assert.match(css,/anchor-scope:--control-selection/);assert.match(css,/position-anchor:--control-selection/);
 for(const group of ['segmented','settings-tabs','settings-nav nav','settings-subnav'])assert.ok(css.includes(group));
 assert.match(css,/pointer-events:none/);assert.match(css,/width:anchor-size\(width\)/);
 assert.match(css,/transition:left var\(--control-settle\)/);
 const main=await read('src/style.css');assert.match(main,/\.segmented \.active\{background:var\(--surface\)/,'fallback keeps an explicit static selection');
 assert.doesNotMatch(css,/transition:\s*all|will-change:|animation:[^;]*infinite/);
});
test('press feedback excludes disabled and drag controls and honors every reduced-motion path',async()=>{
 const css=await read('src/ui/control-motion.css');
 assert.match(css,/button:not\(:disabled\):not\(\[aria-disabled=true\]\):active/);
 assert.match(css,/\.app \.window-actions button/);assert.match(css,/\.model-companion \.dock-handle/);
 for(const condition of ['.app.reduce','[data-reduced-motion=true]','prefers-reduced-motion:reduce','forced-colors:active'])assert.ok(css.includes(condition),condition);
 assert.match(css,/translate:none!important;scale:none!important/);
 const select=await read('src/ui/Select.jsx');assert.match(select,/data-reduced-motion=\{position.animation==='none'\|\|undefined\}/);
});
test('main and actual 3D entrypoints load the same tactile layer without changing business handlers',async()=>{
 for(const file of ['src/main.jsx','src/model-window.jsx'])assert.match(await read(file),/import '\.\/ui\/control-motion\.css'/);
 const model=await read('src/model-window.css');assert.match(model,/\.model-reply-actions button:first-child/);
 assert.match(model,/prefers-reduced-transparency:reduce/);assert.match(model,/backdrop-filter:none/);
});
