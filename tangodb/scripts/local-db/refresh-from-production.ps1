. "$PSScriptRoot\paths.ps1"

$pw = $null
$tangodbRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
foreach ($l in Get-Content (Join-Path $tangodbRoot ".env.local")) {
  if ($l -like "SUPABASE_DB_PASSWORD=*") {
    $pw = $l.Substring("SUPABASE_DB_PASSWORD=".Length).Trim().Trim('"')
  }
}
if (-not $pw) { throw "SUPABASE_DB_PASSWORD missing in tangodb/.env.local" }

$env:PGPASSWORD = $pw
$env:PGSSLMODE = "require"
$dump = Join-Path $PgsqlBin "pg_dump.exe"
$ts = Get-Date -Format "yyyy-MM-dd_HHmm"
$out = Join-Path $LocalDbBackups $ts
New-Item -ItemType Directory -Force -Path $out | Out-Null
$hostName = "aws-1-ap-southeast-1.pooler.supabase.com"
$user = "postgres.gizfpiujqjwbjtqfstbj"
$common = @("-h", $hostName, "-p", "5432", "-U", $user, "-d", "postgres", "--no-owner", "--no-acl")

Write-Host "Dumping to $out ..."
& $dump @common --schema-only -n auth -f "$out\schema_auth.sql"
& $dump @common --schema-only -n public -f "$out\schema_public.sql"
& $dump @common --data-only --disable-triggers -t auth.users -t auth.identities -f "$out\data_auth.sql"
& $dump @common --data-only --disable-triggers -n public -f "$out\data_public.sql"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }

Remove-Item Env:PGPASSWORD, Env:PGSSLMODE -ErrorAction SilentlyContinue
Get-ChildItem $out | Format-Table Name, @{ N = "MB"; E = { [math]::Round($_.Length / 1MB, 2) } }
Write-Host "Snapshot: $out"
