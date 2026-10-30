. "$PSScriptRoot\paths.ps1"

$postgrestExe = Join-Path $LocalDbBin "postgrest.exe"
if (Test-Path $postgrestExe) {
  Write-Host "postgrest.exe already present"
  return
}

$asset = Invoke-RestMethod -Uri "https://api.github.com/repos/PostgREST/postgrest/releases/tags/v14.18"
$zipUrl = ($asset.assets | Where-Object { $_.name -eq "postgrest-v14.18-windows-x86-64.zip" }).browser_download_url
if (-not $zipUrl) { throw "PostgREST windows zip not found" }

$zipPath = Join-Path $env:TEMP "postgrest-v14.18-windows.zip"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $LocalDbBin -Force
Remove-Item $zipPath -Force
if (-not (Test-Path $postgrestExe)) {
  $nested = Get-ChildItem $LocalDbBin -Recurse -Filter "postgrest.exe" | Select-Object -First 1
  if ($nested) { Move-Item $nested.FullName $postgrestExe -Force }
}
if (-not (Test-Path $postgrestExe)) { throw "postgrest.exe missing after extract" }
Write-Host "Installed $postgrestExe"
