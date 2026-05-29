#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output_root="$HOME/CodexPatched"
target_app=""
force_rebuild=0
launch=1
sync_plugin_cache=1
repair_chrome_plugin=1
patch_browser_client=1
ad_hoc_sign=1
configure_memories=1

usage() {
  cat <<'EOF'
Usage: scripts/auto-patch-codex-macos.sh [options]

Finds the installed Codex.app, copies it to a managed writable .app bundle,
patches the copied app.asar, and optionally launches the patched copy.

Options:
  --output-root PATH       Directory that stores managed app copies.
                           Default: ~/CodexPatched
  --target-app PATH        Exact copied .app bundle to use.
  --force-rebuild          Delete and recreate the target app copy.
  --no-launch              Patch only.
  --sync-plugin-cache      Sync bundled browser plugins into ~/.codex cache. Default: on.
  --no-sync-plugin-cache   Do not sync bundled browser plugins into ~/.codex cache.
  --repair-chrome-plugin   Ask the copied app-server to reinstall Chrome plugin. Default: on.
  --no-repair-chrome-plugin
                           Do not ask the copied app-server to reinstall Chrome plugin.
  --patch-browser-client   Patch browser-client trust/policy gates. Default: on.
  --no-patch-browser-client
                           Skip browser-client trust/policy patching.
  --ad-hoc-sign            Run codesign --force --deep --sign - after patching. Default: on.
  --no-ad-hoc-sign         Skip ad-hoc signing.
  --no-memories            Skip ~/.codex/config.toml feature and memory configuration.
  -h, --help               Show this help.
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
    --output-root)
      output_root="${2:?Missing value for --output-root}"
      shift
      ;;
    --target-app)
      target_app="${2:?Missing value for --target-app}"
      shift
      ;;
    --force-rebuild)
      force_rebuild=1
      ;;
    --no-launch)
      launch=0
      ;;
    --sync-plugin-cache)
      sync_plugin_cache=1
      ;;
    --no-sync-plugin-cache)
      sync_plugin_cache=0
      ;;
    --repair-chrome-plugin)
      repair_chrome_plugin=1
      ;;
    --no-repair-chrome-plugin)
      repair_chrome_plugin=0
      ;;
    --patch-browser-client)
      patch_browser_client=1
      ;;
    --no-patch-browser-client)
      patch_browser_client=0
      ;;
    --ad-hoc-sign)
      ad_hoc_sign=1
      ;;
    --no-ad-hoc-sign)
      ad_hoc_sign=0
      ;;
    --no-memories)
      configure_memories=0
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
  echo "This script is intended for macOS. Current platform: $(uname -s)" >&2
  exit 1
fi

find_codex_app() {
  local candidates=(
    "/Applications/Codex.app"
    "$HOME/Applications/Codex.app"
  )

  local app
  for app in "${candidates[@]}"; do
    if [ -f "$app/Contents/Resources/app.asar" ]; then
      printf '%s\n' "$app"
      return 0
    fi
  done

  if command -v mdfind >/dev/null 2>&1; then
    while IFS= read -r app; do
      if [ -f "$app/Contents/Resources/app.asar" ]; then
        printf '%s\n' "$app"
        return 0
      fi
    done < <(mdfind "kMDItemFSName == 'Codex.app'" 2>/dev/null || true)
  fi

  return 1
}

codex_version() {
  local app="$1"
  local plist="$app/Contents/Info.plist"
  local version=""
  if [ -f "$plist" ] && [ -x /usr/libexec/PlistBuddy ]; then
    version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null || true)"
  fi
  if [ -z "$version" ]; then
    version="$(date +%Y%m%d%H%M%S)"
  fi
  printf '%s\n' "$version"
}

