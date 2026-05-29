param(
  [string]$AppRoot = "",
  [string]$OutputRoot = "D:\CodexPatched",
  [switch]$SyncPluginCache,
  [switch]$RepairChromePlugin,
  [int]$RemoteControlPort = 14567,
  [switch]$NoRemoteControl,
  [switch]$NoCleanup,
  [switch]$NoStop,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

function Find-LatestPatchedCodexRoot {
  param(
    [string[]]$SearchRoots
  )

  $candidates = @()
  foreach ($root in $SearchRoots) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root)) {
      continue
    }

    $candidates += Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -like "CodexChromePatched*" -and
        (Test-Path -LiteralPath (Join-Path $_.FullName "app\Codex.exe"))
      } |
      Select-Object FullName, LastWriteTime
  }

  $latest = $candidates |
    Sort-Object LastWriteTime, FullName -Descending |
    Select-Object -First 1

  if (-not $latest) {
    return $null
  }
  return $latest.FullName
}

function Test-HasRunningCodexProcess {
  param(
    [string]$Root
  )

  if ([string]::IsNullOrWhiteSpace($Root) -or -not (Test-Path -LiteralPath $Root)) {
    return $false
  }

  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  $processes = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -in @("Codex.exe", "codex.exe", "node_repl.exe", "extension-host.exe") -and
      $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)
    }

  return [bool]$processes
}

function Remove-OldPatchedCodexRoots {
  param(
    [string]$KeepRoot,
    [string[]]$SearchRoots
  )

  if ([string]::IsNullOrWhiteSpace($KeepRoot) -or -not (Test-Path -LiteralPath $KeepRoot)) {
    return
  }

  $resolvedKeep = (Resolve-Path -LiteralPath $KeepRoot).Path
  $removedCount = 0
  foreach ($root in $SearchRoots) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root)) {
      continue
    }

    $resolvedSearchRoot = (Resolve-Path -LiteralPath $root).Path
    $rootPrefix = $resolvedSearchRoot.TrimEnd("\", "/") + "\"
    Get-ChildItem -LiteralPath $resolvedSearchRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -like "CodexChromePatched*" -and
        (Test-Path -LiteralPath (Join-Path $_.FullName "app\Codex.exe"))
      } |
      ForEach-Object {
        $candidate = (Resolve-Path -LiteralPath $_.FullName).Path
        if ($candidate -eq $resolvedKeep) {
          return
        }
        if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
          Write-Warning "Skipping cleanup outside expected root: $candidate"
          return
        }
        if (Test-HasRunningCodexProcess $candidate) {
          Write-Warning "Skipping cleanup because Codex is still running from: $candidate"
          return
        }
        try {
          Remove-Item -LiteralPath $candidate -Recurse -Force -ErrorAction Stop
          $removedCount += 1
          Write-Host "Removed old patched Codex copy: $candidate"
        } catch {
          Write-Warning "Skipping cleanup for locked patched Codex copy: $candidate ($($_.Exception.Message))"
        }
      }
  }

  if ($removedCount -eq 0) {
    Write-Host "No old patched Codex copies removed."
  }
}

if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  $AppRoot = Find-LatestPatchedCodexRoot @($OutputRoot, "C:\tmp")
  if (-not $AppRoot) {
    throw "Could not find a patched Codex copy under '$OutputRoot' or 'C:\tmp'. Run scripts\auto-patch-codex.ps1 first."
  }
  Write-Host "Selected latest patched Codex: $AppRoot"
}

$codexExe = Join-Path $AppRoot "app\Codex.exe"
if (-not (Test-Path -LiteralPath $codexExe)) {
  $latest = Find-LatestPatchedCodexRoot @($OutputRoot, "C:\tmp")
  $hint = if ($latest) { " Latest detected patched copy: $latest" } else { "" }
  throw "Missing patched Codex executable: $codexExe.$hint"
}

$resolvedAppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
$knownCodexRoots = @(
  "C:\tmp\CodexChromePatched*",
  "D:\CodexPatched\CodexChromePatched*",
  "$OutputRoot\CodexChromePatched*",
  "$env:LOCALAPPDATA\OpenAI\Codex*",
  "C:\Program Files\WindowsApps\OpenAI.Codex_*"
)

if (-not $NoStop) {
  Get-CimInstance Win32_Process |
    Where-Object {
      $processPath = $_.ExecutablePath
      $_.Name -in @("Codex.exe", "codex.exe", "node_repl.exe") -and
      $processPath -and
      ($knownCodexRoots | Where-Object { $processPath -like $_ })
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force
    }

  $bundledPluginCache = Join-Path $env:USERPROFILE ".codex\plugins\cache\openai-bundled"
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -ieq "extension-host.exe" -and
      $_.ExecutablePath -and
      $_.ExecutablePath -like "$bundledPluginCache*"
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force
    }
}

$patcher = Join-Path $PSScriptRoot "patch-codex-chrome-windows.mjs"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($SyncPluginCache -and $node -and (Test-Path -LiteralPath $patcher)) {
  & $node.Source $patcher --app $resolvedAppRoot --cache-only --apply --patch-user-plugin-cache
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to patch Codex browser plugin cache."
  }
} elseif ($SyncPluginCache) {
  Write-Warning "Skipping browser plugin cache patch because node or patch-codex-chrome-windows.mjs was not found."
}

if ($RepairChromePlugin) {
  $repairer = Join-Path $PSScriptRoot "reinstall-chrome-plugin.mjs"
  if ($node -and (Test-Path -LiteralPath $repairer)) {
    & $node.Source $repairer --app $resolvedAppRoot --plugin chrome
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to reinstall the Codex Chrome plugin."
    }
  } else {
    throw "Cannot repair Chrome plugin because node or reinstall-chrome-plugin.mjs was not found."
  }
}

if (-not $NoCleanup) {
  Remove-OldPatchedCodexRoots -KeepRoot $resolvedAppRoot -SearchRoots @($OutputRoot, "C:\tmp")
}

$env:CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE = "1"
if ($NoLaunch) {
  Write-Host "Patched Codex launch target is valid: $codexExe"
} else {
  Start-Process -FilePath $codexExe
  Write-Host "Launched patched Codex: $codexExe"

  if (-not $NoRemoteControl) {
    $remoteControlLauncher = Join-Path $PSScriptRoot "start-codex-remote-control.ps1"
    if (Test-Path -LiteralPath $remoteControlLauncher) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $remoteControlLauncher -AppRoot $resolvedAppRoot -OutputRoot $OutputRoot -Port $RemoteControlPort
      if ($LASTEXITCODE -ne 0) {
        Write-Warning "Patched Codex launched, but remote control did not connect. Run scripts\start-codex-remote-control.ps1 -Status for details."
      }
    } else {
      Write-Warning "Skipping remote control because helper is missing: $remoteControlLauncher"
    }
  }
}
