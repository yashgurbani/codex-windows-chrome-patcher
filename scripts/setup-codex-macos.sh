#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
launch=1
run_doctor=1

usage() {
  cat <<'EOF'
Usage: scripts/setup-codex-macos.sh [--no-launch] [--skip-doctor]

Configures and applies the patched macOS Codex workflow:
  - configures ~/.codex/config.toml feature and memory flags
  - finds the installed Codex.app
  - copies it under ~/CodexPatched
  - patches app.asar regional gates
  - patches Chrome/browser-client trust gates
  - syncs the bundled Chrome/browser-use plugin cache
  - repairs the Chrome plugin through Codex app-server APIs
  - ad-hoc signs the copied .app
  - optionally launches the patched copied app
  - optionally runs scripts/codex-doctor-macos.sh

This script intentionally applies the macOS Chrome patch. It must not patch
/Applications/Codex.app in place; it delegates to auto-patch-codex-macos.sh,
which patches only copied apps under ~/CodexPatched.
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

auto_patch_args=("--force-rebuild")
if [ "$launch" -eq 0 ]; then
  auto_patch_args+=("--no-launch")
fi

"$script_dir/auto-patch-codex-macos.sh" "${auto_patch_args[@]}"

if [ "$run_doctor" -eq 1 ]; then
  "$script_dir/codex-doctor-macos.sh"
fi
