const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Source contracts only: these do not compile Pascal, run an installer, or prove
// native layout, upgrade, cancellation, signature or uninstall behavior.
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'scripts/windows-base.iss'),'utf8');
const build=fs.readFileSync(path.join(root,'scripts/build-base-installer.ps1'),'utf8');

test('Base native UI stays on its pinned engine and verified build dependencies',()=>{
 assert.equal(source.charCodeAt(0),0xfeff,'Chinese Inno source keeps its UTF-8 BOM');
 assert.match(source,/Ver < 0x06070300/);assert.match(source,/Ver >= 0x06070400/);
 assert.match(build,/9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732/);
 assert.match(build,/7d544b9bb1d142cfa11f2e5d3cc8abe2e55f8e066c5124e3772675aa236e1278/);
 assert.match(build,/Get-AuthenticodeSignature/);assert.match(build,/Get-FileHash[^\n]+SHA256/);
 assert.match(source,/Microsoft YaHei UI/);assert.match(source,/SetupIconFile=[^\n]+app-icon\.ico/);
 assert.match(source,/YUKINO COMPANION[^\n]+SetupSetting\("AppVersion"\)/);
});

test('shortcut choices reach native actions and silent installs cannot launch the app',()=>{
 assert.match(source,/Name: "\{autodesktop\}[^\n]+Check: CreateDesktopShortcut/);
 assert.match(source,/Name: "\{autoprograms\}[^\n]+Check: CreateStartMenuShortcut/);
 for(const [name,control] of [['CreateDesktopShortcut','DesktopShortcutCheck'],['CreateStartMenuShortcut','StartMenuShortcutCheck']]){
  assert.ok(source.includes(`function ${name}:Boolean;\nbegin Result:=${control}.Checked; end;`));
  assert.ok(source.includes(`${control}.Checked:=True`));
 }
 assert.match(source,/Description: "启动雪乃[^\n]+Flags: nowait postinstall skipifsilent/);
});

test('file transfer percentage never represents whole-install success',()=>{
 const callback=source.slice(source.indexOf('procedure CurInstallProgressChanged'));
 assert.match(callback,/MaxProgress>0/);assert.match(callback,/not FilesWritten/);
 assert.match(callback,/100\.0\*CurProgress\/MaxProgress/);assert.match(callback,/% · 文件写入/);
 assert.match(source,/if CurStep=ssPostInstall then begin\s+FilesWritten:=True;\s+ProgressPercent.Caption:='文件已写入'/);
 assert.match(source,/出现完成页后，才表示应用安装成功/);
 assert.match(source,/FinishedHeadingLabel=安装完成/);
 assert.doesNotMatch(source,/SetTimer|TTimer|DownloadTemporaryFile|URLDownloadToFile|Exec\(/);
});

test('native styling leaves ownership, path protection and data-preserving uninstall intact',()=>{
 assert.match(source,/PrivilegesRequired=lowest/);assert.match(source,/UsePreviousAppDir=yes/);
 assert.match(source,/AllowCancelDuringInstall=yes/);assert.match(source,/CloseApplications=yes/);
 assert.match(source,/function PrepareToInstall\(var NeedsRestart:Boolean\):String;\s+begin Result:=DirectoryProblem; end;/);
 for(const guard of ['LinkedParent(Directory) or LinkedChildren(Directory)','HasEntries(Directory) and (not Owned(Directory))','yukino-base-installation.ini','UninstallString','resources\\app.asar'])assert.ok(source.includes(guard),guard);
 assert.match(source,/NextButtonClick[\s\S]+Problem:=DirectoryProblem/);
 assert.match(source,/安装过程不下载资源/);assert.match(source,/卸载时保留/);
 assert.doesNotMatch(source,/\[UninstallDelete\]|DelTree\(|RemoveDir\(/);
});
