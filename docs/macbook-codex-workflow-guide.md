# MacBook Patched Codex Workflow

This is the macOS version of the Windows copied-app workflow. It does not patch `/Applications/Codex.app` in place. It finds the installed Codex app, copies it to `~/CodexPatched`, patches the copied `app.asar`, ad-hoc signs the copy, and launches the patched copy.

Use this only on a copied app bundle. Codex updates can change minified bundle markers, so the patcher must be run after updates and may need script updates when markers move.

## What The Patch Enables

The current macOS patcher applies the same regional-gate transforms as the Windows patcher:

- Forces Chrome / external browser availability.
- Forces in-app browser and computer-use availability.
- Forces the renderer plugin list to keep Chrome/browser-use visible.
- Forces supported experimental feature flags such as apps, plugins, memories, tool search, and related gates.
- Forces Memories UI availability and config support.
- Patches bundled and user-cache browser clients with `--patch-browser-client` by default.
- Syncs bundled browser plugins into `~/.codex/plugins/cache/openai-bundled` by default.
- Repairs the Chrome plugin/native messaging setup through Codex app-server APIs by default.

The patch cannot override server-side account, workspace, or plan checks. If the backend refuses a feature after the UI is unlocked, the local patch cannot fully solve that.

## Prerequisites

On the MacBook:

```bash
xcode-select --install
```

Install Node.js. Homebrew is easiest:

```bash
brew install node
```

Verify:

```bash
node --version
npm --version
git --version
```

Install the official Codex app normally. It should usually be here:

```bash
ls -ld /Applications/Codex.app
```

If not:

```bash
mdfind "kMDItemFSName == 'Codex.app'"
```

## Copy This Repo To The Mac

Put this repo somewhere stable, for example:

```bash
mkdir -p "$HOME/Developer"
cd "$HOME/Developer"
git clone <this-repo-url> codex-windows-chrome-patcher
cd codex-windows-chrome-patcher
npm install
```

If you are copying the folder manually instead of cloning, still run:

```bash
cd /path/to/codex-windows-chrome-patcher
npm install
```

## First Patch Run

Run a dry run first:

```bash
node ./scripts/patch-codex-chrome-macos.mjs \
  --app /Applications/Codex.app \
  --dry-run \
  --patch-browser-client
```

This should report all markers found. If it says `Patch markers missing`, the installed Codex build changed and the patch script needs new markers.

Then run the automatic copied-app patcher:

```bash
bash ./scripts/auto-patch-codex-macos.sh \
  --ad-hoc-sign \
  --patch-browser-client \
  --sync-plugin-cache \
  --repair-chrome-plugin
```

This creates a versioned copied app like:

```text
~/CodexPatched/CodexChromePatched-<version>-r4.app
```

It also writes a marker file under `~/CodexPatched` so future runs skip unnecessary work for the same installed Codex version.

## Every Codex Update

After the official Codex app updates, run the same automatic command again:

```bash
cd /path/to/codex-windows-chrome-patcher
bash ./scripts/auto-patch-codex-macos.sh \
  --ad-hoc-sign \
  --patch-browser-client \
  --sync-plugin-cache \
  --repair-chrome-plugin
```

If Codex updated but the patched copy still complains about regional restrictions, force a rebuild:

```bash
bash ./scripts/auto-patch-codex-macos.sh \
  --force-rebuild \
  --ad-hoc-sign \
  --patch-browser-client \
  --sync-plugin-cache \
  --repair-chrome-plugin
```

Do not pin the versioned patched `.app` itself as your long-term launcher. The path changes when Codex updates. Use the launcher below.

## Create A Double-Click Launcher

Create a Desktop launcher that runs the auto-patcher and launches the newest patched copy:

```bash
bash ./scripts/create-codex-macos-launcher.sh "$HOME/Desktop/Codex Patched.command"
```

Then double-click:

```text
~/Desktop/Codex Patched.command
```

That launcher:

