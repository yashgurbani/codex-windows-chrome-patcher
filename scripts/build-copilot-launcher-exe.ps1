param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "launcher\CodexPatchedLauncher.cs"
if (-not (Test-Path -LiteralPath $source)) {
  throw "Missing launcher source: $source"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $repoRoot "bin\CodexPatchedLauncher.exe"
}

$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
  throw "Could not find csc.exe. Install .NET Framework developer tools or use the PowerShell shortcut path instead."
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null

& $csc /nologo /target:winexe /out:$OutputPath /reference:System.Windows.Forms.dll $source
if ($LASTEXITCODE -ne 0) {
  throw "Failed to build launcher exe."
}

Write-Host "Built launcher exe: $OutputPath"
Write-Host ""
Write-Host "PowerToys values:"
Write-Host "  Action: Open app"
Write-Host "  Program path: $OutputPath"
Write-Host "  Arguments: <leave blank>"
Write-Host "  Start in directory: $(Split-Path -Parent $OutputPath)"
Write-Host "  Run as: Normal"
Write-Host "  If already running: Start another"
Write-Host "  Window visibility: Hidden"
