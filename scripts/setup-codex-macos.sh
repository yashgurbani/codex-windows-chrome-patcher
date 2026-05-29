#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
launch=1
run_doctor=1

usage() {
  cat <<'EOF'
Usage: scripts/setup-codex-macos.sh [--no-launch] [--skip-doctor]

Configures the supported macOS Codex workflow:
  - ensures ~/.codex/config.toml has the [memories] block
  - verifies Codex.app can be found
  - optionally launches Codex
  - optionally runs scripts/codex-doctor-macos.sh

This script does not patch Codex Electron bundles or bypass regional gates.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-launch)
      launch=0
      ;;
    --skip-doctor)
      run_doctor=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This setup script is intended for macOS. Current platform: $(uname -s)" >&2
  exit 1
fi

find_codex_app() {
  local candidates=(
    "/Applications/Codex.app"
    "$HOME/Applications/Codex.app"
  )

  local app
  for app in "${candidates[@]}"; do
    if [ -d "$app" ]; then
      printf '%s\n' "$app"
      return 0
    fi
  done

  if command -v mdfind >/dev/null 2>&1; then
    app="$(mdfind "kMDItemFSName == 'Codex.app'" 2>/dev/null | head -1 || true)"
    if [ -n "$app" ] && [ -d "$app" ]; then
      printf '%s\n' "$app"
      return 0
    fi
  fi

  return 1
}

"$script_dir/configure-codex-memories.sh"

codex_app="$(find_codex_app || true)"
if [ -z "$codex_app" ]; then
  echo "Codex.app was not found. Install Codex for macOS, then rerun this script." >&2
  exit 1
fi

echo "Codex app: $codex_app"

if command -v codesign >/dev/null 2>&1; then
  if codesign --verify --deep --strict "$codex_app" >/dev/null 2>&1; then
    echo "Code signature: OK"
  else
    echo "Code signature: FAILED"
    echo "Do not use a modified app bundle as a daily driver; reinstall the official app if needed." >&2
  fi
fi

if [ "$launch" -eq 1 ]; then
  open "$codex_app"
  echo "Launched Codex."
fi

if [ "$run_doctor" -eq 1 ]; then
  "$script_dir/codex-doctor-macos.sh"
fi
