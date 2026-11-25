'use strict';
// The project app ID is already in use on developers' machines. Exercise the
// same stock 0.4.3 -> protected 0.4.4 NSIS templates in a unique HKCU scope.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {execFileSync,spawn} = require('node:child_process');
const {once} = require('node:events');
const assert = require('node:assert/strict');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'yukino-nsis-review-'));
  const id = 'yukino-fixture-'+randomUUID(), product = 'Yukino QA '+id.slice(-8);
  const project = path.join(root,'project'), appDir = path.join(root,'payload'), install = path.join(root, 'installed app');
  const profile = path.join(process.env.APPDATA,id), cache = path.join(process.env.LOCALAPPDATA,id+'-updater');
  const scripts = path.join(project,'scripts'), runner = require.resolve('electron-builder/out/cli/cli.js');
  const run = (exe,args,options={}) => execFileSync(exe,args,{windowsHide:true,stdio:'inherit', ...options});
  const exeName = product+'.exe', uninstall = path.join(install,'Uninstall '+exeName);
  try {
    await fs.mkdir(scripts,{recursive:true}); await fs.mkdir(path.join(appDir,'resources'),{recursive:true}); await fs.mkdir(profile);
    for(const name of ['nsis-owned-files.cjs','yukino-update.nsh']) await fs.copyFile(path.join(__dirname,name),path.join(scripts,name));
    await fs.writeFile(path.join(profile,'chat.json'),'preserve chat');
    await fs.writeFile(path.join(profile,'settings.json'),'preserve settings');
    for(const version of ['0.4.3','0.4.4']) {
      const modern = version === '0.4.4', output = path.join(root,version);
      const nsis = {oneClick:false,allowElevation:false,perMachine:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:false,createStartMenuShortcut:false,deleteAppDataOnUninstall:false,artifactName:'fixture.exe'};
      if(modern)nsis.include='scripts/yukino-update.nsh';
      const pkg = {name:id,version,description:'Isolated NSIS data preservation fixture',author:'QA',main:'index.js',
        build:{appId:'io.github.fqxxzyw.'+id,productName:product,electronVersion:require('electron/package.json').version,directories:{output},win:{signAndEditExecutable:false},publish:{provider:'github',owner:'fqxxzyw',repo:'Yukino-Companion'},nsis}};
      await fs.writeFile(path.join(project,'package.json'),JSON.stringify(pkg));
      const cs = path.join(root,'Fixture.cs');
      await fs.writeFile(cs,'using System.IO; using System.Reflection; [assembly: AssemblyVersion("'+version+'.0")] class Program { static void Main(){ File.WriteAllText(Path.Combine(System.AppDomain.CurrentDomain.BaseDirectory, "restarted.txt"), "'+version+'"); }}');
      run(path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'),['/nologo','/target:winexe','/out:'+path.join(appDir,exeName),cs]);
      await fs.writeFile(path.join(appDir,'resources','app.asar'),version);
      run(process.execPath,[runner,'--projectDir',project,'--win','nsis','--x64','--prepackaged',appDir,'--publish','never'],{
        env:{...process.env,NODE_PATH:path.join(__dirname,'..','node_modules'),CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
      const setup = path.join(output,'fixture.exe');
      if(modern){
        const lockFile=path.join(install,'resources','app.asar'), ready=path.join(root,'lock-ready'), stop=path.join(root,'unlock');
        const oldExe=await fs.readFile(path.join(install,exeName));
        const lockScript='$h=[IO.File]::Open($env:YUKINO_LOCK_TARGET,"Open","Read","None"); try { [IO.File]::WriteAllText($env:YUKINO_LOCK_READY,"1"); $end=[DateTime]::UtcNow.AddSeconds(90); while(-not [IO.File]::Exists($env:YUKINO_LOCK_STOP) -and [DateTime]::UtcNow -lt $end){Start-Sleep -Milliseconds 100} } finally { $h.Dispose() }';
        const locker=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',lockScript],{windowsHide:true,env:{...process.env,YUKINO_LOCK_TARGET:lockFile,YUKINO_LOCK_READY:ready,YUKINO_LOCK_STOP:stop}});
        const stopped=once(locker,'exit');
        try {
          for(let i=0;i<100&&!await fs.stat(ready).catch(()=>null);i++)await new Promise(done=>setTimeout(done,100));
          assert.ok(await fs.stat(ready));
          try {run(setup,['--updated','/S','/currentuser','/D='+install],{windowsVerbatimArguments:true});}
          catch(error){if(error.status!==2)throw error;}
        } finally { await fs.writeFile(stop,'1');await stopped; }
        assert.equal(await fs.readFile(lockFile,'utf8'),'0.4.3');
        assert.deepEqual(await fs.readFile(path.join(install,exeName)),oldExe);
        assert.equal(await fs.readFile(path.join(install,'Yukino-Data','models','local.gguf'),'utf8'),'preserve model');
        console.log('Locked-file failure rolled back. Old executable, app archive and existing model verified.');
      }
      // The production NSIS /D= argument must be the final, unquoted string.
      run(setup,[...(modern?['--updated','--force-run']:[]),'/S','/currentuser','/D='+install],{windowsVerbatimArguments:true});
      assert.equal(await fs.readFile(path.join(install,'resources','app.asar'),'utf8'),version);
      if(!modern) {
        await fs.mkdir(path.join(install,'Yukino-Data','models'),{recursive:true});
        await fs.writeFile(path.join(install,'Yukino-Data','models','local.gguf'),'preserve model');
        await fs.writeFile(path.join(install,'resources','custom.bin'),'preserve resource');
      }
    }
    for(let i=0;i<100;i++) {
      if(await fs.readFile(path.join(install,'restarted.txt'),'utf8').catch(()=>'') === '0.4.4')break;
      await new Promise(done=>setTimeout(done,100));
    }
    assert.equal(await fs.readFile(path.join(install,'restarted.txt'),'utf8'),'0.4.4');
    assert.equal(await fs.readFile(path.join(profile,'chat.json'),'utf8'),'preserve chat');
    assert.equal(await fs.readFile(path.join(profile,'settings.json'),'utf8'),'preserve settings');
    assert.equal(await fs.readFile(path.join(install,'Yukino-Data','models','local.gguf'),'utf8'),'preserve model');
    assert.equal(await fs.readFile(path.join(install,'resources','custom.bin'),'utf8'),'preserve resource');
    assert.ok((await fs.stat(path.join(cache,'current.blockmap'))).size>0);
    console.log('NSIS 0.4.3 -> 0.4.4 verified (isolated app ID): new version ran, profile and installation resources retained.');
  } finally {
    // _?= runs this fixture uninstaller synchronously in place, without
    // spawning a detached cleanup process against the test directory.
    if(await fs.stat(uninstall).catch(()=>null))run(uninstall,['/S','/currentuser','_?='+install],{windowsVerbatimArguments:true});
    for(const directory of [root,profile,cache])await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:150});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