assert_safe_target() {
  local target="$1"
  local root="$2"
  case "$target" in
    "/Applications/Codex.app"|"$HOME/Applications/Codex.app")
      echo "Refusing to patch the installed app in place: $target" >&2
      exit 1
      ;;
  esac
  case "$target" in
    "$root"/*.app) ;;
    *)
      echo "Refusing to manage target outside OutputRoot. Target=$target OutputRoot=$root" >&2
      exit 1
      ;;
  esac
}

node_bin="$(command -v node || true)"
if [ -z "$node_bin" ]; then
  echo "Node.js was not found on PATH. Install Node.js, then rerun this script." >&2
  exit 1
fi

source_app="$(find_codex_app || true)"
if [ -z "$source_app" ]; then
  echo "Codex.app was not found. Install Codex for macOS, then rerun this script." >&2
  exit 1
fi

output_root="$(expand_path "$output_root")"
version="$(codex_version "$source_app")"
patch_revision=4
if [ -z "$target_app" ]; then
  target_app="$output_root/CodexChromePatched-$version-r$patch_revision.app"
else
  target_app="$(expand_path "$target_app")"
fi

case "$target_app" in
  *.app) ;;
  *) target_app="$target_app.app" ;;
esac

assert_safe_target "$target_app" "$output_root"

patcher="$script_dir/patch-codex-chrome-macos.mjs"
launcher="$script_dir/launch-patched-codex-macos.sh"
if [ ! -f "$patcher" ]; then
  echo "Missing patcher: $patcher" >&2
  exit 1
fi
if [ ! -f "$launcher" ]; then
  echo "Missing launcher: $launcher" >&2
  exit 1
fi

echo "Source Codex app: $source_app"
echo "Patched target: $target_app"

if [ "$configure_memories" -eq 1 ]; then
  "$script_dir/configure-codex-memories.sh"
fi

target_base="$(basename "${target_app%.app}")"
patch_marker="$output_root/.$target_base.codex-chrome-patcher.json"
needs_copy=0
if [ ! -f "$target_app/Contents/Resources/app.asar" ]; then
  needs_copy=1
fi

if [ "$force_rebuild" -eq 1 ] || [ "$needs_copy" -eq 1 ]; then
  if [ -e "$target_app" ]; then
    rm -rf "$target_app"
  fi
  mkdir -p "$(dirname "$target_app")"
  if command -v ditto >/dev/null 2>&1; then
    ditto "$source_app" "$target_app"
  else
    cp -R "$source_app" "$target_app"
  fi
  echo "Copied Codex.app to patched target."
else
  echo "Using existing patched target. Pass --force-rebuild to rebuild it from the installed app."
fi

marker_revision=""
if [ -f "$patch_marker" ]; then
  marker_revision="$(python3 - "$patch_marker" <<'PY' 2>/dev/null || true
import json
import sys
from pathlib import Path

print(json.loads(Path(sys.argv[1]).read_text()).get("patchRevision", ""))
PY
)"
fi

needs_patch=0
if [ "$force_rebuild" -eq 1 ] || [ "$needs_copy" -eq 1 ] || [ ! -f "$patch_marker" ] || [ "$marker_revision" != "$patch_revision" ]; then
  needs_patch=1
fi

if [ "$needs_patch" -eq 1 ]; then
  patch_args=("$patcher" "--app" "$target_app" "--apply")
  if [ "$patch_browser_client" -eq 1 ]; then
    patch_args+=("--patch-browser-client")
  fi
  if [ "$ad_hoc_sign" -eq 1 ]; then
    patch_args+=("--ad-hoc-sign")
  fi

  "$node_bin" "${patch_args[@]}"

  python3 - "$patch_marker" "$source_app" "$version" "$target_app" "$patch_revision" "$patch_browser_client" "$ad_hoc_sign" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

marker, source, version, target, revision, patch_browser_client, ad_hoc_sign = sys.argv[1:]
payload = {
    "source": source,
    "version": version,
    "target": target,
    "patchRevision": int(revision),
    "patchedAt": datetime.now(timezone.utc).isoformat(),
    "patchBrowserClient": patch_browser_client == "1",
    "adHocSign": ad_hoc_sign == "1",
}
Path(marker).write_text(json.dumps(payload, indent=2) + "\n")
PY
else
  echo "Patch marker found. Skipping repatch for this Codex version."
fi

if [ "$launch" -eq 1 ]; then
  launch_args=("--app" "$target_app")
  if [ "$sync_plugin_cache" -eq 1 ]; then
    launch_args+=("--sync-plugin-cache")
  fi
  if [ "$repair_chrome_plugin" -eq 1 ]; then
    launch_args+=("--repair-chrome-plugin")
  fi
  "$launcher" "${launch_args[@]}"
fi

echo "Patched Codex is ready: $target_app"
