#!/usr/bin/env bash
set -u

warnings=0

section() {
  printf '\n== %s ==\n' "$1"
}

ok() {
  printf '[OK] %s\n' "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf '[WARN] %s\n' "$1"
}

info() {
  printf '[INFO] %s\n' "$1"
}

exists() {
  command -v "$1" >/dev/null 2>&1
}

json_print() {
  if exists python3; then
    python3 -m json.tool "$1" 2>/dev/null || cat "$1"
  else
    cat "$1"
  fi
}

section "System"
if [ "$(uname -s)" != "Darwin" ]; then
  warn "This script is intended for macOS; uname reports $(uname -s)."
else
  ok "macOS detected."
fi
sw_vers 2>/dev/null || true
info "Architecture: $(uname -m)"

section "Codex App"
codex_apps=()
for app in "/Applications/Codex.app" "$HOME/Applications/Codex.app"; do
  if [ -d "$app" ]; then
    codex_apps+=("$app")
  fi
done

if exists mdfind; then
  while IFS= read -r app; do
    [ -d "$app" ] && codex_apps+=("$app")
  done < <(mdfind "kMDItemFSName == 'Codex.app'" 2>/dev/null || true)
fi

if [ "${#codex_apps[@]}" -eq 0 ]; then
  warn "Codex.app was not found in /Applications, ~/Applications, or Spotlight results."
else
  seen=""
  for app in "${codex_apps[@]}"; do
    case "$seen" in
      *"|$app|"*) continue ;;
    esac
    seen="${seen}|${app}|"
    ok "Found $app"
    if exists codesign; then
      if codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
        ok "Code signature verifies for $app"
      else
        warn "Code signature verification failed for $app. A modified app bundle may not update or run correctly."
      fi
    fi
  done
fi

if pgrep -fl "Codex|codex" >/dev/null 2>&1; then
  info "Running Codex-related processes:"
  pgrep -fl "Codex|codex" || true
else
  warn "No Codex-related process is currently running."
fi

section "Codex Home And Memories"
codex_home="${CODEX_HOME:-$HOME/.codex}"
info "CODEX_HOME: $codex_home"

config="$codex_home/config.toml"
if [ -f "$config" ]; then
  ok "Found $config"
  grep -nE '^\[memories\]|generate_memories|use_memories|disable_on_external_context' "$config" || warn "No [memories] config lines found in $config"
else
  warn "Missing $config"
fi

mem_dir="$codex_home/memories"
if [ -d "$mem_dir" ]; then
  ok "Found $mem_dir"
  mem_count=$(find "$mem_dir" -type f 2>/dev/null | wc -l | tr -d ' ')
  info "Memory file count: $mem_count"
  if [ "$mem_count" = "0" ]; then
    warn "Memory directory exists but has no files. Run a memory canary test after enabling memories."
  else
    info "Newest memory files:"
    find "$mem_dir" -type f -exec ls -lt {} + 2>/dev/null | head -10 || true
  fi
else
  warn "Missing $mem_dir"
fi

section "Chrome"
if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
  ok "Google Chrome app found."
else
  warn "Google Chrome app was not found in /Applications or ~/Applications."
fi

host_dirs=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "/Library/Google/Chrome/NativeMessagingHosts"
)

found_host=0
for dir in "${host_dirs[@]}"; do
  if [ -d "$dir" ]; then
    ok "Native messaging directory exists: $dir"
    while IFS= read -r manifest; do
      [ -f "$manifest" ] || continue
      if grep -qiE 'codex|openai' "$manifest"; then
        found_host=1
        printf '\n-- Native host candidate: %s --\n' "$manifest"
        json_print "$manifest"
      fi
    done < <(find "$dir" -maxdepth 1 -type f -name '*.json' -print 2>/dev/null || true)
  else
    info "Native messaging directory missing: $dir"
  fi
done

if [ "$found_host" -eq 0 ]; then
  warn "No Codex/OpenAI Chrome native messaging host manifest found. Reinstall the Chrome plugin from Codex UI."
fi

chrome_root="$HOME/Library/Application Support/Google/Chrome"
found_ext=0
if [ -d "$chrome_root" ]; then
  while IFS= read -r manifest; do
    if grep -qiE 'codex|openai' "$manifest"; then
      found_ext=1
      printf '\n-- Chrome extension candidate: %s --\n' "$manifest"
      grep -iE '"name"|"description"|"version"|"permissions"|"nativeMessaging"' "$manifest" || true
    fi
  done < <(find "$chrome_root" -path '*/Extensions/*/*/manifest.json' -print 2>/dev/null || true)
else
  warn "Chrome profile root missing: $chrome_root"
fi

if [ "$found_ext" -eq 0 ]; then
  warn "No Chrome extension manifest mentioning Codex/OpenAI found in Chrome profiles."
fi

section "Computer Use Permissions"
info "macOS TCC permission state is not fully reliable from shell."
info "Manually verify Codex is enabled in:"
info "  System Settings > Privacy & Security > Accessibility"
info "  System Settings > Privacy & Security > Screen & System Audio Recording / Screen Recording"
info "  System Settings > Privacy & Security > Automation, after Codex prompts"

section "Remote Access"
info "Remote access requires latest Codex on the Mac, latest ChatGPT mobile app, and a running awake Mac host."
if exists pmset; then
  pmset -g | sed -n '1,20p' || true
fi
info "Use 'caffeinate -dimsu' during setup if the Mac must stay awake temporarily."

section "Skills And Instructions"
skills_dir="$codex_home/skills"
if [ -d "$skills_dir" ]; then
  ok "Skills directory found: $skills_dir"
  skill_count=$(find "$skills_dir" -mindepth 2 -maxdepth 2 -name 'SKILL.md' 2>/dev/null | wc -l | tr -d ' ')
  info "Installed skill count: $skill_count"
else
  info "Skills directory missing: $skills_dir"
fi

if [ -f "$codex_home/AGENTS.md" ]; then
  ok "Global AGENTS.md found: $codex_home/AGENTS.md"
else
  warn "Global AGENTS.md missing. Add one for durable workflow rules."
fi

section "Summary"
if [ "$warnings" -eq 0 ]; then
  ok "No warnings detected."
else
  warn "$warnings warning(s) detected. Review the sections above."
fi

exit 0
