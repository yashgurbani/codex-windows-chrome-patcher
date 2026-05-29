#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
launcher_path="${1:-$HOME/Desktop/Codex Workflow.command}"

mkdir -p "$(dirname "$launcher_path")"

cat > "$launcher_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$repo_dir"
if [ ! -d "$repo_dir/node_modules/@electron/asar" ]; then
  npm install
fi
"$script_dir/auto-patch-codex-macos.sh" --ad-hoc-sign --patch-browser-client --sync-plugin-cache
EOF

chmod +x "$launcher_path"

echo "Created launcher: $launcher_path"
echo "Double-click it from Finder, or run:"
echo "  \"$launcher_path\""
