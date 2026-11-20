param(
  [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$OldVersion,
  [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$NewVersion
)
$ErrorActionPreference = 'Stop'
# This test installs the real product/registry ID. It belongs on a disposable hosted VM.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Real installer validation requires a GitHub-hosted Windows runner'
}
if ([version]$NewVersion -le [version]$OldVersion) { throw 'Expected a strictly increasing version' }
$install = Join-Path $env:RUNNER_TEMP 'Yukino upgrade acceptance'
$exe = Join-Path $install 'Yukino Companion.exe'
$profileNames = @('Yukino Companion','yukino-companion')
$profileCandidates = @($profileNames | ForEach-Object { Join-Path $env:APPDATA $_ })
if ((Test-Path -LiteralPath $install) -or @($profileCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count) {
  throw 'The runner must start with a clean installation and profile'
}

function Find-VerifiedInstaller([string]$Directory,[string]$Version) {
  $name = "Yukino-Companion-$Version-Base-Setup.exe"
  $candidates = @(Get-ChildItem -LiteralPath $Directory -Recurse -File -Filter $name)
  if ($candidates.Count -ne 1) { throw "Expected exactly one $name in the supplied assets" }
  $item = $candidates[0]
  $folder = $item.DirectoryName
  $sums = Get-Content -LiteralPath (Join-Path $folder "SHA256SUMS-$Version.txt")
  $records = @($sums |
    Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?' + [regex]::Escape($name) + '$') })
  if ($records.Count -ne 1) { throw "Missing or duplicate SHA-256 for $name" }
  $sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash
  if ($sha256 -ne $records[0].Substring(0,64)) { throw "SHA-256 mismatch for $name" }
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $folder 'latest.yml')
  $encoded = [Convert]::ToBase64String([Convert]::FromHexString((Get-FileHash -Algorithm SHA512 -LiteralPath $item.FullName).Hash))
  foreach ($record in @("version: $Version","path: $name","sha512: $encoded")) {
    if (!($manifest -csplit '\r?\n' -ccontains $record)) { throw "latest.yml does not describe $name" }
  }
  if ($Version -eq $NewVersion) {
    $mapRecords = @($sums | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?' + [regex]::Escape($name+'.blockmap') + '$') })
    if ($mapRecords.Count -ne 1 -or (Get-FileHash -Algorithm SHA256 -LiteralPath ($item.FullName+'.blockmap')).Hash -ne $mapRecords[0].Substring(0,64)) {
      throw 'Missing or incorrect candidate blockmap'
    }
    if ($env:CANDIDATE_SHA256 -and $env:CANDIDATE_SHA256 -ne $sha256) { throw 'Candidate differs from pinned local artifact' }
  }
  Write-Host "$name SHA-256 $sha256"
  return $item.FullName
}

function Install-PackageFile([string]$File,[string]$Arguments,[string]$Version) {
  # Wait on the installer itself. Start-Process -Wait would also wait on the
  # successfully relaunched desktop application and time out the job.
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  if (!$process.WaitForExit(300000)) { throw "NSIS timed out for $Version" }
  if ($process.ExitCode -ne 0) { throw "NSIS exited with code $($process.ExitCode) for $Version" }
  $installed = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  if ($installed -notmatch ('^'+[regex]::Escape($Version)+'(?:\.0)?$')) { throw "Found installed version $installed, expected $Version" }
}

function Wait-MainWindow([datetime]$Since) {
  $deadline = [datetime]::UtcNow.AddSeconds(90)
  do {
    $main = Get-Process -Name 'Yukino Companion' -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $exe -and $_.StartTime.ToUniversalTime() -ge $Since.AddSeconds(-1) -and
        $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'Yukino Companion' } | Select-Object -First 1
    if ($main) {
      Start-Sleep -Seconds 3
      $main.Refresh()
      if (!$main.HasExited -and $main.Responding -and $main.MainWindowTitle -eq 'Yukino Companion') { return $main }
    }
    Start-Sleep -Milliseconds 350
  } while ([datetime]::UtcNow -lt $deadline)
  throw 'Installed Electron application did not keep its main window open'
}

$old = Find-VerifiedInstaller (Join-Path $env:RUNNER_TEMP 'yukino-old-release') $OldVersion
$new = Find-VerifiedInstaller (Join-Path $env:RUNNER_TEMP 'yukino-candidate-release') $NewVersion
Install-PackageFile $old "/S /currentuser /D=$install" $OldVersion
$oldStart = [datetime]::UtcNow
$null = Start-Process -FilePath $exe -WorkingDirectory $install -WindowStyle Hidden -PassThru
$oldApp = Wait-MainWindow $oldStart
$profiles = @($profileCandidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'account/account.json') -PathType Leaf })
if ($profiles.Count -ne 1) { throw 'Could not identify the exact guest profile initialized by the previous version' }
$profile = $profiles[0]
$metaPath = Join-Path $profile 'account/account.json'
if ((Get-Content -Raw -LiteralPath $metaPath | ConvertFrom-Json).activeProfile -ne 'guest') { throw 'Expected a guest profile' }
# Stop the exact old process tree before modifying the test fixture.
$oldApp.Kill($true)
if (!$oldApp.WaitForExit(30000)) { throw 'Old application did not exit' }
$state = Join-Path $profile 'state.json'
$saved = if (Test-Path -LiteralPath $state) { Get-Content -Raw -LiteralPath $state | ConvertFrom-Json -AsHashtable } else { @{} }
$saved.accent = '#30657e'
$saved.activeConversation = 'upgrade-smoke'
$saved.conversations = @(@{id='upgrade-smoke'; characterId='yukino'; title='Upgrade smoke'; messages=@(@{id='message-1'; role='user'; content='preserve-upgrade-chat'})})
$saved | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $state -Encoding utf8NoBOM
$modelDir = Join-Path $install 'Yukino-Data/models'
New-Item -ItemType Directory -Force $modelDir | Out-Null
$model = Join-Path $modelDir 'custom.gguf'
[IO.File]::WriteAllText($model,'preserve-upgrade-model')
$profileStamp = (Get-Item -LiteralPath $metaPath).LastWriteTimeUtc

