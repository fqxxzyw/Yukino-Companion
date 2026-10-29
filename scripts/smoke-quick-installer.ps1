$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$output=Join-Path $root 'build/quick-installer-review'
[void][IO.Directory]::CreateDirectory($output)
$temporary=Join-Path $env:RUNNER_TEMP ('Yukino-independent-'+[Guid]::NewGuid().ToString('N'))
$target=Join-Path $temporary 'Yukino Companion'
$profile=Join-Path $temporary 'profile'
$installer=Join-Path $root 'release/Yukino-Companion-0.4.0-Base-Setup.exe'
$report=@{source='3f7eb207d7bb15ede50bce1f9165da7778bc18e0';runId='40913001300';passed=$false;checks=@();error=''}
function Write-Report {$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $output 'report.json') -Encoding utf8}
function Record([string]$Message){$report.checks+=$Message;Write-Host $Message;Write-Report}
function Install([string]$Log){
 $child=Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',('/DIR="'+$target+'"'),('/LOG="'+$Log+'"')) -PassThru
 if(-not $child.WaitForExit(180000)){$child.Kill();throw 'Installer exceeded 180 seconds'}
 if($child.ExitCode -ne 0){throw "Installer exited with code $($child.ExitCode)"}
}
function Check-Renderer([string]$Script,[string]$Name){
 $out=Join-Path $output ($Name+'.stdout.log');$err=Join-Path $output ($Name+'.stderr.log')
 $node=(Get-Command node).Source
 $arguments=@(('"{0}"' -f $Script),('"{0}"' -f (Join-Path $profile 'Chromium')))
 $child=Start-Process -FilePath $node -ArgumentList $arguments -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
 if(-not $child.WaitForExit(120000)){$child.Kill();throw "$Name renderer verification exceeded 120 seconds"}
 if(Test-Path $out){Get-Content $out|ForEach-Object{Write-Host $_}}
 if(Test-Path $err){Get-Content $err|ForEach-Object{Write-Host $_}}
 if($child.ExitCode -ne 0){throw "$Name renderer verification exited with code $($child.ExitCode)"}
}
$app=$null
try{
 $identity=Get-Content -LiteralPath (Join-Path $root 'release/candidate-source.json') -Raw|ConvertFrom-Json
 if($identity.commit -ne $report.source -or $identity.runId -ne $report.runId -or (Get-Item $installer).Length -ne $identity.bytes -or (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $identity.sha256){throw 'Candidate source or installer digest mismatch'}
 Record 'Candidate source, installer length and SHA-256 match the published build record'
 Install (Join-Path $output 'install.log')
 & node (Join-Path $root 'scripts/base-payload.cjs') verify $target (Join-Path $root 'build/base-payload.json')
 if($LASTEXITCODE -ne 0){throw 'Installed payload digest verification failed'}
 Record 'Setup.exe installed; every installed payload file matches the recorded manifest'
 $exe=Join-Path $target 'Yukino Companion.exe';if(-not(Test-Path $exe)){throw 'Installed program missing'}
 $roaming=Join-Path $profile 'Roaming';$local=Join-Path $profile 'Local';[void][IO.Directory]::CreateDirectory($roaming);[void][IO.Directory]::CreateDirectory($local)
 $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=$exe;$start.WorkingDirectory=$target;$start.UseShellExecute=$false;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $start.Arguments='--user-data-dir="'+(Join-Path $profile 'Chromium')+'" --enable-logging=stderr --no-first-run --remote-debugging-port=0'
 $start.EnvironmentVariables['APPDATA']=$roaming;$start.EnvironmentVariables['LOCALAPPDATA']=$local
 $app=New-Object Diagnostics.Process;$app.StartInfo=$start;if(-not $app.Start()){throw 'Installed application did not start'}
 $appStdout=$app.StandardOutput.ReadToEndAsync();$appStderr=$app.StandardError.ReadToEndAsync();$deadline=[DateTime]::UtcNow.AddSeconds(45)
 do{$app.Refresh();if($app.HasExited){throw 'Installed application exited during startup'};if($app.MainWindowHandle -ne 0 -and $app.MainWindowTitle -eq 'Yukino Companion'){break};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $deadline)
 if($app.MainWindowHandle -eq 0 -or $app.MainWindowTitle -ne 'Yukino Companion'){throw 'Installed application main window did not appear'}
 Check-Renderer (Join-Path $root 'scripts/verify-installed-window.cjs') 'character'
 Record 'Installed application launched and rendered its transparent character and seven wardrobe entries'
 Check-Renderer (Join-Path $root 'scripts/verify-current-window.cjs') 'current-features'
 Record 'Installed clipboard, setup options, voice controls, contacts, desktop header and visual shell verified'
 $killer=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/taskkill.exe') -ArgumentList @('/PID',[string]$app.Id,'/T','/F') -PassThru -WindowStyle Hidden
 if(-not $killer.WaitForExit(15000)){$killer.Kill();throw 'Could not stop installed application'}
 if(-not $app.WaitForExit(15000)){throw 'Installed application did not exit'}
 if($appStdout.Wait(5000)){$appStdout.Result|Set-Content -LiteralPath (Join-Path $output 'app.stdout.log') -Encoding utf8}
 if($appStderr.Wait(5000)){$appStderr.Result|Set-Content -LiteralPath (Join-Path $output 'app.stderr.log') -Encoding utf8}
 $sentinel=Join-Path $target 'personal-sentinel.txt';[IO.File]::WriteAllText($sentinel,'preserve')
 Install (Join-Path $output 'upgrade.log');if((Get-Content -LiteralPath $sentinel -Raw) -ne 'preserve'){throw 'Upgrade changed the personal sentinel'}
 & node (Join-Path $root 'scripts/base-payload.cjs') verify $target (Join-Path $root 'build/base-payload.json')
 if($LASTEXITCODE -ne 0){throw 'Upgraded payload digest verification failed'}
 Record 'Upgrade retained a personal file and the installed payload still matches'
 $uninstall=Get-ChildItem -LiteralPath $target -Filter 'unins*.exe'|Select-Object -First 1;if(-not $uninstall){throw 'Uninstaller missing'}
 $child=Start-Process -FilePath $uninstall.FullName -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru
 if(-not $child.WaitForExit(120000)){$child.Kill();throw 'Uninstall exceeded 120 seconds'}
 if($child.ExitCode -ne 0 -or (Test-Path $exe) -or -not(Test-Path $sentinel)){throw 'Uninstall did not preserve the personal sentinel'}
 Record 'Uninstall removed application files and preserved the personal file'
 $report.passed=$true
}catch{$report.error=$_.Exception.Message;throw}finally{
 if($app){try{if(-not $app.HasExited){Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue}}catch{}}
 Write-Report
 Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
