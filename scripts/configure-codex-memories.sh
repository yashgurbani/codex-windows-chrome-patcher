#!/usr/bin/env bash
set -euo pipefail

config_path="${CODEX_CONFIG_PATH:-${CODEX_HOME:-$HOME/.codex}/config.toml}"
config_dir="$(dirname "$config_path")"

mkdir -p "$config_dir"

if [ -f "$config_path" ]; then
  backup="${config_path}.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$config_path" "$backup"
  echo "Backup: $backup"
fi

python3 - "$config_path" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1]).expanduser()
text = path.read_text() if path.exists() else ""
original = text
feature_block = """[features]
apps = true
memories = true
plugins = true
browser_use = true
browser_use_external = true
computer_use = true
in_app_browser = true
tool_search = true
tool_suggest = true
tool_call_mcp_elicitation = true
multi_agent = true
goals = true
workspace_dependencies = false
js_repl = false
"""
memory_block = """[memories]
generate_memories = true
use_memories = true
disable_on_external_context = false
"""

def set_section(current, name, block):
    pattern = re.compile(rf"(?ms)^\[{re.escape(name)}\]\s*.*?(?=^\[|\Z)")
    block = block.rstrip()
    if pattern.search(current):
        return pattern.sub(block + "\n\n", current)
    text = current
    if text and not text.endswith("\n"):
        text += "\n"
    if text and not text.endswith("\n\n"):
        text += "\n"
    return text + block + "\n"

def set_top_level_value(current, key, value):
    first_section = re.search(r"(?m)^\[", current)
    if first_section:
        prefix = current[:first_section.start()]
        suffix = current[first_section.start():]
    else:
        prefix = current
        suffix = ""

    line = f"{key} = {value}"
    pattern = re.compile(rf"(?m)^{re.escape(key)}\s*=.*$")
    if pattern.search(prefix):
        prefix = pattern.sub(line, prefix)
    else:
        if prefix and not prefix.endswith("\n"):
            prefix += "\n"
        prefix += line + "\n"
    return prefix + suffix

text = set_top_level_value(text, "web_search", '"live"')
text = set_section(text, "features", feature_block)
text = set_section(text, "memories", memory_block)

if text == original:
    print(f"Codex live search, features, and memories already configured in: {path}")
    sys.exit(0)

path.write_text(text)
print(f"Configured Codex live search, features, and memories in: {path}")
PY

grep -nE '^web_search|^\[features\]|browser_use|computer_use|in_app_browser|tool_search|tool_suggest|tool_call_mcp_elicitation|^\[memories\]|generate_memories|use_memories|disable_on_external_context' "$config_path"
