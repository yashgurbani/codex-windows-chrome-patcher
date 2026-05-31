param(
  [string]$OutputRoot = "D:\CodexPatched",
  [string]$TargetRoot = "",
  [switch]$ForceRebuild,
  [switch]$NoLaunch,
  [switch]$NoCleanup,
  [switch]$NoShortcut,
  [switch]$NoConfig,
  [switch]$NoPaseo,
  [string]$ShortcutName = "Codex Patched",
  [string]$ShortcutLocations = "StartMenu",
  [switch]$SyncPluginCache,
  [switch]$RepairChromePlugin,
  [switch]$PatchBrowserClient,
  [switch]$NoSyncPluginCache,
  [switch]$NoRepairChromePlugin,
  [switch]$NoPatchBrowserClient
)

$ErrorActionPreference = "Stop"

function Find-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    return $node.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )

  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  throw "Node.js was not found on PATH or in standard install locations. Install Node.js or run this from a shell where node is available."
}

function Find-LatestCodexPackage {
  $appxPackages = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.InstallLocation -and
      (Test-Path -LiteralPath (Join-Path $_.InstallLocation "app\resources\app.asar"))
    } |
    Sort-Object Version -Descending

  $appxCandidate = $appxPackages | Select-Object -First 1
  if ($appxCandidate) {
    return $appxCandidate.InstallLocation
  }

  $windowsApps = "C:\Program Files\WindowsApps"
  if (-not (Test-Path -LiteralPath $windowsApps)) {
    throw "Missing WindowsApps directory: $windowsApps"
  }

  $candidate = Get-ChildItem -LiteralPath $windowsApps -Directory -Filter "OpenAI.Codex_*_x64__2p2nqsd0c76g0" -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "app\resources\app.asar") } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1

  if (-not $candidate) {
    throw "Could not find an installed OpenAI.Codex package via Get-AppxPackage or under $windowsApps"
  }
  return $candidate.FullName
}

function Get-CodexPackageVersion([string]$PackagePath) {
  $name = Split-Path -Leaf $PackagePath
  $match = [regex]::Match($name, "^OpenAI\.Codex_(.+?)_x64__2p2nqsd0c76g0$")
  if (-not $match.Success) {
    return "unknown"
  }
  return $match.Groups[1].Value
}

function Stop-CodexFromTarget([string]$Target) {
  if (-not $Target) { return }
  $resolvedTarget = $null
  if (Test-Path -LiteralPath $Target) {
    $resolvedTarget = (Resolve-Path -LiteralPath $Target).Path
  } else {
    $resolvedTarget = $Target
  }

  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -in @("Codex.exe", "codex.exe", "node_repl.exe", "extension-host.exe") -and
      $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($resolvedTarget, [System.StringComparison]::OrdinalIgnoreCase)
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force
    }
}

function Assert-SafeTarget([string]$Target, [string]$Root) {
  $fullTarget = [System.IO.Path]::GetFullPath($Target)
  $fullRoot = [System.IO.Path]::GetFullPath($Root)
  $windowsApps = [System.IO.Path]::GetFullPath("C:\Program Files\WindowsApps")
  $rootPrefix = $fullRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

  if ($fullTarget.StartsWith($windowsApps, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to patch or copy into WindowsApps: $fullTarget"
  }
  if ($fullTarget -ne $fullRoot -and -not $fullTarget.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to manage target outside OutputRoot. Target=$fullTarget OutputRoot=$fullRoot"
  }
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

function Remove-PatchScratchArtifacts {
  param(
    [string]$ScratchRoot = "C:\tmp"
  )

  if (-not (Test-Path -LiteralPath $ScratchRoot)) {
    return
  }

  $resolvedScratchRoot = (Resolve-Path -LiteralPath $ScratchRoot).Path
  $rootPrefix = $resolvedScratchRoot.TrimEnd("\", "/") + "\"
  $targets = @()
  $targets += Get-ChildItem -LiteralPath $resolvedScratchRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "codex-chrome-patch-*" }
  $targets += Get-ChildItem -LiteralPath $resolvedScratchRoot -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "codex-chrome-patched-*.asar" }

  $removedCount = 0
  foreach ($target in $targets) {
    $candidate = (Resolve-Path -LiteralPath $target.FullName).Path
    if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-Warning "Skipping scratch cleanup outside expected root: $candidate"
      continue
    }
    try {
      Remove-Item -LiteralPath $candidate -Recurse -Force -ErrorAction Stop
      $removedCount += 1
    } catch {
      Write-Warning "Skipping scratch cleanup for locked patch artifact: $candidate ($($_.Exception.Message))"
    }
  }

  if ($removedCount -gt 0) {
    Write-Host "Removed patch scratch artifacts: $removedCount"
  }
}

