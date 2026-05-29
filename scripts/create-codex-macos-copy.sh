#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output_root="$HOME/CodexPatched"
app_name="Codex Patched.app"
force=0
launch=0
configure_memories=1
run_doctor=0

usage() {
  cat <<'EOF'
Usage: scripts/create-codex-macos-copy.sh [options]

Finds the installed Codex.app, copies it to a managed location, configures
Codex memories, verifies the copied app signature, and writes a marker file.

Options:
  --output-root PATH     Directory that will contain the copied app.
                         Default: ~/CodexPatched
  --app-name NAME        Copied app bundle name.
                         Default: "Codex Patched.app"
  --force               Delete and recreate the copied app if it already exists.
  --launch              Launch the copied app after setup.
  --no-memories         Skip ~/.codex/config.toml feature and memory configuration.
  --doctor              Run scripts/codex-doctor-macos.sh after setup.
  -h, --help            Show this help.

This script does not modify app.asar, patch Electron JavaScript, bypass
regional eligibility checks, or alter code-signing/notarization.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-root)
      output_root="${2:?Missing value for --output-root}"
      shift
      ;;
    --app-name)
      app_name="${2:?Missing value for --app-name}"
      shift
      ;;
    --force)
      force=1
      ;;
    --launch)
      launch=1
      ;;
    --no-memories)
      configure_memories=0
      ;;
    --doctor)
      run_doctor=1
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

case "$app_name" in
  *.app) ;;
  *) app_name="${app_name}.app" ;;
esac

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

hash_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    printf 'unavailable'
  fi
}

source_app="$(find_codex_app || true)"
if [ -z "$source_app" ]; then
  echo "Codex.app was not found. Install Codex for macOS, then rerun this script." >&2
  exit 1
fi

output_root="${output_root/#\~/$HOME}"
target_app="$output_root/$app_name"
marker="$output_root/.codex-macos-copy.json"

echo "Source Codex app: $source_app"
echo "Target Codex app: $target_app"

if [ "$configure_memories" -eq 1 ]; then
  "$script_dir/configure-codex-memories.sh"
fi

if [ -e "$target_app" ]; then
  if [ "$force" -eq 1 ]; then
    case "$target_app" in
      "$output_root"/*.app) ;;
      *)
        echo "Refusing to remove unexpected target: $target_app" >&2
        exit 1
        ;;
    esac
    rm -rf "$target_app"
  else
    echo "Target already exists. Pass --force to recreate it." >&2
    exit 1
  fi
fi

mkdir -p "$output_root"

if command -v ditto >/dev/null 2>&1; then
  ditto "$source_app" "$target_app"
else
  cp -R "$source_app" "$target_app"
fi

echo "Copied Codex app."

signature_status="unknown"
if command -v codesign >/dev/null 2>&1; then
  if codesign --verify --deep --strict "$target_app" >/dev/null 2>&1; then
    signature_status="ok"
    echo "Code signature: OK"
  else
    signature_status="failed"
    echo "Code signature: FAILED"
  fi
fi

gatekeeper_status="unknown"
if command -v spctl >/dev/null 2>&1; then
  if spctl --assess --type execute --verbose "$target_app" >/dev/null 2>&1; then
    gatekeeper_status="ok"
    echo "Gatekeeper: OK"
  else
    gatekeeper_status="failed"
    echo "Gatekeeper: FAILED"
  fi
fi

asar="$target_app/Contents/Resources/app.asar"
asar_hash=""
asar_bytes=""
if [ -f "$asar" ]; then
  asar_hash="$(hash_file "$asar")"
  asar_bytes="$(wc -c < "$asar" | tr -d ' ')"
fi

python3 - "$marker" "$source_app" "$target_app" "$signature_status" "$gatekeeper_status" "$asar_hash" "$asar_bytes" <<'PY'
from pathlib import Path
import json
import sys
from datetime import datetime, timezone

marker, source, target, signature, gatekeeper, asar_hash, asar_bytes = sys.argv[1:]
payload = {
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "sourceApp": source,
    "targetApp": target,
    "signatureStatus": signature,
    "gatekeeperStatus": gatekeeper,
    "appAsarSha256": asar_hash or None,
    "appAsarBytes": int(asar_bytes) if asar_bytes else None,
    "modifiedAppBundle": False,
}
Path(marker).write_text(json.dumps(payload, indent=2) + "\n")
print(f"Marker: {marker}")
PY

if [ "$run_doctor" -eq 1 ]; then
  "$script_dir/codex-doctor-macos.sh"
fi

if [ "$launch" -eq 1 ]; then
  open "$target_app"
  echo "Launched copied Codex app: $target_app"
fi
