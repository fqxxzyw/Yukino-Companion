param(
  [Parameter(Mandatory=$true)][string]$Catalog,
  [Parameter(Mandatory=$true)][string]$SourceDirectory,
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$Extractor,
  [switch]$Headless,
  [switch]$Offline
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Windows.Forms
$script:cancelled = $false
$script:form = $null
$script:stage = $null
$script:archive = $null
$script:process = $null
$script:cts = New-Object System.Threading.CancellationTokenSource
$script:client = New-Object System.Net.Http.HttpClient
$script:client.Timeout = [TimeSpan]::FromHours(2)
$script:client.DefaultRequestHeaders.UserAgent.ParseAdd('Yukino-Companion-Setup/0.4.0')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Pump {
  [System.Windows.Forms.Application]::DoEvents()
  if ($script:cancelled) { $script:cts.Cancel(); throw '安装已取消。已下载的完整分卷会保留，方便下次继续。' }
}
function Await($Task) {
  while (-not $Task.IsCompleted) { Pump; Start-Sleep -Milliseconds 35 }
  return $Task.GetAwaiter().GetResult()
}
function Progress([string]$Text, [double]$Fraction = -1) {
  if ($script:form) {
    $script:label.Text = $Text
    if ($Fraction -lt 0) { $script:bar.Style = 'Marquee' }
    else { $script:bar.Style = 'Continuous'; $script:bar.Value = [Math]::Min(1000, [Math]::Max(0, [int]($Fraction * 1000))) }
  }
  Pump
}
function Hash([string]$File) {
  $stream = [IO.File]::OpenRead($File); $hash = [Security.Cryptography.SHA256]::Create()
  try {
    $buffer = New-Object byte[] (1024 * 1024)
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) { [void]$hash.TransformBlock($buffer, 0, $read, $buffer, 0); Pump }
    [void]$hash.TransformFinalBlock([byte[]]@(), 0, 0)
    return ([BitConverter]::ToString($hash.Hash)).Replace('-', '').ToLowerInvariant()
  } finally { $stream.Dispose(); $hash.Dispose() }
}
function Valid([string]$File, $Part) {
  return (Test-Path -LiteralPath $File -PathType Leaf) -and ((Get-Item -LiteralPath $File).Length -eq $Part.bytes) -and ((Hash $File) -eq $Part.digest)
}
$exitCode = 1
try {
  if (-not $Headless) {
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $script:form = New-Object System.Windows.Forms.Form
    $script:form.Text = '安装 Yukino Companion'
    $script:form.Size = New-Object Drawing.Size(540, 205)
    $script:form.StartPosition = 'CenterScreen'; $script:form.FormBorderStyle = 'FixedDialog'; $script:form.MaximizeBox = $false
    $script:label = New-Object System.Windows.Forms.Label
    $script:label.Location = New-Object Drawing.Point(22, 22); $script:label.Size = New-Object Drawing.Size(490, 48)
    $script:bar = New-Object System.Windows.Forms.ProgressBar
    $script:bar.Location = New-Object Drawing.Point(22, 76); $script:bar.Size = New-Object Drawing.Size(480, 22); $script:bar.Maximum = 1000
    $button = New-Object System.Windows.Forms.Button
    $button.Text = '取消'; $button.Location = New-Object Drawing.Point(412, 118)
    $button.Add_Click({ $script:cancelled = $true })
    $script:form.Add_FormClosing({ param($sender, $event) $event.Cancel = $true; $script:cancelled = $true })
    $script:form.Controls.AddRange(@($script:label, $script:bar, $button)); $script:form.Show()
  }
  $manifest = Get-Content -LiteralPath $Catalog -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.version -ne '0.4.0' -or $manifest.executable -ne 'Yukino Companion.exe' -or $manifest.archiveSha256 -notmatch '^[a-f0-9]{64}$' -or $manifest.parts.Count -lt 1) { throw '安装资源清单无效。' }
  $total = 0L; $index = 0
  foreach ($part in $manifest.parts) {
    $index++; $expected = 'Yukino-Companion-0.4.0-windows-x64.zip.part{0:d3}' -f $index
    $uri = [Uri]$part.url
    if ($part.path -cne $expected -or $part.algorithm -ne 'sha256' -or $part.digest -notmatch '^[a-f0-9]{64}$' -or $part.bytes -le 0 -or $part.bytes -gt 900MB -or $uri.Scheme -ne 'https' -or $uri.Host -ne 'github.com' -or -not $uri.AbsolutePath.StartsWith('/fqxxzyw/Yukino-Companion/releases/download/') -or -not $uri.AbsolutePath.EndsWith('/' + $expected)) { throw '安装分卷清单无效。' }
    $total += [long]$part.bytes
  }
  if ($total -ne $manifest.bytes -or $manifest.unpackedBytes -le 0) { throw '安装分卷大小不一致。' }
  $Target = [IO.Path]::GetFullPath($Target).TrimEnd('\')
  if ($Target -eq [IO.Path]::GetPathRoot($Target).TrimEnd('\') -or $Target -eq $env:USERPROFILE -or $Target -eq $env:LOCALAPPDATA -or $Target -eq $SourceDirectory) { throw '请选择独立的 Yukino Companion 安装文件夹。' }
  if ((Test-Path -LiteralPath $Target) -and @(Get-ChildItem -LiteralPath $Target -Force).Count -gt 0) {
    $oldMarker = Join-Path $Target 'yukino-installation.json'
    if (-not (Test-Path -LiteralPath $oldMarker) -or -not (Test-Path -LiteralPath (Join-Path $Target 'Yukino Companion.exe')) -or -not (Test-Path -LiteralPath (Join-Path $Target 'resources/app.asar'))) { throw '目标目录不是本安装器管理的应用目录，请选择新的空文件夹。' }
    $previous = Get-Content -LiteralPath $oldMarker -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($previous.appId -ne 'io.github.fqxxzyw.yukino' -or $previous.schemaVersion -ne 1 -or -not $previous.files) { throw '现有安装标记无效，请选择新的空文件夹。' }
    if (Get-ChildItem -LiteralPath $Target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw '现有目录含链接，请选择新的空文件夹。' }
    foreach ($existing in Get-ChildItem -LiteralPath $Target -Recurse -File -Force) {
      $relative = $existing.FullName.Substring($Target.Length + 1).Replace('\', '/')
      if ($relative -notin $previous.files) { throw '安装目录包含另外保存的文件。为保留这些文件，请选择新的空文件夹。' }
    }
  }
  $running = Get-Process -Name 'Yukino Companion' -ErrorAction SilentlyContinue
  if ($running) { throw '请先退出正在运行的 Yukino Companion，再重新安装。' }
  $cache = Join-Path $env:LOCALAPPDATA ('Yukino-Companion\installer-cache\' + $manifest.archiveSha256)
  [void][IO.Directory]::CreateDirectory($cache)
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Target))
  # Parts and the joined ZIP coexist in the cache; the extracted application
  # may be on another volume. Conservatively reserve all missing downloads.
  $missingBytes = 0L
  foreach ($part in $manifest.parts) {
    Progress ('正在检查分卷 ' + $part.path)
    if (-not (Valid (Join-Path $SourceDirectory $part.path) $part) -and -not (Valid (Join-Path $cache $part.path) $part)) { $missingBytes += [long]$part.bytes }
  }
  $cacheDrive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($cache))
  $targetDrive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Target))
  $cacheNeed = [long]$manifest.bytes + $missingBytes + 512MB
  $targetNeed = [long]$manifest.unpackedBytes + 512MB
  if ($cacheDrive.Name -eq $targetDrive.Name) {
    if ($cacheDrive.AvailableFreeSpace -lt ($cacheNeed + $targetNeed)) { throw '安装磁盘空间不足：需要同时保存分卷、组合 ZIP 和解压后的应用。' }
  } elseif ($cacheDrive.AvailableFreeSpace -lt $cacheNeed -or $targetDrive.AvailableFreeSpace -lt $targetNeed) { throw '下载缓存盘或安装目标盘空间不足，请腾出空间后重试。' }
  $paths = @(); $completed = 0L
  foreach ($part in $manifest.parts) {
    Progress ('正在校验分卷 ' + $part.path) ($completed / $total)
    $local = Join-Path $SourceDirectory $part.path; $cached = Join-Path $cache $part.path
    if (Valid $local $part) { $paths += $local }
    elseif (Valid $cached $part) { $paths += $cached }
    else {
      if ($Offline) { throw '离线安装缺少有效分卷，请把全部分卷放到安装器同目录。' }
      $partial = $cached + '.downloading'
      $response = Await ($script:client.GetAsync($part.url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $script:cts.Token))
      try {
        [void]$response.EnsureSuccessStatusCode()
        if ($response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -ne $part.bytes) { throw '服务器返回的分卷大小不符。' }
        $incoming = Await ($response.Content.ReadAsStreamAsync()); $outgoing = [IO.File]::Create($partial)
        try {
          $received = 0L; $buffer = New-Object byte[] (1024 * 1024)
          while (($read = (Await ($incoming.ReadAsync($buffer, 0, $buffer.Length, $script:cts.Token)))) -gt 0) {
            $received += $read; if ($received -gt $part.bytes) { throw '下载分卷超过清单大小。' }
            $outgoing.Write($buffer, 0, $read)
            Progress ('正在下载：{0:N1} / {1:N1} MB' -f (($completed + $received) / 1MB), ($total / 1MB)) (($completed + $received) / $total)
          }
        } finally { $outgoing.Dispose(); $incoming.Dispose() }
      } finally { $response.Dispose() }
      Progress ('正在校验已下载分卷 ' + $part.path) ($completed / $total)
      if (-not (Valid $partial $part)) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue; throw '下载分卷校验失败，请重试。' }
      Move-Item -LiteralPath $partial -Destination $cached -Force; $paths += $cached
    }
    $completed += [long]$part.bytes
  }
  $script:archive = Join-Path $cache 'application.zip'
  $combined = [IO.File]::Create($script:archive); $completed = 0L
  try {
    $buffer = New-Object byte[] (1024 * 1024)
    foreach ($partPath in $paths) {
      $incoming = [IO.File]::OpenRead($partPath)
      try { while (($read = $incoming.Read($buffer, 0, $buffer.Length)) -gt 0) { $combined.Write($buffer, 0, $read); $completed += $read; Progress '正在组合完整应用包…' ($completed / $total) } }
      finally { $incoming.Dispose() }
    }
  } finally { $combined.Dispose() }
  Progress '正在校验完整应用包…'
  if ((Hash $script:archive) -ne $manifest.archiveSha256) { throw '完整安装包校验失败，尚未解压或修改应用。' }
  $script:stage = $Target + '.installing-' + [Guid]::NewGuid().ToString('N')
  [void][IO.Directory]::CreateDirectory($script:stage)
  Progress '正在解压完整应用和内置模型…'
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $Extractor; $info.Arguments = 'x "' + $script:archive + '" -o"' + $script:stage + '" -y -bd'
  $info.UseShellExecute = $false; $info.CreateNoWindow = $true
  $script:process = [Diagnostics.Process]::Start($info)
  while (-not $script:process.HasExited) { Pump; Start-Sleep -Milliseconds 100 }
  if ($script:process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $script:stage $manifest.executable))) { throw '应用解压失败；现有安装未被修改。' }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall-app-payload.ps1') -Destination (Join-Path $script:stage 'uninstall-app-payload.ps1')
  $owned = @(Get-ChildItem -LiteralPath $script:stage -File -Recurse | ForEach-Object { $_.FullName.Substring($script:stage.Length + 1).Replace('\', '/') })
  $owned += @('Uninstall.exe', 'yukino-installation.json')
  @{schemaVersion=1;appId='io.github.fqxxzyw.yukino';version=$manifest.version;files=$owned} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $script:stage 'yukino-installation.json') -Encoding UTF8
  Pump
  $backup = $Target + '.previous-' + [Guid]::NewGuid().ToString('N')
  $hadPrevious = Test-Path -LiteralPath $Target
  if ($hadPrevious) { Move-Item -LiteralPath $Target -Destination $backup }
  try { Move-Item -LiteralPath $script:stage -Destination $Target; $script:stage = $null }
  catch { if ($hadPrevious) { Move-Item -LiteralPath $backup -Destination $Target }; throw }
  if ($hadPrevious) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue }
  $exitCode = 0
} catch {
  if ($script:cancelled) { $exitCode = 2 }
  if ($Headless) { [Console]::Error.WriteLine($_.Exception.Message) }
  else { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Yukino Companion 安装', 'OK', 'Information') }
} finally {
  if ($script:process) { try { if (-not $script:process.HasExited) { $script:process.Kill(); $script:process.WaitForExit() } } catch {} }
  if ($script:stage -and (Test-Path -LiteralPath $script:stage)) { Remove-Item -LiteralPath $script:stage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($script:archive) { Remove-Item -LiteralPath $script:archive -Force -ErrorAction SilentlyContinue }
  $script:client.Dispose(); $script:cts.Dispose()
  if ($script:form) { $script:form.Dispose() }
}
exit $exitCode
