param(
  [string]$OutputRoot = "D:\CodexPatched",
  [switch]$ForceRebuild,
  [switch]$RepairChromePlugin
)

$ErrorActionPreference = "Stop"

$autoPatcher = Join-Path $PSScriptRoot "auto-patch-codex.ps1"
if (-not (Test-Path -LiteralPath $autoPatcher)) {
  throw "Missing automatic patcher: $autoPatcher"
}

$programPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = @(
  "-NoProfile",
  "-WindowStyle", "Hidden",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$autoPatcher`"",
  "-OutputRoot", "`"$OutputRoot`""
)

if ($ForceRebuild) {
  $arguments += "-ForceRebuild"
}
if ($RepairChromePlugin) {
  $arguments += "-RepairChromePlugin"
}

$startIn = Split-Path -Parent $autoPatcher

Write-Host "PowerToys Keyboard Manager remap values"
Write-Host ""
Write-Host "Trigger:"
Write-Host "  Win (Left) + Shift (Left) + F23"
Write-Host ""
Write-Host "Action:"
Write-Host "  Open app"
Write-Host ""
Write-Host "Program path:"
Write-Host "  $programPath"
Write-Host ""
Write-Host "Arguments:"
Write-Host "  $($arguments -join ' ')"
Write-Host ""
Write-Host "Start in directory:"
Write-Host "  $startIn"
Write-Host ""
Write-Host "Run as:"
Write-Host "  Normal"
Write-Host ""
Write-Host "If already running:"
Write-Host "  Start another"
Write-Host ""
Write-Host "Window visibility:"
Write-Host "  Hidden"
