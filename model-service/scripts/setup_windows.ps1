param(
    [ValidateSet('auto','cpu','cuda')][string]$Device='auto',
    [ValidateSet('auto','cu124','cu128')][string]$CudaBuild='auto'
)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Run-Python { & .\.venv\Scripts\python.exe @args; if ($LASTEXITCODE -ne 0) { throw 'Python command failed' } }
if (!(Test-Path .venv)) { py -3.11 -m venv .venv; if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.11 first' } }
Run-Python -m pip install --upgrade pip
$gpu = $Device -eq 'cuda'
if ($Device -eq 'auto' -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    & nvidia-smi --query-gpu=name --format=csv,noheader
    $gpu = $LASTEXITCODE -eq 0
}
$build = 'cpu'
$torchVersion = '2.6.0'
if ($gpu) {
    $build = if ($CudaBuild -eq 'auto') { 'cu124' } else { $CudaBuild }
    if ($CudaBuild -eq 'auto' -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
        $caps = & nvidia-smi --query-gpu=compute_cap --format=csv,noheader
        if ($LASTEXITCODE -eq 0) {
            foreach ($cap in $caps) {
                if ($cap.Trim() -match '^([0-9]+)\.' -and [int]$Matches[1] -ge 10) { $build = 'cu128' }
            }
        }
    }
    if ($build -eq 'cu128') { $torchVersion = '2.8.0' }
}
$index = 'https://download.pytorch.org/whl/' + $build
Run-Python -m pip install "torch==$torchVersion+$build" --index-url $index
Run-Python -m pip install -e '.[train]'
Run-Python -m yuki_model doctor
Write-Host 'Next: .\.venv\Scripts\python.exe -m yuki_model download'
