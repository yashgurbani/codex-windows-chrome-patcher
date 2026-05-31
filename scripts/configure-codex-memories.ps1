param(
  [string]$ConfigPath = (Join-Path $env:USERPROFILE ".codex\config.toml")
)

$ErrorActionPreference = "Stop"

$configDir = Split-Path -Parent $ConfigPath
if (-not (Test-Path -LiteralPath $configDir)) {
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null
}

$text = ""
if (Test-Path -LiteralPath $ConfigPath) {
  $text = Get-Content -LiteralPath $ConfigPath -Raw
}

$originalText = $text

$featureBlock = @"
[features]
apps = true
memories = true
plugins = true
browser_use = true
browser_use_external = true
computer_use = true
in_app_browser = true
tool_search = true
tool_suggest = true
tool_call_mcp_elicitation = true
multi_agent = true
goals = true
workspace_dependencies = false
js_repl = false
"@

$memoryBlock = @"
[memories]
generate_memories = true
use_memories = true
disable_on_external_context = false
"@

function Set-TomlSection {
  param(
    [string]$Text,
    [string]$Name,
    [string]$Block
  )

  $pattern = "(?ms)^\[$([regex]::Escape($Name))\]\s*.*?(?=^\[|\z)"
  $replacement = $Block.TrimEnd()
  if ($Text -match $pattern) {
    return [regex]::Replace($Text, $pattern, "$replacement`r`n`r`n")
  }

  $updated = $Text
  if ($updated.Length -gt 0 -and -not $updated.EndsWith("`n")) {
    $updated += "`r`n"
  }
  if ($updated.Length -gt 0 -and -not $updated.EndsWith("`r`n`r`n")) {
    $updated += "`r`n"
  }
  return "$updated$replacement`r`n"
}

function Set-TomlTopLevelValue {
  param(
    [string]$Text,
    [string]$Key,
    [string]$Value
  )

  $escapedKey = [regex]::Escape($Key)
  $firstSection = [regex]::Match($Text, "(?m)^\[")
  if ($firstSection.Success) {
    $prefix = $Text.Substring(0, $firstSection.Index)
    $suffix = $Text.Substring($firstSection.Index)
  } else {
    $prefix = $Text
    $suffix = ""
  }

  $line = "$Key = $Value"
  if ($prefix -match "(?m)^$escapedKey\s*=") {
    $prefix = [regex]::Replace($prefix, "(?m)^$escapedKey\s*=.*$", $line)
  } else {
    if ($prefix.Length -gt 0 -and -not $prefix.EndsWith("`n")) {
      $prefix += "`r`n"
    }
    $prefix += "$line`r`n"
  }

  return "$prefix$suffix"
}

$text = Set-TomlTopLevelValue -Text $text -Key "web_search" -Value '"live"'
$text = Set-TomlSection -Text $text -Name "features" -Block $featureBlock
$text = Set-TomlSection -Text $text -Name "memories" -Block $memoryBlock

if ($text -eq $originalText) {
  Write-Host "Codex live search, features, and memories already configured in: $ConfigPath"
  exit 0
}

$backup = $null
if (Test-Path -LiteralPath $ConfigPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = "$ConfigPath.bak-$stamp"
  Copy-Item -LiteralPath $ConfigPath -Destination $backup -Force
}

Set-Content -LiteralPath $ConfigPath -Value $text -Encoding UTF8

Write-Host "Configured Codex live search, features, and memories in: $ConfigPath"
if ($backup) {
  Write-Host "Backup: $backup"
}
