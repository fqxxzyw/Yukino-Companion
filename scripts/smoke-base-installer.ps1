param([string]$Installer='release/Yukino-Companion-0.4.0-Base-Setup.exe',[string]$PayloadManifest='',[switch]$VerifyCurrentFeatures)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$Installer=[IO.Path]::GetFullPath((Join-Path $root $Installer))
$output=Join-Path $root 'build/base-installer-review';[void][IO.Directory]::CreateDirectory($output)
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('Yukino 基础安装测试 '+[Guid]::NewGuid().ToString('N'))
$target=Join-Path $temporary '中文目录\Yukino Companion'
$report=@{schemaVersion=1;fixtureOnly=$false;passed=$false;checks=@();screenshots=@()}
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class BaseInstallerWindow {
 public delegate bool EnumProc(IntPtr hwnd,IntPtr data);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd,EnumProc cb,IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 public struct Rect {public int Left,Top,Right,Bottom;}
 public class Item {public IntPtr Handle;public string Text;}
 public static List<Item> Children(IntPtr hwnd){var items=new List<Item>();EnumChildWindows(hwnd,(h,p)=>{var s=new StringBuilder(4096);GetWindowText(h,s,s.Capacity);items.Add(new Item{Handle=h,Text=s.ToString()});return true;},IntPtr.Zero);return items;}
}
'@
function Capture([IntPtr]$Window,[string]$Name){
 $rect=New-Object BaseInstallerWindow+Rect
 if(-not [BaseInstallerWindow]::GetWindowRect($Window,[ref]$rect)){throw 'Cannot read installer window bounds'}
 $bitmap=New-Object Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
 $graphics=[Drawing.Graphics]::FromImage($bitmap);$dc=$graphics.GetHdc()
 try{[void][BaseInstallerWindow]::PrintWindow($Window,$dc,2)}finally{$graphics.ReleaseHdc($dc);$graphics.Dispose()}
 try{$bitmap.Save((Join-Path $output ($Name+'.png')),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
 $texts=@([BaseInstallerWindow]::Children($Window)|ForEach-Object{$_.Text}|Where-Object{$_})
 $texts | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output ($Name+'-text.json')) -Encoding utf8
 $report.screenshots+=$Name+'.png'
 return ($texts -join "`n")
}
function Install([string]$Directory,[bool]$Expected){
 $log=Join-Path $output ('install-'+[Guid]::NewGuid().ToString('N')+'.log')
 $child=Start-Process -FilePath $Installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',('/DIR="'+$Directory+'"'),('/LOG="'+$log+'"')) -PassThru
 if(-not $child.WaitForExit(180000)){$child.Kill();throw 'Base installation timed out'}
 if(($Expected -and $child.ExitCode -ne 0) -or (-not $Expected -and $child.ExitCode -eq 0)){
  if(Test-Path -LiteralPath $log){Get-Content -LiteralPath $log -Tail 50|ForEach-Object{Write-Host $_}}
  throw "Unexpected installer exit $($child.ExitCode)"
 }
}
$installedApp=$null;$appStdout=$null;$appStderr=$null
function Stop-InstalledApp {
 if($installedApp){
  $installedApp.Refresh()
  if(-not $installedApp.HasExited){
   $killer=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/taskkill.exe') -ArgumentList @('/PID',[string]$installedApp.Id,'/T','/F') -WindowStyle Hidden -PassThru -Wait
   if(-not $installedApp.WaitForExit(10000)){throw 'Installed application did not stop before upgrade'}
  }
  if($appStdout -and $appStdout.Wait(5000)){$appStdout.Result|Set-Content -LiteralPath (Join-Path $output 'app-first-launch.stdout.log') -Encoding utf8}
  if($appStderr -and $appStderr.Wait(5000)){$appStderr.Result|Set-Content -LiteralPath (Join-Path $output 'app-first-launch.stderr.log') -Encoding utf8}
 }
}
$gui=$null;$visible=$null
try{
 if(-not(Test-Path -LiteralPath $Installer -PathType Leaf)){throw 'Published installer is missing'}
 Write-Host 'Native smoke: open installer pages'
 $gui=Start-Process -FilePath $Installer -ArgumentList '/SP-' -PassThru
 $deadline=[DateTime]::UtcNow.AddSeconds(30)
 do{$visible=Get-Process | Where-Object{$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq '安装 Yukino Companion'} | Select-Object -First 1;if(-not $visible){Start-Sleep -Milliseconds 150}}while(-not $visible -and [DateTime]::UtcNow -lt $deadline)
 if(-not $visible){throw 'Native Chinese installer window did not open'}
 Start-Sleep -Milliseconds 400
 $text=Capture $visible.MainWindowHandle 'welcome'
 if($text -notmatch '一方安静的空间' -or $text -notmatch '安装过程不下载资源'){throw 'Welcome page Chinese text is missing or garbled'}
 $next=[BaseInstallerWindow]::Children($visible.MainWindowHandle)|Where-Object{$_.Text -match '^继续'}|Select-Object -First 1
 if(-not $next){throw 'Native continue button not found'}
 [void][BaseInstallerWindow]::SendMessage($next.Handle,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)
 Start-Sleep -Milliseconds 400
 $text=Capture $visible.MainWindowHandle 'directory'
 if($text -notmatch '专用文件夹' -or $text -notmatch '在桌面创建快捷方式'){throw 'Directory page Chinese text is missing or garbled'}
 $report.checks+='Actual published native installer opens; welcome and directory Chinese text verified and captured'
 Stop-Process -Id $visible.Id -Force -ErrorAction SilentlyContinue
 if(-not $gui.HasExited){Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue}
 $visible=$null;$gui=$null
 Write-Host 'Native smoke: install and verify payload'
 Install $target $true
 if($PayloadManifest){
  & node (Join-Path $root 'scripts/base-payload.cjs') verify $target ([IO.Path]::GetFullPath((Join-Path $root $PayloadManifest)))
  if($LASTEXITCODE -ne 0){throw 'Installed payload does not match this build'}
  $report.checks+='Every installed application payload byte matches the candidate SHA-256 manifest'
 }
 foreach($file in @('Yukino Companion.exe','resources/app.asar','resources/aria2/aria2c.exe','resources/runtime-catalog.json','yukino-base-installation.ini')){if(-not(Test-Path -LiteralPath (Join-Path $target $file))){throw "Installed file missing: $file"}}
 if(Get-ChildItem -LiteralPath $target -Recurse -File|Where-Object{$_.Extension -in @('.gguf','.ckpt','.pth','.ogg') -or $_.Name -eq 'python.exe'}){throw 'Base installation unexpectedly contains model/audio/environment payload'}
 $report.checks+='Published EXE installs into a Chinese path without acquiring model or Python resources'
 # Launch the actual installed application with a wholly temporary profile.
 # APPDATA/LOCALAPPDATA isolate Electron app.getPath as well as Chromium's switch.
 $profile=Join-Path $temporary 'isolated app profile'
 $roaming=Join-Path $profile 'Roaming';$local=Join-Path $profile 'Local'
 [void][IO.Directory]::CreateDirectory($roaming);[void][IO.Directory]::CreateDirectory($local)
 $start=New-Object Diagnostics.ProcessStartInfo
 $start.FileName=Join-Path $target 'Yukino Companion.exe';$start.WorkingDirectory=$target
 $start.UseShellExecute=$false;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $start.Arguments='--user-data-dir="'+(Join-Path $profile 'Chromium')+'" --enable-logging=stderr --no-first-run --remote-debugging-port=0'
 $start.EnvironmentVariables['APPDATA']=$roaming;$start.EnvironmentVariables['LOCALAPPDATA']=$local
 Write-Host 'Native smoke: launch installed application'
 $installedApp=New-Object Diagnostics.Process;$installedApp.StartInfo=$start
 if(-not $installedApp.Start()){throw 'Installed application could not start'}
 $appStdout=$installedApp.StandardOutput.ReadToEndAsync();$appStderr=$installedApp.StandardError.ReadToEndAsync()
 $deadline=[DateTime]::UtcNow.AddSeconds(30)
 do{
  $installedApp.Refresh()
  if($installedApp.HasExited){throw 'Actual installed application exited during first launch'}
  if($installedApp.MainWindowTitle -match 'JavaScript|Uncaught|Exception'){throw 'Installed application opened a JavaScript error dialog'}
  if($installedApp.MainWindowHandle -ne 0 -and $installedApp.MainWindowTitle -eq 'Yukino Companion'){break}
  Start-Sleep -Milliseconds 150
 }while([DateTime]::UtcNow -lt $deadline)
 if($installedApp.MainWindowHandle -eq 0 -or $installedApp.MainWindowTitle -ne 'Yukino Companion'){throw 'Actual installed application did not show its main window'}
 Start-Sleep -Seconds 3
 $installedApp.Refresh()
 if($installedApp.HasExited -or $installedApp.MainWindowHandle -eq 0){throw 'Installed application did not remain running'}
 $appText=Capture $installedApp.MainWindowHandle 'app-first-launch'
 if($installedApp.MainWindowTitle -ne 'Yukino Companion' -or $appText -match 'JavaScript error|Uncaught Exception'){throw 'Installed application shows an error dialog'}
 Write-Host 'Native smoke: verify installed renderer'
 & node (Join-Path $root 'scripts/verify-installed-window.cjs') (Join-Path $profile 'Chromium')
 if($LASTEXITCODE -ne 0){throw 'The installed application did not render its bundled character'}
 if($VerifyCurrentFeatures){
  Write-Host 'Native smoke: verify current interface and companion'
  & node (Join-Path $root 'scripts/verify-current-window.cjs') (Join-Path $profile 'Chromium')
  if($LASTEXITCODE -ne 0){throw 'The installed character, desktop header or visual companion check failed'}
  $report.checks+='Installed rounded panel, contact list, fixed desktop header and visual companion shell checked on the running app'
 }
 [void](Capture $installedApp.MainWindowHandle 'app-character')
 $report.checks+='Actual installed main renderer loaded the default bundled character and completed a WebGL frame'
 Stop-InstalledApp
 $stderrFile=Join-Path $output 'app-first-launch.stderr.log'
 if((Test-Path -LiteralPath $stderrFile) -and (Get-Content -LiteralPath $stderrFile -Raw) -match 'A JavaScript error occurred|Uncaught Exception|Cannot find module|Uncaught (Error|TypeError|ReferenceError|SyntaxError)|UnhandledPromiseRejection|Error occurred in handler for ''character-model-data'''){throw 'Installed application logged an uncaught JavaScript error'}
 $report.checks+='Actual installed application launches with an isolated profile, displays its main window and stays alive; screenshot captured; no model download or inference requested'
 $sentinel=Join-Path $target 'my-personal-file.txt';[IO.File]::WriteAllText($sentinel,'keep me')
 Write-Host 'Native smoke: upgrade and reverify payload'
 Install $target $true
 if($PayloadManifest){
  & node (Join-Path $root 'scripts/base-payload.cjs') verify $target ([IO.Path]::GetFullPath((Join-Path $root $PayloadManifest)))
  if($LASTEXITCODE -ne 0){throw 'Installed payload does not match this build'}
  $report.checks+='Every installed application payload byte matches the candidate SHA-256 manifest'
 }
 if((Get-Content -LiteralPath $sentinel -Raw) -ne 'keep me'){throw 'Upgrade modified personal files'}
 $report.checks+='Recognized base-app upgrade preserves added personal files'
 $unknown=Join-Path $temporary 'unknown personal folder';[void][IO.Directory]::CreateDirectory($unknown);[IO.File]::WriteAllText((Join-Path $unknown 'personal.txt'),'untouched')
 Write-Host 'Native smoke: reject unknown directory and uninstall'
 Install $unknown $false
 if((Get-Content -LiteralPath (Join-Path $unknown 'personal.txt') -Raw) -ne 'untouched'){throw 'Unknown directory was modified'}
 $report.checks+='Unknown nonempty installation directory rejected'
 $uninstall=Get-ChildItem -LiteralPath $target -Filter 'unins*.exe'|Select-Object -First 1
 $child=Start-Process -FilePath $uninstall.FullName -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru
 if(-not $child.WaitForExit(120000)){$child.Kill();throw 'Uninstall timed out'}
 if($child.ExitCode -ne 0 -or (Test-Path -LiteralPath (Join-Path $target 'Yukino Companion.exe')) -or -not(Test-Path -LiteralPath $sentinel)){throw 'Uninstall did not preserve personal files'}
 $report.checks+='Uninstall removes owned application files and preserves added personal files'
 $report.passed=$true
}finally{
 try{Stop-InstalledApp}catch{Write-Warning $_.Exception.Message}
 if($visible){Stop-Process -Id $visible.Id -Force -ErrorAction SilentlyContinue}
 if($gui -and -not $gui.HasExited){Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue}
 $report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $output 'report.json') -Encoding utf8
 Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
