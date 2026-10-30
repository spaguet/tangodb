. "$PSScriptRoot\paths.ps1"

foreach ($d in @($LocalDbRoot, $LocalDbData, $LocalDbBackups, $LocalDbLogs, $LocalDbConfig, $LocalDbBin)) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

if (Test-Path (Join-Path $LocalDbData "PG_VERSION")) {
  Write-Host "Cluster already exists at $LocalDbData"
  exit 0
}

$initdb = Join-Path $PgsqlBin "initdb.exe"
& $initdb -D $LocalDbData -U postgres -E UTF8 --locale=C -L "C:\pgsql\share"

$conf = Join-Path $LocalDbData "postgresql.conf"
$content = [System.IO.File]::ReadAllText($conf)
$content = $content -replace "#port = 5432", "port = $LocalDbPort"
$content = $content -replace "#listen_addresses = 'localhost'", "listen_addresses = '127.0.0.1'"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($conf, $content, $utf8NoBom)

& (Join-Path $PSScriptRoot "start-postgres.ps1")

$env:PGPASSWORD = "postgres"
$env:PGSSLMODE = "disable"
& (Join-Path $PgsqlBin "psql.exe") -h 127.0.0.1 -p $LocalDbPort -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"
Remove-Item Env:PGPASSWORD, Env:PGSSLMODE -ErrorAction SilentlyContinue
Write-Host "Initialized $LocalDbData"
