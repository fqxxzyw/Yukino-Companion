const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs/promises');
const {defaultResourceDirectory,selectResourceDirectory,assertWritableDirectory,ResourceDirectoryGate,rebaseManagedResourcePath,resourceDirectoryRecord,resourceDirectoryHistory}=require('../electron/resource-directory.cjs');
const {managedRuntimeBinary}=require('../electron/runtime-paths.cjs');

test('packaged downloads follow the installed executable location, profile remains separate',()=>{
 const executable=path.join(path.parse(process.cwd()).root,'chosen-drive','Yukino','Yukino Companion.exe');
 const userData=path.join(path.parse(process.cwd()).root,'profile','Yukino');
 const chosen=defaultResourceDirectory({packaged:true,executable,userData});
 assert.equal(chosen,path.join(path.dirname(executable),'Yukino-Data'));
 assert.notEqual(chosen,userData);
 assert.equal(defaultResourceDirectory({packaged:false,executable,userData}),userData);
 const custom=path.join(path.parse(process.cwd()).root,'other-volume','Yukino-models');
 assert.equal(selectResourceDirectory({configured:custom,packaged:true,executable,userData}),custom);
 assert.equal(selectResourceDirectory({configured:'relative',packaged:true,executable,userData}),chosen);
});

test('write check preserves existing data and gives an actionable error instead of changing drive',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-location-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'keep'),'untouched');await assertWritableDirectory(dir);
 assert.deepEqual(await fs.readdir(dir),['keep']);
 await assert.rejects(assertWritableDirectory(path.join(dir,'keep','nested')),/资源目录不可写.*选择有写入权限的目录/);
 assert.equal(await fs.readFile(path.join(dir,'keep'),'utf8'),'untouched');
});

test('legacy managed binaries can follow a new runtime without changing custom Python',()=>{
 const base=path.resolve('/new'),legacy=path.resolve('/old'),resources=path.resolve('/bundled'),newPython=path.join(base,'runtime','new','python.exe');
 const oldPython=path.join(legacy,'runtime','old','python.exe');
 assert.equal(managedRuntimeBinary(oldPython,newPython,{dataRoot:base,legacyDataRoot:legacy,resourceRoot:resources}),newPython);
 const custom=path.resolve('/user-python/python.exe');
 assert.equal(managedRuntimeBinary(custom,newPython,{dataRoot:base,legacyDataRoot:legacy,resourceRoot:resources}),custom);
});

test('directory selection and resource operations are mutually exclusive across awaits',async()=>{
 const gate=new ResourceDirectoryGate();let release;
 const held=new Promise(resolve=>{release=resolve});
 const operation=gate.run(()=>held);
 await assert.rejects(gate.select(()=>{}),/正在选择目录或安装资源/);
 release();await operation;
 let finish;const choosing=gate.select(()=>new Promise(resolve=>{finish=resolve}));
 await assert.rejects(gate.run(()=>{}),/正在选择资源目录/);
 await assert.rejects(gate.select(()=>{}),/正在选择目录或安装资源/);
 finish();await choosing;
 gate.pending='/new';await assert.rejects(gate.run(()=>{}),/重启应用/);
 gate.pending=null;await assert.rejects(gate.run(()=>{throw Error('failure')}),/failure/);
 await gate.select(()=>{});
 await assert.rejects(gate.select(()=>{},()=>true),/正在选择目录或安装资源/);
});

test('only app-managed legacy paths are mapped into the selected resource directory',()=>{
 const legacy=path.resolve('/profile'),selected=path.resolve('/chosen-data');
 const options={dataRoot:selected,legacyDataRoot:legacy,managedDirectories:['resources','translation-runtime']};
 assert.equal(rebaseManagedResourcePath(path.join(legacy,'resources','chat','model'),options),path.join(selected,'resources','chat','model'));
 assert.equal(rebaseManagedResourcePath(path.join(legacy,'translation-runtime','models','ja'),options),path.join(selected,'translation-runtime','models','ja'));
 const custom=path.join(legacy,'my-models','custom');assert.equal(rebaseManagedResourcePath(custom,options),custom);
 const outside=path.resolve('/profile-other/resources/chat');assert.equal(rebaseManagedResourcePath(outside,options),outside);
});

test('successive selected directories keep managed history and rebase model paths, never custom paths',()=>{
 const first=path.resolve('/volume-d/Yukino'),second=path.resolve('/volume-e/Yukino'),third=path.resolve('/volume-f/Yukino');
 const changed=resourceDirectoryRecord(second,{currentDirectory:first});
 const again=resourceDirectoryRecord(third,{currentDirectory:second,previousDirectories:changed.previousDirectories});
 assert.deepEqual(again.previousDirectories,[second,first]);
 const options={dataRoot:third,legacyDataRoot:path.resolve('/profile'),previousDirectories:again.previousDirectories,managedDirectories:['resources','translation-runtime','speech-models','speech-engine','voice-presets']};
 for(const directory of options.managedDirectories)assert.equal(rebaseManagedResourcePath(path.join(first,directory,'saved-file'),options),path.join(third,directory,'saved-file'));
 const custom=path.join(first,'my-custom-model','weights');assert.equal(rebaseManagedResourcePath(custom,options),custom);
 const current=path.join(third,'resources','chat');assert.equal(rebaseManagedResourcePath(current,options),current);
 const nested=path.join(first,'resources','nested-selection');
 assert.equal(rebaseManagedResourcePath(path.join(nested,'speech-models','bert'),{...options,previousDirectories:[first,nested]}),path.join(third,'speech-models','bert'));
 const filtered=resourceDirectoryHistory([first,first,'relative','bad\0path',null,path.parse(first).root]);assert.deepEqual(filtered,[first]);
});

test('runtime binaries from all recorded previous roots follow the current runtime',()=>{
 const first=path.resolve('/volume-d/Yukino'),selected=path.resolve('/volume-e/Yukino'),python=path.join(selected,'runtime','current','python.exe');
 const options={dataRoot:selected,legacyDataRoot:path.resolve('/profile'),previousDirectories:[first],resourceRoot:path.resolve('/application/resources')};
 assert.equal(managedRuntimeBinary(path.join(first,'runtime','old','python-runtime','python.exe'),python,options),python);
 assert.equal(managedRuntimeBinary(path.join(first,'runtime','old','python-runtime','python.exe'),'',options),'');
 const custom=path.join(first,'my-python','python.exe');assert.equal(managedRuntimeBinary(custom,python,options),custom);
});
