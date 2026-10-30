. "$PSScriptRoot\paths.ps1"

$snapshot = Join-Path $LocalDbBackups "latest\data_public.sql"
if (-not (Test-Path $snapshot)) {
  $fallback = Get-ChildItem $LocalDbBackups -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if ($fallback) {
    $snapshot = Join-Path $fallback.FullName "data_public.sql"
  }
}

$env:PGPASSWORD = "postgres"
$env:PGSSLMODE = "disable"
$env:LOCAL_DB_PORT = "$LocalDbPort"
$env:LOCAL_REPAIR_TABLES = "clients,disciplines,locations,client_notes,organizations,schedule_groups,teachers"

if (Test-Path $snapshot) {
  Write-Host "Repair text from snapshot: $snapshot"
  foreach ($table in @("clients", "disciplines", "locations", "client_notes", "organizations", "schedule_groups", "teachers")) {
    $env:LOCAL_REPAIR_TABLES = $table
    & node "$PSScriptRoot\repair-text-from-snapshot.mjs" $snapshot
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Skipped table $table (repair error)."
    }
  }
} else {
  Write-Host "Snapshot missing; running WIN1251 fallback only."
  & (Join-Path $PgsqlBin "psql.exe") -h 127.0.0.1 -p $LocalDbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$PSScriptRoot\fix-mojibake-text-encoding.sql"
  if ($LASTEXITCODE -ne 0) { throw "fix-mojibake-text-encoding.sql failed" }
}

Remove-Item Env:PGPASSWORD, Env:PGSSLMODE, Env:LOCAL_DB_PORT, Env:LOCAL_REPAIR_TABLES -ErrorAction SilentlyContinue
Write-Host "Text encoding repair finished."
