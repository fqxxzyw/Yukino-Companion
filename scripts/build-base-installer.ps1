param([string]$SourceDirectory='build/base-app',[string]$OutputDirectory='release')
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
function Absolute([string]$Value){if(-not [IO.Path]::IsPathRooted($Value)){$Value=Join-Path $project $Value};return [IO.Path]::GetFullPath($Value)}
$SourceDirectory=Absolute $SourceDirectory; $OutputDirectory=Absolute $OutputDirectory
$toolRoot=Join-Path $project 'build/inno-setup'; [void][IO.Directory]::CreateDirectory($toolRoot)
function FetchVerified([string]$Url,[string]$Destination,[string]$Digest){
 if((Test-Path -LiteralPath $Destination -PathType Leaf) -and (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Digest){return}
 Invoke-WebRequest -Uri $Url -OutFile ($Destination+'.part') -TimeoutSec 300
 if((Get-FileHash -LiteralPath ($Destination+'.part') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Digest){throw 'Build dependency SHA-256 mismatch'}
 Move-Item -LiteralPath ($Destination+'.part') -Destination $Destination -Force
}
$setup=Join-Path $toolRoot 'innosetup-6.7.3.exe'
FetchVerified 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe' $setup '9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732'
$signature=Get-AuthenticodeSignature -LiteralPath $setup
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Pyrsys B\.V\.'){throw 'Unexpected Inno Setup signature'}
$compilerRoot=Join-Path $toolRoot 'compiler';$compiler=Join-Path $compilerRoot 'ISCC.exe'
if(-not(Test-Path -LiteralPath $compiler)){
 $child=Start-Process -FilePath $setup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/CURRENTUSER',('/DIR="'+$compilerRoot+'"')) -Wait -PassThru
 if($child.ExitCode -ne 0){throw 'Unable to prepare compiler'}
}
# ISCC's executable version resource is not the compiler-engine version contract.
# The installer above is pinned by SHA-256 and Authenticode; windows-base.iss
# additionally checks the actual ISPP/engine version during compilation.
if(-not(Test-Path -LiteralPath $compiler -PathType Leaf)){throw 'Inno Setup compiler was not installed'}
Write-Output ('Compiler metadata: ' + (Get-Item -LiteralPath $compiler).VersionInfo.FileVersion)
$messages=Join-Path $toolRoot 'ChineseSimplified.isl'
FetchVerified 'https://raw.githubusercontent.com/jrsoftware/issrc/is-6_7_3/Files/Languages/Unofficial/ChineseSimplified.isl' $messages '7d544b9bb1d142cfa11f2e5d3cc8abe2e55f8e066c5124e3772675aa236e1278'
foreach($file in @('Yukino Companion.exe','resources/app.asar','resources/runtime-catalog.json','resources/aria2/aria2c.exe')){if(-not(Test-Path -LiteralPath (Join-Path $SourceDirectory $file))){throw "Missing base application input: $file"}}
[void][IO.Directory]::CreateDirectory($OutputDirectory)
& $compiler '/Qp' "/DSOURCE_DIR=$SourceDirectory" "/DOUTPUT_DIR=$OutputDirectory" "/DCHINESE_MESSAGES=$messages" (Join-Path $PSScriptRoot 'windows-base.iss')
if($LASTEXITCODE -ne 0){throw 'Inno Setup compilation failed'}
$file=Get-Item -LiteralPath (Join-Path $OutputDirectory 'Yukino-Companion-0.4.0-Base-Setup.exe')
if($file.Length -lt 1MB -or $file.Length -gt 512MB){throw 'Unexpected base installer size'}
$report=@{schemaVersion=1;file=$file.Name;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant();compiler='Inno Setup 6.7.3';modelsEmbedded=$false;characterModelsEmbedded=$true;runtimeEmbedded=$false}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'base-installer.json') -Encoding utf8
$report | ConvertTo-Json
