param(
  [string]$ShortcutPath = "",
  [string]$ShortcutName = "Codex Patched",
  [string]$ShortcutLocations = "StartMenu",
  [string]$OutputRoot = "D:\CodexPatched",
  [string]$TargetRoot = "",
  [switch]$ForceRebuild,
  [switch]$RepairChromePlugin,
  [switch]$NoRepairChromePlugin
)

$ErrorActionPreference = "Stop"

$autoPatcher = Join-Path $PSScriptRoot "auto-patch-codex.ps1"
if (-not (Test-Path -LiteralPath $autoPatcher)) {
  throw "Missing automatic patcher: $autoPatcher"
}

function Get-ShortcutPaths {
  param(
    [string]$Path,
    [string]$Name,
    [string]$Locations
  )

  if (-not [string]::IsNullOrWhiteSpace($Path)) {
    return @($Path)
  }

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

function Find-LatestInstalledCodexRoot {
  $appxPackages = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.InstallLocation -and
      (Test-Path -LiteralPath (Join-Path $_.InstallLocation "app\Codex.exe"))
    } |
    Sort-Object Version -Descending

  $appxCandidate = $appxPackages | Select-Object -First 1
  if ($appxCandidate) {
    return $appxCandidate.InstallLocation
  }

  return $null
}

function Get-CodexShortcutIcon {
  param(
    [string]$Target,
    [string]$Root
  )

  $candidateRoots = @()
  if (-not [string]::IsNullOrWhiteSpace($Target)) {
    $candidateRoots += $Target
  }

  $latestPatched = Find-LatestPatchedCodexRoot @($Root, "C:\tmp")
  if ($latestPatched) {
    $candidateRoots += $latestPatched
  }

  $latestInstalled = Find-LatestInstalledCodexRoot
  if ($latestInstalled) {
    $candidateRoots += $latestInstalled
  }

  foreach ($candidateRoot in $candidateRoots) {
    $candidateIcon = Join-Path $candidateRoot "app\Codex.exe"
    if (Test-Path -LiteralPath $candidateIcon) {
      return "$candidateIcon,0"
    }
  }

  return "$env:WINDIR\System32\shell32.dll,220"
}

$arguments = @(
  "-NoProfile",
  "-WindowStyle", "Hidden",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$autoPatcher`"",
  "-OutputRoot", "`"$OutputRoot`"",
  "-PatchBrowserClient",
  "-SyncPluginCache"
)

if (-not [string]::IsNullOrWhiteSpace($TargetRoot)) {
  $arguments += @("-TargetRoot", "`"$TargetRoot`"")
}
if ($ForceRebuild) {
  $arguments += "-ForceRebuild"
}
if (-not $NoRepairChromePlugin) {
  $arguments += "-RepairChromePlugin"
}

$icon = Get-CodexShortcutIcon -Target $TargetRoot -Root $OutputRoot

$shell = New-Object -ComObject WScript.Shell
$shortcutPaths = Get-ShortcutPaths -Path $ShortcutPath -Name $ShortcutName -Locations $ShortcutLocations
foreach ($path in $shortcutPaths) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  $shortcut.Arguments = ($arguments -join " ")
  $shortcut.WorkingDirectory = (Split-Path -Parent $autoPatcher)
  $shortcut.IconLocation = $icon
  $shortcut.Description = "Patch and launch the newest Codex app copy with Chrome support enabled."
  $shortcut.Save()
  Write-Host "Created shortcut: $path"
}
