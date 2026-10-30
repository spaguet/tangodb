. "$PSScriptRoot\paths.ps1"
& (Join-Path $PgsqlBin "pg_ctl.exe") -D $LocalDbData stop
