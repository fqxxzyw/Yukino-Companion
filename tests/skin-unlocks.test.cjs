'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),path=require('node:path');
const modulePath=path.resolve(__dirname,'../src/companion/skin-unlocks.mjs');
const load=()=>import(pathToFileURL(modulePath).href);
const at=(year,month,day,hour=12)=>new Date(year,month-1,day,hour).getTime();
const model=(number,extra={})=>({id:`yukino-${number}-v1`,ready:true,status:'validated_stage_uploaded',...extra});

test('usage migration keeps only explicit valid unique dates, never infers days from hours or counters',async()=>{
 const {normalizeUsedDates}=await load();
 for(const old of [null,undefined,{},7,{days:7},{totalDays:7},{lifetimeCount:7},{firstUsedAt:1,usageMs:168*3600000},{version:1,archivedCount:7}])assert.equal(normalizeUsedDates(old).lifetimeCount,0);
 const state=normalizeUsedDates({usedDates:['2026-10-25','2026-10-25','2026-10-26','2026-02-30','0000-01-01','2026-2-01','not-a-date',null,12]});
 assert.deepEqual(state.dates,['2026-10-25','2026-10-26']);assert.equal(state.lifetimeCount,2);assert.deepEqual(normalizeUsedDates(state),state);
});

test('only explicit actual-use events count; repeated use on a date counts once',async()=>{
 const {recordUsedDate,USE_EVENT_TYPES}=await load();let state;
 for(const type of [undefined,'boot','idle','tick','visible-window','elapsed-168-hours']){const result=recordUsedDate(state,{type,now:at(2026,10,27)});assert.equal(result.added,false);assert.equal(result.totalDays,0);}
 for(const type of USE_EVENT_TYPES){const result=recordUsedDate(state,{type,now:at(2026,10,27)});assert.equal(result.added,state===undefined);state=result.state;assert.equal(result.totalDays,1);}
 assert.equal(recordUsedDate(state,{type:'message',now:NaN}).reason,'invalid-date');
 assert.equal(recordUsedDate(state,{type:'message',now:at(2026,10,28)}).totalDays,2);
});

test('7 non-consecutive used dates unlock swimsuits; elapsed time alone and duplicate clock rollback cannot',async()=>{
 const {recordUsedDate,getSkinStatus}=await load();let state;
 for(let n=0;n<6;n++)state=recordUsedDate(state,{type:'message',now:at(2026,10,1+n*2)}).state;
 assert.equal(getSkinStatus(model('03'),{usedDates:state}).unlocked,false);
 assert.equal(recordUsedDate(state,{type:'boot',now:at(2027,1,1)}).totalDays,6);
 const duplicate=recordUsedDate(state,{type:'message',now:at(2026,10,1)});assert.equal(duplicate.added,false);assert.equal(duplicate.totalDays,6);
 const rollback=recordUsedDate(state,{type:'message',now:at(2026,10,2)});assert.equal(rollback.reason,'clock-rollback');assert.equal(rollback.totalDays,6);
 const seventh=recordUsedDate(state,{type:'pet-interaction',now:at(2026,10,27)});assert.equal(seventh.totalDays,7);
 assert.equal(getSkinStatus(model('03'),{usedDates:seventh.state}).unlocked,true);
});

test('date keys follow the actual local timezone including local midnight, not UTC or fixed 24h blocks',async()=>{
 const script=`import {localDateKey,recordUsedDate} from ${JSON.stringify(pathToFileURL(modulePath).href)};const a=Date.parse('2026-10-27T06:59:00Z'),b=Date.parse('2026-10-27T07:01:00Z');let s=recordUsedDate(null,{type:'message',now:a}).state;s=recordUsedDate(s,{type:'message',now:b}).state;console.log(JSON.stringify({a:localDateKey(a),b:localDateKey(b),days:s.lifetimeCount}));`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:'America/Los_Angeles'},encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{a:'2026-10-26',b:'2026-10-27',days:2});
});

