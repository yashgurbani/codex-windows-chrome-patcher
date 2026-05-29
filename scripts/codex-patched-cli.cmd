@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "RESOLVER=%SCRIPT_DIR%resolve-patched-codex-cli.ps1"

if not exist "%RESOLVER%" (
  echo Missing patched Codex resolver: %RESOLVER% 1>&2
  exit /b 1
)

set "CODEX_EXE="
for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RESOLVER%"`) do set "CODEX_EXE=%%I"

if not defined CODEX_EXE (
  echo Could not resolve patched Codex CLI. Run scripts\auto-patch-codex.ps1 first. 1>&2
  exit /b 1
)

if not exist "%CODEX_EXE%" (
  echo Resolved patched Codex CLI does not exist: %CODEX_EXE% 1>&2
  exit /b 1
)

"%CODEX_EXE%" %*
exit /b %ERRORLEVEL%