$newStart = [datetime]::UtcNow
Install-PackageFile $new "--updated /S --force-run /currentuser /D=$install" $NewVersion
# Only NSIS may start the updated app. Launching it here would hide a failed restart.
$newApp = Wait-MainWindow $newStart
if ((Get-Item -LiteralPath $metaPath).LastWriteTimeUtc -le $profileStamp) { throw 'Updated application did not initialize the old guest profile' }
$saved = Get-Content -Raw -LiteralPath $state | ConvertFrom-Json
$message = @($saved.conversations | Where-Object id -eq 'upgrade-smoke' | ForEach-Object messages | Where-Object id -eq 'message-1')
if ($message.Count -ne 1 -or $message[0].content -ne 'preserve-upgrade-chat' -or $saved.accent -ne '#30657e') { throw 'Guest chat or settings changed' }
if ([IO.File]::ReadAllText($model) -ne 'preserve-upgrade-model') { throw 'Existing local model changed' }
$cache = Join-Path $env:LOCALAPPDATA 'yukino-companion-updater'
foreach ($pair in @(@($new,'installer.exe'), @(($new+'.blockmap'),'current.blockmap'))) {
  if ((Get-FileHash -LiteralPath $pair[0]).Hash -ne (Get-FileHash -LiteralPath (Join-Path $cache $pair[1])).Hash) {
    throw "Cache did not retain matching release bytes for $($pair[1])"
  }
}
Write-Host "Verified original installers $OldVersion -> $NewVersion, restarted window PID $($newApp.Id), retained chat, settings and model."
