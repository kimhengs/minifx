# Downloads the pinned FFmpeg 7.1.1 build (GyanD essentials) and places
# ffmpeg.exe + ffprobe.exe next to MiniFX.exe. Safe to re-run.
param([string]$Dest)
$ErrorActionPreference = 'Stop'
if (-not $Dest) { $Dest = $PSScriptRoot }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$url = 'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip'
$sha = '04861D3339C5EBE38B56C19A15CF2C0CC97F5DE4FA8910E4D47E5E6404E4A2D4'
$tmp = Join-Path $env:TEMP ('minifx-ff-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp 'ff.zip'
  $ProgressPreference = 'SilentlyContinue'
  Write-Output 'Downloading FFmpeg 7.1.1 (~90 MB)...'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $sha) { throw 'FFmpeg checksum mismatch' }
  Write-Output 'Extracting...'
  Expand-Archive -Path $zip -DestinationPath $tmp
  foreach ($n in 'ffmpeg.exe', 'ffprobe.exe') {
    $f = Get-ChildItem $tmp -Recurse -Filter $n | Select-Object -First 1
    Copy-Item $f.FullName (Join-Path $Dest $n) -Force
  }
  Write-Output 'FFmpeg installed.'
  exit 0
} catch {
  Write-Output ("FFmpeg download failed: " + $_)
  exit 1
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
