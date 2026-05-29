#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_root="$HOME/CodexPatched/CodexChromePatched.app"
sync_plugin_cache=0
repair_chrome_plugin=0

usage() {
  cat <<'EOF'
Usage: scripts/launch-patched-codex-macos.sh [options]

Options:
  --app PATH              Patched Codex.app copy to launch.
                          Default: ~/CodexPatched/CodexChromePatched.app
  --sync-plugin-cache     Sync bundled browser plugins into ~/.codex cache.
  --repair-chrome-plugin  Ask the copied app-server to reinstall Chrome plugin.
  -h, --help              Show this help.
EOF
}

expand_path() {
  local path="$1"
  case "$path" in
    "~") printf '%s\n' "$HOME" ;;
    "~/"*) printf '%s/%s\n' "$HOME" "${path#~/}" ;;
    *) printf '%s\n' "$path" ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app)
      app_root="${2:?Missing value for --app}"
      shift
      ;;
    --sync-plugin-cache)
      sync_plugin_cache=1
      ;;
    --repair-chrome-plugin)
      repair_chrome_plugin=1
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
  echo "This launcher is intended for macOS. Current platform: $(uname -s)" >&2
  exit 1
fi

app_root="$(expand_path "$app_root")"
if [ ! -d "$app_root" ]; then
  echo "Missing patched Codex app: $app_root" >&2
  exit 1
fi
if [ ! -f "$app_root/Contents/Resources/app.asar" ]; then
  echo "Missing app.asar in patched Codex app: $app_root/Contents/Resources/app.asar" >&2
  exit 1
fi

node_bin="$(command -v node || true)"
patcher="$script_dir/patch-codex-chrome-macos.mjs"
if [ "$sync_plugin_cache" -eq 1 ]; then
  if [ -n "$node_bin" ] && [ -f "$patcher" ]; then
    "$node_bin" "$patcher" --app "$app_root" --cache-only --apply --patch-user-plugin-cache
  else
    echo "Skipping browser plugin cache patch because node or patch-codex-chrome-macos.mjs was not found." >&2
  fi
fi

if [ "$repair_chrome_plugin" -eq 1 ]; then
  repairer="$script_dir/reinstall-chrome-plugin-macos.mjs"
  if [ -n "$node_bin" ] && [ -f "$repairer" ]; then
    "$node_bin" "$repairer" --app "$app_root" --plugin chrome
  else
    echo "Cannot repair Chrome plugin because node or reinstall-chrome-plugin-macos.mjs was not found." >&2
    exit 1
  fi
fi

osascript -e 'quit app "Codex"' >/dev/null 2>&1 || true
pkill -f "$app_root" >/dev/null 2>&1 || true

open -n "$app_root"
echo "Launched patched Codex: $app_root"
