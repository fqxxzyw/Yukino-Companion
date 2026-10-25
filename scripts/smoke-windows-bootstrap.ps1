# A real Windows installer smoke with tiny fake application files, never released.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$temporary = Join-Path $env:RUNNER_TEMP ('Yukino 安装测试 ' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $temporary 'fixture'
$target = Join-Path $temporary '中文目录\Yukino Companion'
$unknown = Join-Path $temporary 'existing personal folder'
$report = @{schemaVersion=1;fixtureOnly=$true;passed=$false;checks=@()}
function Invoke-FixtureInstall([string]$Destination, [bool]$Success) {
  $extractor = node -p "require('7zip-bin').path7za"
  $stdout = Join-Path $temporary 'installer.stdout.log'; $stderr = Join-Path $temporary 'installer.stderr.log'
  $arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $root 'scripts/install-app-payload.ps1') + '"'),'-Catalog',('"' + (Join-Path $root 'release/app-payload.json') + '"'),'-SourceDirectory',('"' + (Join-Path $root 'release') + '"'),'-Target',('"' + $Destination + '"'),'-Extractor',('"' + $extractor + '"'),'-Headless','-Offline')
  $child = Start-Process powershell -ArgumentList $arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $code = $child.ExitCode; $log = Get-Content -LiteralPath $stderr -Raw
  if (($Success -and $code -ne 0) -or (-not $Success -and $code -eq 0)) { throw "Unexpected fixture installer result $code : $log" }
}
try {
  foreach ($script in @('install-app-payload.ps1','uninstall-app-payload.ps1','smoke-windows-bootstrap.ps1')) {
    $tokens=$null; $parseErrors=$null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $root ('scripts/' + $script)), [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw "PowerShell syntax error: $parseErrors" }
  }
  $report.checks += 'PowerShell scripts parse on Windows'
  [void][IO.Directory]::CreateDirectory((Join-Path $source 'resources'))
  [IO.File]::WriteAllBytes((Join-Path $source 'Yukino Companion.exe'), [Text.Encoding]::UTF8.GetBytes('MZ fixture only'))
  [IO.File]::WriteAllText((Join-Path $source 'resources/app.asar'), 'fixture only')
  $noise = New-Object byte[] 16000; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($noise)
  [IO.File]::WriteAllBytes((Join-Path $source 'resources/model.gguf'), $noise)
  python scripts/package-app-payload.py --source $source --output release --tag v0.4.0-fixture --part-bytes 1024
  if ($LASTEXITCODE -ne 0) { throw 'Fixture packaging failed' }
  node scripts/build-bootstrap.cjs
  if ($LASTEXITCODE -ne 0) { throw 'NSIS fixture compilation failed' }
  node scripts/verify-release-assets.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Fixture PE/payload validation failed' }
  $report.checks += 'NSIS compiles a real PE with the verified multipart fixture'
  Invoke-FixtureInstall $target $true
  $installed = [IO.File]::ReadAllBytes((Join-Path $target 'resources/model.gguf'))
  if ([Convert]::ToBase64String($installed) -cne [Convert]::ToBase64String($noise)) { throw 'Installed fixture bytes differ' }
  $report.checks += 'Offline parts install into a Chinese path with identical bytes'
  [void][IO.Directory]::CreateDirectory($unknown)
  [IO.File]::WriteAllText((Join-Path $unknown 'personal.txt'),'keep me')
  Invoke-FixtureInstall $unknown $false
  if ((Get-Content (Join-Path $unknown 'personal.txt') -Raw) -ne 'keep me') { throw 'Unknown directory was modified' }
  $report.checks += 'Unknown populated directory is rejected and preserved'
  [IO.File]::WriteAllText((Join-Path $target 'personal.txt'),'keep me too')
  Invoke-FixtureInstall $target $false
  if ((Get-Content (Join-Path $target 'personal.txt') -Raw) -ne 'keep me too') { throw 'Additional user file was modified' }
  $report.checks += 'Update with additional personal files is rejected'
  $catalog = Get-Content release/app-payload.json -Raw | ConvertFrom-Json
  $first = Join-Path $root ('release/' + $catalog.parts[0].path)
  $bytes = [IO.File]::ReadAllBytes($first); $bytes[0] = $bytes[0] -bxor 255; [IO.File]::WriteAllBytes($first,$bytes)
  $badTarget = Join-Path $temporary 'corrupt must not install'
  Invoke-FixtureInstall $badTarget $false
  if (Test-Path -LiteralPath (Join-Path $badTarget 'Yukino Companion.exe')) { throw 'Corrupted payload was installed' }
  $report.checks += 'A tampered part is rejected before extraction; offline mode does not fetch a replacement'
  & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/uninstall-app-payload.ps1 -Target $target
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $target 'personal.txt')) -or (Test-Path -LiteralPath (Join-Path $target 'Yukino Companion.exe'))) { throw 'Uninstaller did not preserve the added personal file' }
  $report.checks += 'Uninstaller removes only owned files and preserves the personal file'
  $report.passed=$true
} finally {
  New-Item -ItemType Directory -Force build/bootstrap-review | Out-Null
  $report | ConvertTo-Json -Depth 5 | Set-Content build/bootstrap-review/report.json -Encoding UTF8
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  # The fixture EXE and fake model parts never become release artifacts.
  Remove-Item release -Recurse -Force -ErrorAction SilentlyContinue
}
