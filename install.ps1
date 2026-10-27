# AI WorkStudio installer for Windows.
#
#   irm https://raw.githubusercontent.com/Lautaro005/workstudio/main/install.ps1 | iex
#
# Also install the family (brain, Lumina, OpenCue):
#   $env:WORKSTUDIO_WITH = "brain,lumina,opencue"; irm https://raw.githubusercontent.com/Lautaro005/workstudio/main/install.ps1 | iex
# Remove it (your data in ~\.workstudio stays):
#   $env:WORKSTUDIO_UNINSTALL = "1"; irm https://raw.githubusercontent.com/Lautaro005/workstudio/main/install.ps1 | iex
$ErrorActionPreference = "Stop"
$Repo = if ($env:WORKSTUDIO_REPO) { $env:WORKSTUDIO_REPO } else { "Lautaro005/workstudio" }
$BinDir = Join-Path $HOME ".local\bin"

function Say($m) { Write-Host "▸ $m" -ForegroundColor DarkYellow }
function Ok($m) { Write-Host "✓ $m" -ForegroundColor DarkGreen }

if ($env:WORKSTUDIO_UNINSTALL -eq "1") {
  $un = Get-ChildItem "$env:LOCALAPPDATA\AI WorkStudio" -Filter "uninstall.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($un) { Start-Process $un.FullName -ArgumentList "/S" -Wait }
  Remove-Item (Join-Path $BinDir "workstudio.cmd") -ErrorAction SilentlyContinue
  Ok "Removed AI WorkStudio. Your settings stay in $HOME\.workstudio"
  return
}

Write-Host ""
Write-Host "  AI WorkStudio — one workspace for your local AI apps" -ForegroundColor DarkRed
Write-Host ""
Say "Looking up the latest release"
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "Accept" = "application/vnd.github+json"; "User-Agent" = "workstudio-installer" }
$asset = $rel.assets | Where-Object { $_.name -match "x64-setup\.exe$" } | Select-Object -First 1
if (-not $asset) { throw "Release $($rel.tag_name) has no Windows installer yet." }

$tmp = Join-Path $env:TEMP "workstudio-setup.exe"
Say "Downloading AI WorkStudio $($rel.tag_name)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -UseBasicParsing
Get-Process workstudio -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process $tmp -ArgumentList "/S" -Wait
Remove-Item $tmp -ErrorAction SilentlyContinue

$exe = Get-ChildItem "$env:LOCALAPPDATA\AI WorkStudio", "$env:LOCALAPPDATA\Programs\AI WorkStudio" -Filter "workstudio.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$shim = Join-Path $BinDir "workstudio.cmd"
if ($exe) {
  Set-Content -Path $shim -Encoding ASCII -Value @"
@echo off
if "%~1"=="update" (powershell -NoProfile -Command "irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex" & exit /b)
if "%~1"=="" (start "" "$($exe.FullName)" & exit /b)
"$($exe.FullName)" %*
"@
}
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
  Say "Added $BinDir to your PATH (open a new terminal to use 'workstudio')"
}
Ok "Installed AI WorkStudio $($rel.tag_name)"

if ($env:WORKSTUDIO_WITH) {
  foreach ($app in $env:WORKSTUDIO_WITH.Split(",")) {
    switch ($app.Trim()) {
      "brain"   { Say "Installing brain";   irm https://raw.githubusercontent.com/Lautaro005/brain/main/install.ps1 | iex }
      "lumina"  { Say "Installing Lumina";  irm https://lautaro005.github.io/lumina/install.ps1 | iex }
      "opencue" { Say "Installing OpenCue"; irm https://lautaro005.github.io/opencue/install.ps1 | iex }
      default   { Say "Skipping unknown app: $app" }
    }
  }
}
if ($exe) { Start-Process $exe.FullName }
