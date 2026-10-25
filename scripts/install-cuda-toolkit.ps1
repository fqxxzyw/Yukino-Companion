# CI-only: install the fixed NVIDIA build toolkit without a third-party cache wrapper.
# Package list and silent flags:
# https://docs.nvidia.com/cuda/archive/12.4.1/cuda-installation-guide-microsoft-windows/index.html
# Official corruption checksum:
# https://developer.download.nvidia.com/compute/cuda/12.4.1/docs/sidebar/md5sum.txt
$ErrorActionPreference = 'Stop'
$toolkit = Join-Path $env:ProgramFiles 'NVIDIA GPU Computing Toolkit\CUDA\v12.4'
$compiler = Join-Path $toolkit 'bin\nvcc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
  $directory = Join-Path $env:RUNNER_TEMP 'yukino-cuda-12.4.1'
  [void][IO.Directory]::CreateDirectory($directory)
  $installer = Join-Path $directory 'cuda_12.4.1_windows_network.exe'
  $url = 'https://developer.download.nvidia.com/compute/cuda/12.4.1/network_installers/cuda_12.4.1_windows_network.exe'
  Write-Output 'Downloading the official CUDA 12.4.1 network installer'
  Invoke-WebRequest -Uri $url -OutFile $installer -MaximumRetryCount 3 -RetryIntervalSec 5 -TimeoutSec 600
  if ((Get-FileHash -LiteralPath $installer -Algorithm MD5).Hash.ToLowerInvariant() -ne '8901c95cd9e20b8fc73fc76e96065d03') { throw 'CUDA installer does not match the fixed NVIDIA checksum' }
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'NVIDIA Corporation') { throw 'CUDA installer does not have a valid NVIDIA signature' }
  Write-Output 'Installing CUDA compiler, runtime, cuBLAS and Visual Studio integration'
  $process = Start-Process -FilePath $installer -ArgumentList @('-s','-n','nvcc_12.4','cudart_12.4','cublas_12.4','cublas_dev_12.4','visual_studio_integration_12.4') -PassThru -Wait -NoNewWindow
  if ($process.ExitCode -notin @(0,3010)) { throw "Official CUDA installer failed with exit code $($process.ExitCode)" }
}
foreach ($required in @('bin\nvcc.exe','include\cuda_runtime.h','include\cublas_v2.h','lib\x64\cublas.lib')) {
  if (-not (Test-Path -LiteralPath (Join-Path $toolkit $required) -PathType Leaf)) { throw "CUDA toolkit is incomplete: $required" }
}
$version = & $compiler --version
if ($LASTEXITCODE -ne 0 -or ($version -join "`n") -notmatch 'release 12\.4') { throw 'CUDA compiler version is not 12.4' }
$version | Write-Output
"CUDA_PATH=$toolkit" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"CUDA_PATH_V12_4=$toolkit" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"CUDACXX=$compiler" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
(Join-Path $toolkit 'bin') | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
