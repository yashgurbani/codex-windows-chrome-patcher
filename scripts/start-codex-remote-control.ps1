param(
  [int]$Port = 14567,
  [string]$OutputRoot = "D:\CodexPatched",
  [string]$AppRoot = "",
  [switch]$Status,
  [switch]$Stop,
  [switch]$CreateShortcut,
  [string]$ShortcutName = "Codex Remote Control"
)

$ErrorActionPreference = "Stop"

function Find-LatestPatchedCodexRoot {
  param(
    [string]$PreferredRoot
  )

  $searchRoots = @($PreferredRoot, "C:\tmp") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
  $candidates = @()
  foreach ($root in $searchRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $candidates += Get-ChildItem -LiteralPath $root -Directory -Filter "CodexChromePatched*" -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "app\resources\codex.exe") }
  }

  $candidate = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $candidate) {
    throw "Could not find a patched Codex root under $($searchRoots -join ', '). Run scripts\auto-patch-codex.ps1 first."
  }
  return $candidate.FullName
}

function Resolve-CodexAppRoot {
  if (-not [string]::IsNullOrWhiteSpace($AppRoot)) {
    if (-not (Test-Path -LiteralPath (Join-Path $AppRoot "app\resources\codex.exe"))) {
      throw "AppRoot does not contain app\resources\codex.exe: $AppRoot"
    }
    return (Resolve-Path -LiteralPath $AppRoot).Path
  }

  return Find-LatestPatchedCodexRoot -PreferredRoot $OutputRoot
}

function Find-CodexExe {
  param([string]$Root)
  $codex = Join-Path $Root "app\resources\codex.exe"
  if (Test-Path -LiteralPath $codex) { return $codex }

  $cmd = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  throw "Could not find codex.exe. Pass -AppRoot or run the patcher first."
}

function Find-NodeExe {
  param([string]$Root)
  $node = Join-Path $Root "app\resources\node.exe"
  if (Test-Path -LiteralPath $node) { return $node }

  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  throw "Could not find node.exe. Pass -AppRoot or install Node.js."
}

function Get-RemoteControlAppServers {
  param([int]$ListenPort)
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "codex.exe" -and
      $_.CommandLine -and
      $_.CommandLine -match "\bapp-server\b" -and
      (
        $_.CommandLine -match "ws://127\.0\.0\.1:$ListenPort" -or
        $_.CommandLine -match "ws://localhost:$ListenPort"
      )
    }
}

function Stop-RemoteControlAppServers {
  param([int]$ListenPort)
  $targets = @(Get-RemoteControlAppServers -ListenPort $ListenPort)
  foreach ($process in $targets) {
    Write-Host "Stopping stale remote-control app-server PID $($process.ProcessId)"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Set-RemoteControlShortcut {
  param(
    [string]$Name,
    [string]$LauncherScript,
    [string]$LauncherOutputRoot,
    [string]$IconRoot
  )

  $safeName = $Name -replace '[\\/:*?"<>|]', '-'
  $shortcutPath = Join-Path ([Environment]::GetFolderPath("Programs")) "$safeName.lnk"
  $powershell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = @(
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$LauncherScript`"",
    "-OutputRoot", "`"$LauncherOutputRoot`""
  )

  $icon = Join-Path $IconRoot "app\Codex.exe"
  if (Test-Path -LiteralPath $icon) {
    $icon = "$icon,0"
  } else {
    $icon = "$env:WINDIR\System32\shell32.dll,220"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $shortcutPath) | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = ($arguments -join " ")
  $shortcut.WorkingDirectory = (Split-Path -Parent $LauncherScript)
  $shortcut.IconLocation = $icon
  $shortcut.Description = "Start Codex app-server remote control on localhost."
  $shortcut.Save()
  Write-Host "Updated remote-control shortcut: $shortcutPath"
}

$resolvedAppRoot = Resolve-CodexAppRoot
$codex = Find-CodexExe -Root $resolvedAppRoot
$node = Find-NodeExe -Root $resolvedAppRoot
$enableScript = Join-Path $PSScriptRoot "codex-remote-control-enable.mjs"
if (-not (Test-Path -LiteralPath $enableScript)) {
  throw "Missing remote-control helper: $enableScript"
}

if ($CreateShortcut) {
  Set-RemoteControlShortcut -Name $ShortcutName -LauncherScript $PSCommandPath -LauncherOutputRoot $OutputRoot -IconRoot $resolvedAppRoot
  exit 0
}

$logRoot = Join-Path $env:USERPROFILE ".codex\remote-control"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$outLog = Join-Path $logRoot "app-server-$Port.out.log"
$errLog = Join-Path $logRoot "app-server-$Port.err.log"

if ($Stop) {
  Stop-RemoteControlAppServers -ListenPort $Port
  exit 0
}

if ($Status) {
  & $node $enableScript --port $Port --mode status --ready-timeout-ms 3000
  exit $LASTEXITCODE
}

Stop-RemoteControlAppServers -ListenPort $Port

Write-Host "Using Codex CLI: $codex"
Write-Host "Starting app-server on ws://127.0.0.1:$Port"
$proc = Start-Process -FilePath $codex `
  -ArgumentList @("app-server", "--listen", "ws://127.0.0.1:$Port", "--analytics-default-enabled", "--enable", "remote_control") `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Write-Host "Started remote-control app-server PID $($proc.Id)"
& $node $enableScript --port $Port --mode enable
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Warning "Remote-control enable failed. Logs: $outLog ; $errLog"
}
exit $exitCode