- changes into this repo;
- runs `npm install` if dependencies are missing;
- runs `auto-patch-codex-macos.sh`, whose macOS defaults ad-hoc sign, patch browser-client trust, sync plugin cache, and repair the Chrome plugin;
- launches the patched Codex copy.

Use this launcher after every Codex update. Do not open `/Applications/Codex.app` when testing the patch.

## Gatekeeper And Signing

The auto-patcher should ad-hoc sign the copied app when you pass `--ad-hoc-sign`.

If macOS says the app is damaged or cannot be opened:

```bash
xattr -dr com.apple.quarantine "$HOME/CodexPatched"
```

Then re-run:

```bash
bash ./scripts/auto-patch-codex-macos.sh \
  --force-rebuild \
  --ad-hoc-sign \
  --patch-browser-client \
  --sync-plugin-cache \
  --repair-chrome-plugin
```

Check signature state:

```bash
for app in "$HOME"/CodexPatched/CodexChromePatched-*.app; do
  [ -e "$app" ] || continue
  codesign --verify --deep --strict "$app"
  spctl --assess --type execute --verbose "$app"
done
```

`spctl` can still complain for ad-hoc signed local copies. `codesign --verify` is the important local integrity check for this workflow.

## Verify You Are Running The Patched App

Quit official Codex:

```bash
osascript -e 'quit app "Codex"' || true
```

Launch patched Codex through the launcher or:

```bash
bash ./scripts/auto-patch-codex-macos.sh --ad-hoc-sign --patch-browser-client --sync-plugin-cache --repair-chrome-plugin
```

Check process paths:

```bash
ps aux | grep -i '[C]odex'
```

You want to see a path under:

```text
/Users/<name>/CodexPatched/...
```

If you see `/Applications/Codex.app`, you launched the unpatched official app.

## Configure Memories

The auto-patcher runs `scripts/configure-codex-memories.sh` by default. To run it manually:

```bash
bash ./scripts/configure-codex-memories.sh
```

Expected `~/.codex/config.toml` entries:

```toml
web_search = "live"

[features]
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

[memories]
generate_memories = true
use_memories = true
disable_on_external_context = false
```

Restart patched Codex after changing config.

Memory canary test:

```text
Remember this harmless canary for future Codex chats: BLUE-LANTERN-714.
```

Then start a new thread and ask:

```text
What is my Codex memory canary? Answer only if you remember it.
```

Also check files:

```bash
find "$HOME/.codex/memories" -type f -print 2>/dev/null | while IFS= read -r f; do
  ls -lt "$f"
done | head -20
```

## Chrome On macOS

macOS does not use the Windows registry key. Chrome native messaging manifests live here:

```bash
"$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
"/Library/Google/Chrome/NativeMessagingHosts"
```

Check manifests:

```bash
for dir in \
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "/Library/Google/Chrome/NativeMessagingHosts"
do
  [ -d "$dir" ] || continue
  for manifest in "$dir"/*.json; do
    [ -e "$manifest" ] && printf '%s\n' "$manifest"
  done
done
```

Check Chrome extension files:

```bash
find "$HOME/Library/Application Support/Google/Chrome" \
  -path '*/Extensions/*/*/manifest.json' -print 2>/dev/null |
while read -r f; do
  if grep -qiE 'codex|openai' "$f"; then
    echo "---- $f"
    grep -iE 'name|description|version|native' "$f"
  fi
done
```

If `@chrome` or Chrome plugin is still missing:

```bash
bash ./scripts/auto-patch-codex-macos.sh \
  --force-rebuild \
  --ad-hoc-sign \
  --patch-browser-client \
  --sync-plugin-cache \
  --repair-chrome-plugin
```

Then quit Chrome and patched Codex fully:

```bash
osascript -e 'quit app "Google Chrome"' || true
osascript -e 'quit app "Codex"' || true
```

Launch patched Codex again through `Codex Patched.command`.

## Computer Use Permissions

Even if the patched UI exposes computer use, macOS permissions are still required.

Open:

```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

Enable the patched Codex app under:

- Privacy & Security > Accessibility.
- Privacy & Security > Screen & System Audio Recording, or Screen Recording on older macOS versions.
- Privacy & Security > Automation, if prompted.

Restart patched Codex after granting permissions.

## Remote Connections

Codex now has native remote connections support. This patcher does not start a custom remote-control daemon or force remote-control config keys.

Checklist:

1. Keep patched Codex running on the Mac.
2. Keep the Mac awake:

```bash
caffeinate -dimsu
```

3. Pair from ChatGPT mobile if the Codex UI shows a remote connection QR or pairing flow.
4. If remote connections are absent, confirm the patched app is actually running from `~/CodexPatched`.

Stop `caffeinate` with `Ctrl-C`.

## Diagnostics

Run:

```bash
bash ./scripts/codex-doctor-macos.sh
```

Deep app inventory:

```bash
bash ./scripts/inspect-codex-macos.sh ./codex-macos-report.txt
```

Patch dry-run against a copied app:

```bash
node ./scripts/patch-codex-chrome-macos.mjs \
  --app "$HOME/CodexPatched/CodexChromePatched-<version>-r4.app" \
  --dry-run \
  --patch-browser-client
```

## Troubleshooting

### It Still Says Regional Restrictions Apply

Most common causes:

1. You launched `/Applications/Codex.app` instead of the patched copy.
2. The official Codex app updated and the patched copy is stale.
3. The patch marker says patched, but the app bundle was rebuilt or partially overwritten.
4. The minified bundle markers changed and the patcher no longer hits all gates.
5. The remaining block is server-side account/workspace enforcement.

Run:

```bash
ps aux | grep -i '[C]odex'
bash ./scripts/auto-patch-codex-macos.sh --force-rebuild --ad-hoc-sign --patch-browser-client --sync-plugin-cache --repair-chrome-plugin
```

If the rebuild fails with `Patch markers missing`, collect:

```bash
bash ./scripts/inspect-codex-macos.sh ./codex-macos-report.txt
```

Then update `scripts/patch-codex-chrome-macos.mjs` with the new minified markers.

### Chrome Plugin Missing Or Browser Client Not Trusted

If Chrome fails with:

```text
privileged native pipe bridge is not available; browser-client is not trusted
```

the stale or copied browser-client cache was not patched. Run the macOS patcher; do not run the Windows patcher on macOS and do not repair the native host manually.

Run:

```bash
bash ./scripts/auto-patch-codex-macos.sh --force-rebuild --ad-hoc-sign --patch-browser-client --sync-plugin-cache --repair-chrome-plugin
```

Then fully restart Chrome and patched Codex.

### Memories UI Missing

Run:

```bash
bash ./scripts/configure-codex-memories.sh
bash ./scripts/auto-patch-codex-macos.sh --force-rebuild --ad-hoc-sign --patch-browser-client --sync-plugin-cache --repair-chrome-plugin
```

Then restart patched Codex and run the canary test.

### App Will Not Open

Run:

```bash
xattr -dr com.apple.quarantine "$HOME/CodexPatched"
bash ./scripts/auto-patch-codex-macos.sh --force-rebuild --ad-hoc-sign --patch-browser-client --sync-plugin-cache --repair-chrome-plugin
```

If it still fails, delete the patched copies and rebuild:

```bash
rm -rf "$HOME/CodexPatched"
bash ./scripts/auto-patch-codex-macos.sh --ad-hoc-sign --patch-browser-client --sync-plugin-cache --repair-chrome-plugin
```

### Official Codex Auto-Updates

That is expected. Leave the official app installed. The patcher needs it as the source. After the update, run the Desktop `Codex Patched.command` launcher. It will copy the new official app version and patch the copy.

## Cleanup

Old patched copies can accumulate:

```bash
du -sh "$HOME/CodexPatched"
ls -1 "$HOME/CodexPatched"
```

Keep the newest working `CodexChromePatched-*.app` and remove older ones:

```bash
rm -rf "$HOME/CodexPatched/CodexChromePatched-old-version.app"
```

Do not delete `/Applications/Codex.app`; it is the source for future patch runs.