test('bounded date storage retains lifetime count and archive watermark prevents re-awarding pruned dates',async()=>{
 const {MAX_USED_DATES,normalizeUsedDates,recordUsedDate,usedDateStatus}=await load();
 const dates=Array.from({length:MAX_USED_DATES+20},(_,n)=>{const d=new Date(Date.UTC(2010,0,1+n));return d.toISOString().slice(0,10);});
 const saved=normalizeUsedDates([...dates,...dates.slice(0,10)]);assert.equal(saved.dates.length,MAX_USED_DATES);assert.equal(saved.archivedCount,20);assert.equal(saved.archivedThrough,dates[19]);assert.equal(saved.lifetimeCount,dates.length);
 assert.deepEqual(normalizeUsedDates(JSON.parse(JSON.stringify(saved))),saved);
 const replay=recordUsedDate(saved,{type:'message',now:at(2010,1,1)});assert.equal(replay.added,false);assert.equal(replay.reason,'archived-date');assert.equal(replay.totalDays,saved.lifetimeCount);
 const last=new Date(`${dates.at(-1)}T12:00:00`);last.setDate(last.getDate()+1);const next=recordUsedDate(saved,{type:'message',now:last.getTime()});assert.equal(next.totalDays,dates.length+1);assert.equal(next.state.dates.length,MAX_USED_DATES);assert.equal(next.state.archivedCount,21);
 assert.equal(usedDateStatus(saved,at(2010,1,1)).clockRollback,true);
});

test('school and micro-motion school variants are available at initial affection; daily outfits use explicit thresholds',async()=>{
 const {AFFINITY_THRESHOLDS,getSkinStatus}=await load();assert.deepEqual(AFFINITY_THRESHOLDS,{'02':40,'04':50,'05':60,'06':70});
 for(const id of ['yukino-07-v1','yukino-07-micro-preview-v1'])assert.equal(getSkinStatus({id,ready:true}).unlocked,true);
 for(const [number,threshold]of Object.entries(AFFINITY_THRESHOLDS)){
  assert.equal(getSkinStatus(model(number),{}).unlocked,false);
  assert.equal(getSkinStatus(model(number),{relationship:{affection:threshold-.1}}).unlocked,false);
  const unlocked=getSkinStatus(model(number),{relationship:{affection:threshold}});assert.equal(unlocked.unlocked,true);assert.equal(unlocked.progress,1);
 }
 assert.equal(getSkinStatus({id:'imported-local-model',ready:true}).unlocked,true);
 assert.equal(getSkinStatus({id:'yukino-08-new',ready:true}).unlocked,false,'new official skins require an explicit unlock rule');
});

test('HOLD and missing assets stay disabled regardless of earned usage or affection',async()=>{
 const {getSkinStatus}=await load(),usedDates=['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07'];
 for(const entry of [model('01',{status:'candidate_HOLD_geometry_feedback'}),model('03',{hold:true}),model('07',{ready:false}),model('02',{ready:false})]){
  const status=getSkinStatus(entry,{relationship:{affection:100},usedDates});assert.equal(status.eligible,true);assert.equal(status.unlocked,false);assert.equal(status.available,false);
 }
 assert.equal(getSkinStatus(model('01',{status:'candidate_hold_geometry_feedback'}),{usedDates}).hold,true);
});

test('progress ignores nonfinite affection and impossible archived counters',async()=>{
 const {getSkinStatus,normalizeUsedDates}=await load();for(const affection of [Infinity,NaN,-100]){const status=getSkinStatus(model('06'),{relationship:{affection}});assert.equal(status.unlocked,false);assert.ok(status.progress>=0&&status.progress<=1);}
 for(const value of [{version:1,archivedThrough:'0000-01-01',archivedCount:999},{version:1,archivedThrough:'2026-02-30',archivedCount:7},{version:1,archivedThrough:'2026-10-27',archivedCount:-7}])assert.equal(normalizeUsedDates(value).lifetimeCount,0);
});

test('actual React skin picker renders locks, real local previews, neutral fallbacks and keyboard buttons',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {transformWithOxc}=await import('vite');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-skin-picker-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const source=await fs.readFile(path.resolve(__dirname,'../src/ui/SkinPicker.jsx'),'utf8');let {code}=await transformWithOxc(source,'SkinPicker.jsx');
 const selectSource=await fs.readFile(path.resolve(__dirname,'../src/ui/Select.jsx'),'utf8');let selectCode=(await transformWithOxc(selectSource,'Select.jsx')).code;
 for(const name of ['react','react/jsx-runtime','react-dom','lucide-react'])selectCode=selectCode.replaceAll(JSON.stringify(name),JSON.stringify(pathToFileURL(require.resolve(name)).href));
 const selectFile=path.join(directory,'Select.mjs');await fs.writeFile(selectFile,selectCode);
 code=code.replace(/import "\.\/SkinPicker\.css";?/,'').replaceAll('"../companion/skin-unlocks.mjs"',JSON.stringify(pathToFileURL(modulePath).href)).replaceAll('"./skin-groups.mjs"',JSON.stringify(pathToFileURL(path.resolve(__dirname,'../src/ui/skin-groups.mjs')).href)).replaceAll('"./Select.jsx"',JSON.stringify(pathToFileURL(selectFile).href));
 for(const name of ['react','react/jsx-runtime','lucide-react'])code=code.replaceAll(JSON.stringify(name),JSON.stringify(pathToFileURL(require.resolve(name)).href));
 const file=path.join(directory,'SkinPicker.mjs');await fs.writeFile(file,code);const {default:SkinPicker}=await import(pathToFileURL(file).href);
 const html=renderToStaticMarkup(React.createElement(SkinPicker,{models:[model('07'),model('02',{thumbnail:'./characters/actual-preview.png'}),model('03',{thumbnail:'https://remote.invalid/not-auto-loaded.png'}),model('01',{status:'HOLD'})],selectedId:'yukino-07-v1'}));
 assert.equal((html.match(/<button/g)||[]).length,4);assert.equal((html.match(/disabled=""/g)||[]).length,3);assert.equal((html.match(/type="button"/g)||[]).length,4);
 assert.match(html,/actual-preview\.png/);assert.doesNotMatch(html,/remote\.invalid/);assert.match(html,/skin-outline/);assert.match(html,/is-locked/);assert.match(html,/好感 35 \/ 40/);assert.match(html,/7 天不等于运行 168 小时/);assert.match(html,/aria-pressed="true"/);
});

