# ======================================================================
# LocalBook packaging script
# Usage: powershell -File tools/package.ps1
# Output: LocalBook_v{version}_{date}.tar in project root
# ======================================================================

$ErrorActionPreference = 'Stop'

# Determine project root (parent of script directory)
$scriptPath = $MyInvocation.MyCommand.Path
if (-not $scriptPath) {
  $scriptPath = Join-Path (Get-Location) "tools\package.ps1"
}
$scriptDir = Split-Path -Parent $scriptPath
$projectRoot = Split-Path -Parent $scriptDir

# Read version from version.json
$json = [System.IO.File]::ReadAllText((Join-Path $projectRoot "version.json"), [System.Text.Encoding]::UTF8)
$version = (ConvertFrom-Json -InputObject $json).version

# Date string: YYYYMMDD
$date = Get-Date -Format "yyyyMMdd"

# Output file
$outputName = "LocalBook_v${version}_${date}.tar"
$parentDir = Split-Path -Parent $projectRoot
$outputPath = Join-Path $parentDir $outputName

Write-Host "Packaging LocalBook v${version} ..." -ForegroundColor Cyan

# Create tar archive (exclude previous archives, this script, Thumbs.db)
& tar -caf $outputPath --exclude=*.tar --exclude=tools/package.ps1 --exclude=Thumbs.db -C $projectRoot .

if ($LASTEXITCODE -eq 0) {
  $size = (Get-Item $outputPath).Length
  Write-Host "Done: $outputName ($([math]::Round($size / 1KB)) KB)" -ForegroundColor Green
} else {
  Write-Host "Failed to create package." -ForegroundColor Red
  exit 1
}
