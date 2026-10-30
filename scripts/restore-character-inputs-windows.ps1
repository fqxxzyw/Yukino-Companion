# Only for a disposable GitHub-hosted Windows runner: installation registers a
# temporary app with Windows, and is explicitly uninstalled on exit.
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or -not $env:RUNNER_TEMP){throw 'Use only on an isolated GitHub-hosted Windows runner.'}
$root=Split-Path $PSScriptRoot -Parent
$temp=Join-Path $env:RUNNER_TEMP ('yukino-model-restore-'+[Guid]::NewGuid().ToString('N'))
$installer=Join-Path $temp 'verified-previous-setup.exe'
$target=Join-Path $temp 'installed-app'
[void][IO.Directory]::CreateDirectory($temp)
try {
 $uri='https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-test.40913001300/Yukino-Companion-0.4.0-Base-Setup.exe'
 Invoke-WebRequest -Uri $uri -OutFile $installer -TimeoutSec 600
 $file=Get-Item -LiteralPath $installer
 if($file.Length -ne 258519106 -or (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne '9303829072f1e97eba172bf88f2c3e279312dae13a8879308142f7aae4ef0011'){throw 'Previous installer integrity mismatch'}
 $setup=Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/NOICONS',('/DIR="'+$target+'"')) -Wait -PassThru
 if($setup.ExitCode -ne 0){throw 'Previous installer failed on temporary runner'}
 $archive=Join-Path $target 'resources/app.asar'
 if(-not(Test-Path -LiteralPath $archive -PathType Leaf)){throw 'Previous installer did not provide app.asar'}
 & node (Join-Path $root 'scripts/restore-character-inputs.cjs') $archive
 if($LASTEXITCODE -ne 0){throw 'Pinned model recovery failed'}
} finally {
 $uninstaller=Join-Path $target 'unins000.exe'
 $cleanupFailed=$false
 if(Test-Path -LiteralPath $uninstaller){$uninstall=Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -Wait -PassThru;if($uninstall.ExitCode -ne 0){$cleanupFailed=$true}}
 if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Recurse -Force}
 if($cleanupFailed){throw 'Temporary runner uninstall failed.'}
}
