param([string]$OutputDirectory='build/installer-update-review')
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$output=[IO.Path]::GetFullPath((Join-Path $project $OutputDirectory))
$runId=[Guid]::NewGuid().ToString('N')
$work=Join-Path $output $runId
[void][IO.Directory]::CreateDirectory($work)
$fixture=Join-Path $work 'payload';[void][IO.Directory]::CreateDirectory((Join-Path $fixture 'resources'))
[IO.File]::WriteAllText((Join-Path $fixture 'Yukino Companion.exe'),'fixture application v2')
[IO.File]::WriteAllText((Join-Path $fixture 'resources/app.asar'),'fixture app archive v2')
$appId='io.github.fqxxzyw.yukino.installer-check.'+$runId
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-base.iss'))
$source=$source.Replace('#define ProductAppId "io.github.fqxxzyw.yukino.base"',('#define ProductAppId "'+$appId+'"'))
$source=$source.Replace('Software\Yukino Companion\Base',('Software\Yukino Companion\InstallerChecks\'+$runId))
$source=$source.Replace('SetupIconFile={#AddBackslash(SourcePath)}..\branding\app-icon.ico',('SetupIconFile='+ (Join-Path $project 'branding/app-icon.ico')))
# Keep tests out of the user's desktop and Start menu.
$source=[regex]::Replace($source,'(?m)^Name: "\{auto(desktop|programs)\}[^\r\n]*','')
$sourcePath=Join-Path $work 'fixture.iss'
[IO.File]::WriteAllText($sourcePath,$source,(New-Object Text.UTF8Encoding($true)))
$compiler=Join-Path $project 'build/inno-setup/compiler/ISCC.exe'
for($attempt=0;$attempt -lt 2;$attempt++){
 & $compiler ('/DSOURCE_DIR='+$fixture) ('/DOUTPUT_DIR='+$work) ('/DCHINESE_MESSAGES='+(Join-Path $project 'build/inno-setup/ChineseSimplified.isl')) $sourcePath
 if($LASTEXITCODE -eq 0){break}
 # Windows virus scanning can briefly hold the freshly created PE resources.
 if($attempt -eq 0){Start-Sleep -Milliseconds 700}
}
if($LASTEXITCODE -ne 0){throw 'Native fixture did not compile'}
$installer=Join-Path $work 'Yukino-Companion-0.4.0-Base-Setup.exe'
$report=@{fixtureOnly=$true;checks=@();screenshots=@();passed=$false;work=$work}
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class InstallerUpdateWindow {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]public static extern bool EnumChildWindows(IntPtr h,EnumProc cb,IntPtr p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);
 public struct Rect{public int Left,Top,Right,Bottom;}
 public class Item{public IntPtr Handle;public string Text;public string ClassName;public bool Visible;public Rect Bounds;}
 public static List<Item> Children(IntPtr h){var a=new List<Item>();EnumChildWindows(h,(c,p)=>{var s=new StringBuilder(4096);GetWindowText(c,s,s.Capacity);var cl=new StringBuilder(256);GetClassName(c,cl,cl.Capacity);Rect r;GetWindowRect(c,out r);a.Add(new Item{Handle=c,Text=s.ToString(),ClassName=cl.ToString(),Visible=IsWindowVisible(c),Bounds=r});return true;},IntPtr.Zero);return a;}
}
'@
function Capture([IntPtr]$Window,[string]$Name){
 [void][InstallerUpdateWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
 $rect=New-Object InstallerUpdateWindow+Rect
 if(-not [InstallerUpdateWindow]::GetWindowRect($Window,[ref]$rect)){throw 'Missing native window bounds'}
 $bitmap=New-Object Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
 $graphics=[Drawing.Graphics]::FromImage($bitmap);$dc=$graphics.GetHdc()
 try{[void][InstallerUpdateWindow]::PrintWindow($Window,$dc,2)}finally{$graphics.ReleaseHdc($dc);$graphics.Dispose()}
 try{$bitmap.Save((Join-Path $work ($Name+'.png')),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
 $children=@([InstallerUpdateWindow]::Children($Window));$children|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $work ($Name+'.json')) -Encoding UTF8
 $report.screenshots+=$Name+'.png'
 return $children
}
function Click([IntPtr]$Window,[string]$Pattern){
 $button=[InstallerUpdateWindow]::Children($Window)|Where-Object{$_.Visible -and $_.ClassName -like '*Button*' -and $_.Text -match $Pattern}|Select-Object -First 1
 if(-not $button){throw ('Missing native button '+$Pattern)}
 [void][InstallerUpdateWindow]::SendMessage($button.Handle,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)
 Start-Sleep -Milliseconds 250
}
function Install([string]$Directory,[bool]$Expected){
 $child=Start-Process -FilePath $installer -WindowStyle Hidden -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',('/DIR="'+$Directory+'"'),('/LOG="'+(Join-Path $work ([IO.Path]::GetFileName($Directory)+'.log'))+'"')) -PassThru
 if(-not $child.WaitForExit(20000)){$child.Kill();throw 'Native fixture timed out'}
 if(($Expected -and $child.ExitCode -ne 0) -or (-not $Expected -and $child.ExitCode -eq 0)){throw ('Unexpected native fixture exit '+$child.ExitCode+' for '+$Directory)}
}
$gui=$null;$visible=$null;$installed=@()
try{
 $fresh=Join-Path $work 'fresh'
 $gui=Start-Process -FilePath $installer -WindowStyle Hidden -ArgumentList @('/SP-',('/DIR="'+$fresh+'"')) -PassThru
 $deadline=[DateTime]::UtcNow.AddSeconds(20)
 do{$visible=Get-Process|Where-Object{$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq '安装 Yukino Companion'}|Select-Object -First 1;if(-not $visible){Start-Sleep -Milliseconds 100}}while(-not $visible -and [DateTime]::UtcNow -lt $deadline)
 if(-not $visible){throw 'Native fixture window did not appear'}
 Start-Sleep -Milliseconds 300
 [void](Capture $visible.MainWindowHandle 'welcome')
 Click $visible.MainWindowHandle '^继续'
 [void](Capture $visible.MainWindowHandle 'directory')
 Click $visible.MainWindowHandle '^(安装|继续)'
 $deadline=[DateTime]::UtcNow.AddSeconds(20)
 do{$finished=[InstallerUpdateWindow]::Children($visible.MainWindowHandle)|Where-Object{$_.Visible -and $_.Text -like '安装完成，欢迎*'};if(-not $finished){Start-Sleep -Milliseconds 100}}while(-not $finished -and [DateTime]::UtcNow -lt $deadline)
 if(-not $finished){throw 'Native fixture did not reach finished page'}
 Start-Sleep -Milliseconds 300
 [void](Capture $visible.MainWindowHandle 'finished')
 $installed+=$fresh
 Stop-Process -Id $visible.Id -Force;$visible=$null
 if(-not $gui.HasExited){$gui.WaitForExit(5000)|Out-Null};$gui=$null
 $report.checks+='Current native Pascal script compiles; welcome, directory and finished pages captured at the unchanged system display scale'
 foreach($kind in @('base','bootstrap','nsis','unknown','invalid-marker')){
  $target=Join-Path $work $kind
  [void][IO.Directory]::CreateDirectory((Join-Path $target 'resources/local-model'))
  [void][IO.Directory]::CreateDirectory((Join-Path $target 'Yukino-Data/runtime'))
  [IO.File]::WriteAllText((Join-Path $target 'Yukino Companion.exe'),'fixture previous app')
  [IO.File]::WriteAllText((Join-Path $target 'resources/app.asar'),'fixture previous archive')
  $resources=@('Yukino-Data/runtime/python.exe','resources/local-model/model.gguf','personal.txt')
  foreach($file in $resources){[IO.File]::WriteAllText((Join-Path $target $file),('preserved '+$file))}
  switch($kind){
   'base'{[IO.File]::WriteAllText((Join-Path $target 'yukino-base-installation.ini'),('[Installation]'+[Environment]::NewLine+'AppId='+$appId))}
   'bootstrap'{[IO.File]::WriteAllText((Join-Path $target 'yukino-installation.json'),'{"schemaVersion":1,"appId":"io.github.fqxxzyw.yukino","files":["Yukino Companion.exe","resources/app.asar"]}')}
   'nsis'{[IO.File]::WriteAllText((Join-Path $target 'Uninstall Yukino Companion.exe'),'fixture old NSIS uninstaller')}
   'invalid-marker'{[IO.File]::WriteAllText((Join-Path $target 'yukino-installation.json'),'{"schemaVersion":1,"appId":"another.application","files":[],"note":"io.github.fqxxzyw.yukino"}')}
  }
  $recognized=$kind -in @('base','bootstrap','nsis')
  Install $target $recognized
  foreach($file in $resources){if([IO.File]::ReadAllText((Join-Path $target $file)) -cne ('preserved '+$file)){throw ('Update changed existing resource '+$file)}}
  if($recognized){
   $installed+=$target
   if([IO.File]::ReadAllText((Join-Path $target 'resources/app.asar')) -cne 'fixture app archive v2'){throw 'Existing app was not updated'}
   $report.checks+=($kind+' installation updates in place without prior registry registration; existing resource and personal bytes preserved')
  }else{
   if([IO.File]::ReadAllText((Join-Path $target 'resources/app.asar')) -cne 'fixture previous archive'){throw 'Unknown directory was modified'}
   $report.checks+=($kind+' nonempty directory rejected without modifying app or resource bytes')
  }
 }
 $report.passed=$true
}finally{
 if($visible){Stop-Process -Id $visible.Id -Force -ErrorAction SilentlyContinue}
 if($gui -and -not $gui.HasExited){Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue}
 foreach($directory in $installed){
  $uninstaller=Get-ChildItem -LiteralPath $directory -Filter 'unins*.exe'|Select-Object -First 1
  if($uninstaller){$child=Start-Process -FilePath $uninstaller.FullName -WindowStyle Hidden -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru;if(-not $child.WaitForExit(20000)){$child.Kill()}}
 }
 $report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $work 'report.json') -Encoding UTF8
}
$report|ConvertTo-Json -Depth 6
