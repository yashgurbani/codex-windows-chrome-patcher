param(
  [string]$OutputRoot = "",
  [switch]$Require
)

$ErrorActionPreference = "Stop"

function Get-SearchRoots {
  param([string]$PreferredRoot)

  $roots = @()
  if (-not [string]::IsNullOrWhiteSpace($PreferredRoot)) {
    $roots += $PreferredRoot
  }
  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_PATCHED_OUTPUT_ROOT)) {
    $roots += $env:CODEX_PATCHED_OUTPUT_ROOT
  }
  $roots += "D:\CodexPatched"
  $roots += "C:\tmp"
  return $roots | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
}

function Find-LatestPatchedCodexCli {
  param([string[]]$SearchRoots)

  $candidates = @()
  foreach ($root in $SearchRoots) {
    if (-not (Test-Path -LiteralPath $root)) {
      continue
    }

    $candidates += Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -like "CodexChromePatched*" -and
        (Test-Path -LiteralPath (Join-Path $_.FullName "app\resources\codex.exe"))
      } |
      Select-Object FullName, LastWriteTime
  }

  $latest = $candidates |
    Sort-Object LastWriteTime, FullName -Descending |
    Select-Object -First 1

  if (-not $latest) {
    return $null
  }

  return Join-Path $latest.FullName "app\resources\codex.exe"
}

$codexExe = Find-LatestPatchedCodexCli -SearchRoots (Get-SearchRoots -PreferredRoot $OutputRoot)
if (-not $codexExe -or -not (Test-Path -LiteralPath $codexExe)) {
  $message = "Could not find a patched Codex CLI under D:\CodexPatched or C:\tmp. Run scripts\auto-patch-codex.ps1 first."
  if ($Require) {
    throw $message
  }
  [Console]::Error.WriteLine($message)
  exit 1
}

(Resolve-Path -LiteralPath $codexExe).Path
