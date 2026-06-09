# Assina o sf-sync.exe na janela beforeBundle do Tauri.
$ErrorActionPreference = 'Stop'
$thumb = $env:SF_SIGN_THUMBPRINT
if (-not $thumb) { $thumb = '0D3CB1133F15D22115F7D531088A5BB514E9523F' }

$exe = Join-Path $PSScriptRoot '..\src-tauri\target\release\sf-sync.exe'
if (-not (Test-Path $exe)) { Write-Error "exe nao encontrado: $exe"; exit 1 }

$cert = Get-Item "Cert:\CurrentUser\My\$thumb" -ErrorAction SilentlyContinue
if (-not $cert) { Write-Error "cert $thumb nao esta em CurrentUser\My"; exit 1 }

$r = Set-AuthenticodeSignature -FilePath $exe -Certificate $cert `
        -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
Write-Host "[sign-exe] status=$($r.Status) -> $exe"
if ($r.Status -notin @('Valid','UnknownError')) { exit 1 }
