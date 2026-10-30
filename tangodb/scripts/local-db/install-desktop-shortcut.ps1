$startScriptPath = (Resolve-Path (Join-Path $PSScriptRoot "Start-TangoDB-CRM.ps1")).Path
$workDirPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "TangoDB CRM (local).lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$startScriptPath`""
$shortcut.WorkingDirectory = $workDirPath
$shortcut.WindowStyle = 1
$shortcut.Description = "TangoDB CRM local laptop (Postgres on D:)"
$shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
$shortcut.Save()

Write-Host "Desktop shortcut: $lnkPath"