// JSX is compiled and its actual event handlers run with a tiny hook scheduler.
// No file chooser, network, personal model or browser profile is used in tests.
async function importPanelHarness(t,api){
 const fs=require('node:fs/promises'),os=require('node:os'),{transformWithOxc}=await import('vite');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-import-panel-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const hookFile=path.join(directory,'hooks.mjs');
 await fs.writeFile(hookFile,[
  'let values=[],cursor=0,effects=[],cleanups=new Map();',
  'export default {};',
  'export function begin(){cursor=0;}',
  'export function useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial==="function"?initial():initial;return [values[n],v=>values[n]=typeof v==="function"?v(values[n]):v];}',
  'export function useRef(value){const n=cursor++;return values[n]||(values[n]={current:value});}',
  'export function useEffect(fn,deps){const n=cursor++,old=values[n];if(!old||deps.some((v,i)=>v!==old[i])){values[n]=deps;effects.push(()=>{cleanups.get(n)?.();cleanups.set(n,fn());});}}',
  'export function flush(){effects.splice(0).forEach(fn=>fn());}',
  'export function unmount(){for(const fn of cleanups.values())fn?.();cleanups.clear();}',
 ].join('\n'));
 let {code}=await transformWithOxc(await fs.readFile(path.resolve(__dirname,'../src/ui/ModelImportSettings.jsx'),'utf8'),'ModelImportSettings.jsx');
 code=code.replace(/import "\.\/SkinPicker\.css";?/,'').replaceAll('"react"',JSON.stringify(pathToFileURL(hookFile).href));
 for(const name of ['react/jsx-runtime','lucide-react'])code=code.replaceAll(JSON.stringify(name),JSON.stringify(pathToFileURL(require.resolve(name)).href));
 const file=path.join(directory,'Panel.mjs');await fs.writeFile(file,code);const module=await import(pathToFileURL(file).href),hooks=await import(pathToFileURL(hookFile).href);
 const imported=[];let tree;
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 const text=node=>node===null||node===undefined||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
 const render=()=>{hooks.begin();tree=module.default({api,onImported:entry=>imported.push(entry)});hooks.flush();return tree;};
 render();t.after(()=>hooks.unmount());
 return {render,imported,Diagnostics:module.ModelImportDiagnostics,find:predicate=>walk(tree).find(predicate),button:label=>walk(tree).find(node=>node.type==='button'&&text(node).includes(label)),text:()=>text(tree),unmount:()=>hooks.unmount()};
}

test('import panel requires explicit supported mode and acknowledgement before confirming; double clicks are coalesced',async t=>{
 let inspectCalls=0,cancelCalls=0;const confirmed=[];
 const inspection={token:'local-check-token',expires:Date.now()+60000,filename:'rigged-example.glb',bytes:1024,allowedModes:['rigged'],diagnostics:{bones:55,skins:1,skinnedMeshes:1,weightedVertices:12,morphs:1,morphNames:['mouth_open_small'],animations:2,usableSkin:true}};
 const h=await importPanelHarness(t,{characterModelCancel:async()=>cancelCalls++,characterModelInspect:async()=>{inspectCalls++;return inspection;},characterModelConfirm:async payload=>{confirmed.push(payload);return {id:'custom-safe',label:payload.label};}});
 assert.equal(inspectCalls,0);const click=h.button('选择并检查').props.onClick;await Promise.all([click(),click()]);assert.equal(inspectCalls,1);h.render();
 assert.equal(h.button('确认导入').props.disabled,true);assert.equal(confirmed.length,0);
 assert.equal(h.find(node=>node.type==='input'&&node.props.value==='static'),undefined);
 h.find(node=>node.type==='input'&&node.props.value==='rigged').props.onChange();h.render();assert.equal(h.button('确认导入').props.disabled,true);
 h.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();assert.equal(h.button('确认导入').props.disabled,false);
 const confirm=h.button('确认导入').props.onClick;await Promise.all([confirm(),confirm()]);h.render();assert.deepEqual(confirmed,[{token:'local-check-token',confirm:true,mode:'rigged',label:'rigged-example'}]);assert.equal(h.imported.length,1);assert.match(h.text(),/已导入/);assert.ok(cancelCalls>=1);
});

