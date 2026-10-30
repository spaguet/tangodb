param(
  [Parameter(Mandatory = $true)]
  [string]$SnapshotDir
)

. "$PSScriptRoot\paths.ps1"

$psql = Join-Path $PgsqlBin "psql.exe"
$env:PGPASSWORD = "postgres"
$env:PGSSLMODE = "disable"

function Sanitize-SqlFile([string]$path) {
  $san = $path + ".san.sql"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  $reader = New-Object System.IO.StreamReader($path, $utf8NoBom, $true)
  $writer = New-Object System.IO.StreamWriter($san, $false, $utf8NoBom)
  try {
    while ($null -ne ($line = $reader.ReadLine())) {
      if ($line -match '^\\restrict') { continue }
      if ($line -match '^\\unrestrict') { continue }
      if ($line -match '^SET transaction_timeout') { continue }
      if ($line -match '^CREATE SCHEMA (public|auth);') { continue }
      $writer.WriteLine($line)
    }
  } finally {
    $reader.Close()
    $writer.Close()
  }
  return $san
}

& $psql -h 127.0.0.1 -p $LocalDbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c @"
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
"@

& $psql -h 127.0.0.1 -p $LocalDbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$PSScriptRoot\supabase-roles.sql"

& $psql -h 127.0.0.1 -p $LocalDbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS auth; GRANT USAGE ON SCHEMA auth TO postgres;"

& $psql -h 127.0.0.1 -p $LocalDbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$PSScriptRoot\extensions-local.sql"

foreach ($name in @("schema_auth.sql", "schema_public.sql", "data_auth.sql", "data_public.sql")) {
  $src = Join-Path $SnapshotDir $name
  if (-not (Test-Path $src)) { throw "Missing $src" }
  $f = Sanitize-SqlFile $src
  Write-Host "restore $name..."
  & $psql -h 127.0.0.1 -p $LocalDbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -f $f
  if ($LASTEXITCODE -ne 0) { throw "restore failed: $name" }
}

& $psql -h 127.0.0.1 -p $LocalDbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c @"
GRANT USAGE ON SCHEMA auth TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
"@

Write-Host "Repairing text columns from snapshot UTF-8..."
foreach ($table in @("clients", "disciplines", "locations", "client_notes", "organizations", "schedule_groups", "teachers")) {
  $env:LOCAL_REPAIR_TABLES = $table
  & node "$PSScriptRoot\repair-text-from-snapshot.mjs" (Join-Path $SnapshotDir "data_public.sql")
}
Remove-Item Env:LOCAL_REPAIR_TABLES -ErrorAction SilentlyContinue

Remove-Item Env:PGPASSWORD, Env:PGSSLMODE -ErrorAction SilentlyContinue
Write-Host "Done. DATABASE_URL=$LocalDbUrl"
