. "$PSScriptRoot\paths.ps1"
$pgCtl = Join-Path $PgsqlBin "pg_ctl.exe"
if (-not (Test-Path (Join-Path $LocalDbData "PG_VERSION"))) {
  throw "Cluster missing. Run init-local-postgres.ps1 first."
}

New-Item -ItemType Directory -Force -Path $LocalDbLogs | Out-Null

$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $pgCtl -D $LocalDbData status | Out-Null
$alreadyRunning = ($LASTEXITCODE -eq 0)
if (-not $alreadyRunning) {
  & $pgCtl -D $LocalDbData -l (Join-Path $LocalDbLogs "postgres.log") start
  if ($LASTEXITCODE -ne 0) {
    $ErrorActionPreference = $prev
    throw "Failed to start Postgres. See $(Join-Path $LocalDbLogs 'postgres.log')"
  }
  Write-Host "Postgres started on port $LocalDbPort - $LocalDbUrl"
} else {
  Write-Host "Postgres already running on port $LocalDbPort - $LocalDbUrl"
}
$ErrorActionPreference = $prev
