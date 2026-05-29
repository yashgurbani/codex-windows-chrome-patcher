#!/usr/bin/env bash
set -euo pipefail

output="${1:-}"

section() {
  printf '\n== %s ==\n' "$1"
}

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

emit_report() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This script is intended for macOS. Current platform: $(uname -s)" >&2
    exit 1
  fi

  local app
  app="$(find_codex_app || true)"
  if [ -z "$app" ]; then
    echo "Codex.app was not found in /Applications, ~/Applications, or Spotlight results." >&2
    exit 1
  fi

  local contents="$app/Contents"
  local resources="$contents/Resources"
  local asar="$resources/app.asar"

  section "Codex App"
  echo "App: $app"
  if [ -f "$contents/Info.plist" ]; then
    echo "Bundle identifier: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$contents/Info.plist" 2>/dev/null || true)"
    echo "Bundle version: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$contents/Info.plist" 2>/dev/null || true)"
    echo "Build version: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$contents/Info.plist" 2>/dev/null || true)"
  fi

  section "Code Signature"
  if command -v codesign >/dev/null 2>&1; then
    if codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
      echo "Verify: OK"
    else
      echo "Verify: FAILED"
    fi
    codesign -dv "$app" 2>&1 | sed -n '1,40p' || true
  else
    echo "codesign unavailable"
  fi

  section "Gatekeeper"
  if command -v spctl >/dev/null 2>&1; then
    spctl --assess --type execute --verbose "$app" 2>&1 || true
  else
    echo "spctl unavailable"
  fi

  section "Resources"
  echo "Resources: $resources"
  if [ -f "$asar" ]; then
    echo "app.asar: $asar"
    echo "app.asar bytes: $(wc -c < "$asar" | tr -d ' ')"
    echo "app.asar sha256: $(hash_file "$asar")"
  else
    echo "app.asar: missing"
  fi

  section "Resource Files"
  find "$resources" -maxdepth 2 -type f \
    \( -name 'codex*' -o -name 'node*' -o -name '*.asar' -o -name '*.json' \) \
    -print 2>/dev/null | sort | sed -n '1,120p'

  section "Potential App Bundle Assets"
  if command -v npx >/dev/null 2>&1 && [ -f "$asar" ]; then
    if npx --yes @electron/asar list "$asar" >/tmp/codex-asar-list.$$ 2>/tmp/codex-asar-list.err.$$; then
      grep -E '(^/\.vite/|^/webview/|plugin|chrome|browser|memory|remote)' /tmp/codex-asar-list.$$ | sed -n '1,160p'
    else
      echo "Could not list app.asar with npx @electron/asar."
      sed -n '1,40p' /tmp/codex-asar-list.err.$$ || true
    fi
    rm -f /tmp/codex-asar-list.$$ /tmp/codex-asar-list.err.$$
  else
    echo "Install Node.js/npm to list app.asar contents with @electron/asar."
  fi

  section "Chrome Native Messaging"
  for dir in \
    "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
    "/Library/Google/Chrome/NativeMessagingHosts"; do
    echo "Directory: $dir"
    if [ -d "$dir" ]; then
      find "$dir" -maxdepth 1 -type f -name '*.json' -print 2>/dev/null | sort
    else
      echo "missing"
    fi
  done

  section "Codex Config"
  local codex_home="${CODEX_HOME:-$HOME/.codex}"
  echo "CODEX_HOME: $codex_home"
  if [ -f "$codex_home/config.toml" ]; then
    grep -nE '^\[memories\]|generate_memories|use_memories|disable_on_external_context' "$codex_home/config.toml" || true
  else
    echo "Missing config.toml"
  fi
}

if [ -n "$output" ]; then
  mkdir -p "$(dirname "$output")"
  emit_report | tee "$output"
else
  emit_report
fi
