param(
  [string]$ConfigPath = "",
  [string]$CodexWrapperPath = "",
  [string]$CodexCommandPath = "",
  [string]$CodexHome = "",
  [switch]$UseWrapper,
  [switch]$NoBackup
)

$ErrorActionPreference = "Stop"

function Ensure-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)]$Object,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not $Object.PSObject.Properties[$Name]) {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue ([pscustomobject]@{})
  }
  if ($null -eq $Object.$Name) {
    $Object.$Name = [pscustomobject]@{}
  }
  return $Object.$Name
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value + [Environment]::NewLine, $encoding)
}

function Test-HasUtf8Bom {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    if ($stream.Length -lt 3) {
      return $false
    }
    $bytes = New-Object byte[] 3
    [void]$stream.Read($bytes, 0, 3)
    return $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  } finally {
    $stream.Dispose()
  }
}


if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $env:USERPROFILE ".paseo\config.json"
}
if ([string]::IsNullOrWhiteSpace($CodexWrapperPath)) {
  $CodexWrapperPath = Join-Path $PSScriptRoot "codex-patched-cli.cmd"
}
if ([string]::IsNullOrWhiteSpace($CodexHome)) {
  $CodexHome = Join-Path $env:USERPROFILE ".codex"
}

if ([string]::IsNullOrWhiteSpace($CodexCommandPath)) {
  if ($UseWrapper) {
    if (-not (Test-Path -LiteralPath $CodexWrapperPath)) {
      throw "Missing Codex wrapper: $CodexWrapperPath"
    }
    $CodexCommandPath = (Resolve-Path -LiteralPath $CodexWrapperPath).Path
  } else {
    $resolver = Join-Path $PSScriptRoot "resolve-patched-codex-cli.ps1"
    if (-not (Test-Path -LiteralPath $resolver)) {
      throw "Missing Codex CLI resolver: $resolver"
    }
    $CodexCommandPath = (& powershell -NoProfile -ExecutionPolicy Bypass -File $resolver -Require).Trim()
  }
}

if (-not (Test-Path -LiteralPath $CodexCommandPath)) {
  throw "Missing Codex command: $CodexCommandPath"
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  Write-Warning "Skipping Paseo Codex provider config because Paseo config does not exist: $ConfigPath"
  exit 0
}

$before = Get-Content -LiteralPath $ConfigPath -Raw
$config = $before | ConvertFrom-Json

$agents = Ensure-ObjectProperty -Object $config -Name "agents"
$providers = Ensure-ObjectProperty -Object $agents -Name "providers"

if (-not $providers.PSObject.Properties["codex"]) {
  $providers | Add-Member -NotePropertyName "codex" -NotePropertyValue ([pscustomobject]@{})
}

$codex = $providers.codex
$codex.command = @((Resolve-Path -LiteralPath $CodexCommandPath).Path)

if (-not $codex.PSObject.Properties["env"]) {
  $codex | Add-Member -NotePropertyName "env" -NotePropertyValue ([pscustomobject]@{})
}
if (-not $codex.env.PSObject.Properties["CODEX_HOME"]) {
  $codex.env | Add-Member -NotePropertyName "CODEX_HOME" -NotePropertyValue $CodexHome
} else {
  $codex.env.CODEX_HOME = $CodexHome
}

$after = $config | ConvertTo-Json -Depth 100
$hasUtf8Bom = Test-HasUtf8Bom -Path $ConfigPath
if (-not $hasUtf8Bom -and ($before.TrimEnd()) -eq ($after.TrimEnd())) {
  Write-Host "Paseo Codex provider already configured: $ConfigPath"
  exit 0
}

if (-not $NoBackup) {
  $backupPath = "$ConfigPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item -LiteralPath $ConfigPath -Destination $backupPath -Force
  Write-Host "Backup written: $backupPath"
}

Write-Utf8NoBom -Path $ConfigPath -Value $after
Write-Host "Configured Paseo Codex provider to use: $CodexCommandPath"