test('import cancellation ignores late inspection without clearing a newer backend selection',async t=>{
 let resolve,cancelCalls=0,confirmCalls=0;const h=await importPanelHarness(t,{characterModelCancel:async()=>cancelCalls++,characterModelInspect:()=>new Promise(r=>resolve=r),characterModelConfirm:async()=>{confirmCalls++;}});
 const pending=h.button('选择并检查').props.onClick();await Promise.resolve();await Promise.resolve();h.render();await h.button('取消检查').props.onClick();h.render();const afterCancel=cancelCalls;
 resolve({token:'obsolete',filename:'old.glb',allowedModes:['static'],diagnostics:{usableSkin:false}});await pending;h.render();
 assert.equal(cancelCalls,afterCancel,'stale results must not globally cancel a newer inspection');assert.equal(h.button('确认导入'),undefined);assert.equal(confirmCalls,0);assert.match(h.text(),/已取消检查/);
});

test('model diagnostics renders real counts and the static-skinning limitation without an enabled skeleton-copy option',async t=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const h=await importPanelHarness(t,{});
 const html=renderToStaticMarkup(React.createElement(h.Diagnostics,{inspection:{filename:'static.glb',bytes:1048576,allowedModes:['static'],warnings:['超过四个影响权重需重新导出'],diagnostics:{bones:0,skins:0,skinnedMeshes:0,weightedVertices:0,meshes:2,vertices:1234,triangles:800,morphs:1,morphNames:['mouth'],animations:0,textures:1,usableSkin:false}}}));
 assert.match(html,/1\.00 MiB/);assert.match(html,/骨骼/);assert.match(html,/1,234/);assert.match(html,/形态键/);assert.match(html,/逐顶点权重/);assert.match(html,/静态展示/);assert.match(html,/超过四个影响权重需重新导出/);assert.doesNotMatch(html,/<input[^>]+value="copy"/);
});
test('legacy usage migration preserves only explicit past positive dates and is idempotent',async()=>{const {migrateRecordedUsageDates}=await import('../src/companion/skin-unlocks.mjs');const now=new Date(2026,9,8,12).getTime(),days=Object.fromEntries(Array.from({length:7},(_,i)=>[`2026-10-0${i+1}`,{usageMs:1}]));Object.assign(days,{'2026-10-08':{usageMs:100},'2026-10-09':{usageMs:200},'2026-02-30':{usageMs:200},'2026-09-30':{usageMs:0},'2026-09-29':{usageMs:Infinity},'2026-09-28':{usageMs:'100'},bad:{usageMs:1}});const first=migrateRecordedUsageDates({dates:['2026-10-01']},days,{now});assert.equal(first.state.lifetimeCount,7);assert.equal(first.imported,6);const twice=migrateRecordedUsageDates(first.state,days,{now});assert.deepEqual(twice.state,first.state);assert.equal(twice.imported,0);const flagged=migrateRecordedUsageDates(first.state,{'2026-09-25':{usageMs:100}},{now,alreadyMigrated:true});assert.deepEqual(flagged.state,first.state);assert.equal(flagged.migrated,false)});
test('legacy usage migration uses local date, rejects fabricated total counters and respects archive watermark',async()=>{const {migrateRecordedUsageDates}=await import('../src/companion/skin-unlocks.mjs');const old=process.env.TZ;process.env.TZ='America/Los_Angeles';try{const now=Date.parse('2026-10-08T02:00:00Z'),r=migrateRecordedUsageDates({version:1,archivedThrough:'2026-10-01',archivedCount:1,dates:[]},{'2026-10-01':{usageMs:2},'2026-10-06':{usageMs:1},'2026-10-07':{usageMs:1},usageMs:86400000,installedAt:0},{now});assert.deepEqual(r.state.dates,['2026-10-06']);assert.equal(r.state.lifetimeCount,2)}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old}});
