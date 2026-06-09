# Baixa o rclone.exe para src-tauri\resources\.
$ErrorActionPreference = "Stop"
$dest = Join-Path $PSScriptRoot "..\src-tauri\resources\rclone.exe"
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null

# idempotente: se já existe, não refaz (deixa o build rápido)
if (Test-Path $dest) { Write-Output "rclone.exe já presente"; exit 0 }

# 1) winget local (rapido, sem rede)
$local = (Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Recurse -Filter rclone.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if ($local) {
  Copy-Item $local $dest -Force
  Write-Output ("copiado do winget: " + $local)
} else {
  # 2) download oficial (versao fixa p/ reprodutibilidade)
  $ver = "v1.74.3"
  $url = "https://downloads.rclone.org/$ver/rclone-$ver-windows-amd64.zip"
  $zip = Join-Path $env:TEMP "rclone-dl.zip"
  $tmp = Join-Path $env:TEMP "rclone-dl"
  Write-Output ("baixando " + $url)
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $exe = (Get-ChildItem $tmp -Recurse -Filter rclone.exe | Select-Object -First 1).FullName
  Copy-Item $exe $dest -Force
  Remove-Item $zip, $tmp -Recurse -Force
  Write-Output ("baixado: " + $url)
}
$f = Get-Item $dest
Write-Output ("rclone.exe pronto: {0:N1} MB" -f ($f.Length / 1MB))
