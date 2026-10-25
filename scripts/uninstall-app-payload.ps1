param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
try {
  $Target = [IO.Path]::GetFullPath($Target).TrimEnd('\')
  $marker = Join-Path $Target 'yukino-installation.json'
  $installation = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($installation.appId -ne 'io.github.fqxxzyw.yukino' -or $installation.schemaVersion -ne 1 -or -not $installation.files -or -not (Test-Path -LiteralPath (Join-Path $Target 'Yukino Companion.exe'))) { throw '安装目录标记无效；没有删除任何文件。' }
  if (Get-ChildItem -LiteralPath $Target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw '安装目录含链接，请手动检查；没有删除任何文件。' }
  if (Get-Process -Name 'Yukino Companion' -ErrorAction SilentlyContinue) { throw '请先退出 Yukino Companion，再卸载。' }
  foreach ($name in $installation.files) {
    if ($name -isnot [string] -or $name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/') -or ($name.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' })) { throw '安装文件清单无效；没有删除任何文件。' }
  }
  # Delete only recorded application files. Personal files added to this folder
  # and all preferences/runtime downloads in the user profile remain untouched.
  foreach ($name in $installation.files) {
    if ($name -ne 'Uninstall.exe') {
      $file = Join-Path $Target $name
      if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
    }
  }
  Get-ChildItem -LiteralPath $Target -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
    if (@(Get-ChildItem -LiteralPath $_.FullName -Force).Count -eq 0) { Remove-Item -LiteralPath $_.FullName -Force }
  }
  exit 0
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Yukino Companion 卸载', 'OK', 'Information')
  exit 1
}
