param(
  [string]$AppRoot = "C:\tmp\CodexChromePatched"
)

$ErrorActionPreference = "Stop"

$codexExe = Join-Path $AppRoot "app\Codex.exe"
if (-not (Test-Path -LiteralPath $codexExe)) {
  throw "Missing patched Codex executable: $codexExe"
}

Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -ieq "Codex.exe" -and
    $_.ExecutablePath -and
    $_.ExecutablePath -notlike "$AppRoot*"
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
  }

Start-Process -FilePath $codexExe
Write-Host "Launched patched Codex: $codexExe"