function Get-ShortcutPaths {
  param(
    [string]$Name,
    [string]$Locations
  )

  $safeName = $Name -replace '[\\/:*?"<>|]', '-'
  $paths = @()
  foreach ($location in ($Locations -split ",")) {
    $normalized = $location.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized -eq "none") {
      continue
    }

    switch ($normalized) {
      "startmenu" {
        $paths += Join-Path ([Environment]::GetFolderPath("Programs")) "$safeName.lnk"
      }
      "desktop" {
        $paths += Join-Path ([Environment]::GetFolderPath("Desktop")) "$safeName.lnk"
      }
      "both" {
        $paths += Join-Path ([Environment]::GetFolderPath("Programs")) "$safeName.lnk"
        $paths += Join-Path ([Environment]::GetFolderPath("Desktop")) "$safeName.lnk"
      }
      default {
        throw "Unknown shortcut location '$location'. Use StartMenu, Desktop, Both, None, or a comma-separated combination."
      }
    }
  }

  return $paths | Select-Object -Unique
}

function Set-DynamicPatchedCodexShortcut {
  param(
    [string]$Name,
    [string]$Locations,
    [string]$AutoPatcher,
    [string]$OutputRoot,
    [string]$TargetRoot,
    [string]$IconRoot
  )

  $shortcutPaths = Get-ShortcutPaths -Name $Name -Locations $Locations
  if (-not $shortcutPaths -or $shortcutPaths.Count -eq 0) {
    return
  }

  $powershell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = @(
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$AutoPatcher`"",
    "-OutputRoot", "`"$OutputRoot`"",
    "-PatchBrowserClient",
    "-SyncPluginCache",
    "-RepairChromePlugin"
  )
  if (-not [string]::IsNullOrWhiteSpace($TargetRoot)) {
    $arguments += @("-TargetRoot", "`"$TargetRoot`"")
  }

  $icon = Join-Path $IconRoot "app\Codex.exe"
  if (-not (Test-Path -LiteralPath $icon)) {
    $icon = "$env:WINDIR\System32\shell32.dll,220"
  } else {
    $icon = "$icon,0"
  }

  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in $shortcutPaths) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $shortcutPath) | Out-Null
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershell
    $shortcut.Arguments = ($arguments -join " ")
    $shortcut.WorkingDirectory = (Split-Path -Parent $AutoPatcher)
    $shortcut.IconLocation = $icon
    $shortcut.Description = "Patch and launch the newest Codex app copy with Chrome support enabled."
    $shortcut.Save()
    Write-Host "Updated dynamic shortcut: $shortcutPath"
  }
}

$node = Find-Node
$source = Find-LatestCodexPackage
$version = Get-CodexPackageVersion $source
$patchRevision = 7
$shouldPatchBrowserClient = -not $NoPatchBrowserClient
$shouldSyncPluginCache = -not $NoSyncPluginCache
$shouldRepairChromePlugin = -not $NoRepairChromePlugin
$targetRootWasExplicit = -not [string]::IsNullOrWhiteSpace($TargetRoot)

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
  $TargetRoot = Join-Path $OutputRoot "CodexChromePatched-$version-r$patchRevision-auto"
}

Assert-SafeTarget $TargetRoot $OutputRoot

$patcher = Join-Path $PSScriptRoot "patch-codex-chrome-windows.mjs"
$launcher = Join-Path $PSScriptRoot "launch-patched-codex.ps1"
$configurator = Join-Path $PSScriptRoot "configure-codex-memories.ps1"
$paseoConfigurator = Join-Path $PSScriptRoot "configure-paseo-codex-provider.ps1"
$paseoImportPatcher = Join-Path $PSScriptRoot "patch-paseo-codex-import.mjs"
if (-not (Test-Path -LiteralPath $patcher)) {
  throw "Missing patcher: $patcher"
}
if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Missing launcher: $launcher"
}
if (-not $NoConfig -and -not (Test-Path -LiteralPath $configurator)) {
  throw "Missing config helper: $configurator"
}

Write-Host "Latest Codex package: $source"
Write-Host "Patched target: $TargetRoot"

$patchMarker = Join-Path $TargetRoot ".codex-chrome-patcher.json"
$needsCopy = -not (Test-Path -LiteralPath (Join-Path $TargetRoot "app\resources\app.asar"))
if ($ForceRebuild -or $needsCopy) {
  Stop-CodexFromTarget $TargetRoot
  if (Test-Path -LiteralPath $TargetRoot) {
    Remove-Item -LiteralPath $TargetRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetRoot) | Out-Null
  Copy-Item -LiteralPath $source -Destination $TargetRoot -Recurse -Force
  Write-Host "Copied Codex package to patched target."
} else {
  Write-Host "Using existing patched target. Pass -ForceRebuild to rebuild it from the newest Store package."
}

$markerRevision = $null
if (Test-Path -LiteralPath $patchMarker) {
  try {
    $markerRevision = (Get-Content -LiteralPath $patchMarker -Raw | ConvertFrom-Json).patchRevision
  } catch {
    $markerRevision = $null
  }
}

$needsPatch = $ForceRebuild -or $needsCopy -or -not (Test-Path -LiteralPath $patchMarker) -or $markerRevision -ne $patchRevision
if ($needsPatch) {
  $patchArgs = @($patcher, "--app", $TargetRoot, "--apply", "--patch-exe-integrity")
  if ($shouldPatchBrowserClient) {
    $patchArgs += "--patch-browser-client"
  }

  & $node @patchArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to patch Codex app copy."
  }

  $marker = [ordered]@{
    source = $source
    version = $version
    target = $TargetRoot
    patchRevision = $patchRevision
    patchedAt = (Get-Date).ToString("o")
    patchBrowserClient = [bool]$shouldPatchBrowserClient
  }
  $marker | ConvertTo-Json | Set-Content -LiteralPath $patchMarker -Encoding UTF8
} else {
  Write-Host "Patch marker found. Skipping repatch for this Codex version."
}

if (-not $NoConfig) {
  powershell -NoProfile -ExecutionPolicy Bypass -File $configurator
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to configure Codex feature flags."
  }

  if (-not $NoPaseo) {
    if (Test-Path -LiteralPath $paseoConfigurator) {
      powershell -NoProfile -ExecutionPolicy Bypass -File $paseoConfigurator
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to configure Paseo Codex provider."
      }
    } else {
      Write-Warning "Skipping Paseo provider config because helper is missing: $paseoConfigurator"
    }

    if (Test-Path -LiteralPath $paseoImportPatcher) {
      & $node $paseoImportPatcher
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to patch Paseo Codex import support."
      }
    } else {
      Write-Warning "Skipping Paseo import patch because helper is missing: $paseoImportPatcher"
    }
  }
}

if (-not $NoShortcut) {
  $shortcutTargetRoot = ""
  if ($targetRootWasExplicit) {
    $shortcutTargetRoot = $TargetRoot
  }
  Set-DynamicPatchedCodexShortcut -Name $ShortcutName -Locations $ShortcutLocations -AutoPatcher $PSCommandPath -OutputRoot $OutputRoot -TargetRoot $shortcutTargetRoot -IconRoot $TargetRoot
}

if (-not $NoLaunch) {
  $launchArgs = @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $launcher, "-AppRoot", $TargetRoot)
  if ($NoCleanup) {
    $launchArgs += "-NoCleanup"
  }
  if ($shouldSyncPluginCache) {
    $launchArgs += "-SyncPluginCache"
  }
  if ($shouldRepairChromePlugin) {
    $launchArgs += "-RepairChromePlugin"
  }
  if ($shouldPatchBrowserClient) {
    $launchArgs += "-PatchBrowserClient"
  }
  powershell @launchArgs
} elseif (-not $NoCleanup) {
  Remove-OldPatchedCodexRoots -KeepRoot $TargetRoot -SearchRoots @($OutputRoot, "C:\tmp")
}

if (-not $NoCleanup) {
  Remove-PatchScratchArtifacts
}

Write-Host "Patched Codex is ready: $TargetRoot"
