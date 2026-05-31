# Codex Chrome Patcher

Unofficial copied-app workaround for enabling the bundled Codex Chrome plugin in Europe or other regions where the Codex desktop app may hide Chrome/browser/computer-use support behind feature availability checks.

Use this when you want Codex on Windows or macOS to connect to the official Codex Chrome Extension and control your existing Chrome browser session.

This repo documents the exact approach we used:

1. Copy the installed Codex app into a writable copied-app location.
2. Patch `app.asar` in that copy so Chrome, in-app browser, computer-use, plugin, memories, and related renderer gates are enabled.
3. On Windows, patch the Electron ASAR integrity hash inside the copied `Codex.exe`.
4. On macOS, ad-hoc sign the copied `.app` after replacing `app.asar`.
5. Launch the patched copy.
6. Install, reconnect, or repair the official Codex Chrome Extension / native messaging host.

## Important Notes

- This is not an official OpenAI tool.
- This repo supports both Windows and macOS copied-app patching.
- The macOS Chrome patch is intentional and supported by this repo. Apply it to a copied app under `~/CodexPatched`; do not patch `/Applications/Codex.app` in place.
- Do not patch the installed Windows `WindowsApps` package in place. Windows AppX packages are signed and protected.
- This patch targets the current minified bundle markers. A Codex update may change those markers and require a script update.
- The patched app copy lives outside the official install and may need to be recreated after Codex updates.

## macOS Copied-App Chrome Patch

The macOS workflow is a first-class translated patch, not a no-op. It uses `.app` bundle paths:

- `scripts/patch-codex-chrome-macos.mjs`: patches a copied `Codex.app/Contents/Resources/app.asar`.
- `scripts/auto-patch-codex-macos.sh`: finds the installed `Codex.app`, copies it under `~/CodexPatched`, applies the Chrome/browser regional-gate patch, ad-hoc signs the copy, and launches it.
- `scripts/launch-patched-codex-macos.sh`: launches a patched `.app` copy and can sync the plugin cache.
- `scripts/reinstall-chrome-plugin-macos.mjs`: macOS path translation of the plugin reinstall helper.
- `test/patch-codex-chrome-macos.test.mjs`: fixture tests for the macOS bundle layout and shell wrappers.

Quick macOS dry-run against an explicit copied app:

```bash
npm install
node ./scripts/patch-codex-chrome-macos.mjs \
  --app /Applications/Codex.app \
  --dry-run \
  --patch-browser-client
```

Automatic copy, patch, ad-hoc sign, and launch:

```bash
bash ./scripts/auto-patch-codex-macos.sh \
  --force-rebuild \
  --ad-hoc-sign \
  --patch-browser-client \
  --sync-plugin-cache \
  --repair-chrome-plugin
```

The macOS patcher refuses only the Windows-specific `--patch-exe-integrity` flag. That refusal does not mean the Chrome patch should be skipped on macOS. The macOS equivalent post-patch step is `--ad-hoc-sign`, which runs `codesign --force --deep --sign -` on the copied app after `app.asar` is replaced.

The error `browser-client is not trusted` means the browser-client trust/cache patch did not run or a stale plugin cache is still being used. Fix it with the macOS patcher:

```bash
bash ./scripts/auto-patch-codex-macos.sh \
  --force-rebuild \
  --ad-hoc-sign \
  --patch-browser-client \
  --sync-plugin-cache \
  --repair-chrome-plugin
```

Do not run the Windows patcher on macOS. Only `--patch-exe-integrity` is Windows-specific; the Chrome/browser regional-gate transforms are implemented separately in `scripts/patch-codex-chrome-macos.mjs`.

## What This Enables

After the patch works, Codex should advertise both browser backends:

```json
["chrome", "iab"]
```

The Chrome extension popup should show `Connected`, and Codex should be able to see Chrome tabs through the Chrome plugin.

## Windows Requirements

- Windows
- Codex desktop app installed from Microsoft Store
- Node.js available
- `@electron/asar` installed for repacking `app.asar`
- Codex Chrome Extension installed in Chrome

## macOS Requirements

- macOS with official `Codex.app` installed, usually at `/Applications/Codex.app`
- Node.js and npm
- Xcode command line tools for `codesign` / standard developer utilities
- Codex Chrome Extension installed in Chrome
- Accessibility and Screen Recording permissions for the patched copied app if using computer-use

Install the ASAR tool inside this repo:

```powershell
pnpm install
```

## Quick Start

From PowerShell:

```powershell
cd .\codex-windows-chrome-patcher
npm install

powershell -ExecutionPolicy Bypass -File .\scripts\auto-patch-codex.ps1
```

The automatic patcher finds the newest Store-installed Codex package, copies it to a versioned writable folder under `C:\tmp`, patches that copy, and launches it.
On normal runs it reuses the already-patched versioned folder and skips the copy/repatch step. It only rebuilds when the target is missing, the patch marker is missing, or you pass `-ForceRebuild`.

To force a fresh copy after Codex updates:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\auto-patch-codex.ps1 -ForceRebuild
```

The automatic patcher also creates or updates a stable Start Menu shortcut named `Codex Patched` on each successful run. Pin that shortcut once. It points back to `auto-patch-codex.ps1`, not to a versioned patched app folder, so it survives Codex updates and cleanup.

To create shortcuts manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-patched-codex-shortcut.ps1
```

Create both Start Menu and Desktop shortcuts:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-patched-codex-shortcut.ps1 -ShortcutLocations Both
```

The shortcut is usually the easiest daily path. It runs the patcher first, so if Codex updated, the loose patched copy can be rebuilt before launch.
The shortcut runs PowerShell hidden, so it should not leave a terminal window sitting in the taskbar.

### PowerToys Copilot Key Remap

The Copilot key commonly appears to PowerToys as `Win (Left) + Shift (Left) + F23`. In Keyboard Manager, use `Open app`.

Do not put the `.ps1` file in **Program path**. Put PowerShell there, and put the script in **Arguments**:

```text
Program path:
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe

Arguments:
-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\yashg\Documents\Codex\2026-05-13\help-me-implement-https-github-com\scripts\auto-patch-codex.ps1" -OutputRoot "C:\tmp"

Start in directory:
C:\Users\yashg\Documents\Codex\2026-05-13\help-me-implement-https-github-com\scripts

Run as:
Normal

If already running:
Start another

Window visibility:
Hidden
```

To print the exact values for this checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\show-powertoys-copilot-remap.ps1
```

If PowerToys does not launch PowerShell reliably, build the no-console launcher exe and point PowerToys at that instead:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-copilot-launcher-exe.ps1
```

Then use:

```text
Program path:
C:\Users\yashg\Documents\Codex\2026-05-13\help-me-implement-https-github-com\bin\CodexPatchedLauncher.exe

Arguments:
<leave blank>

Window visibility:
Hidden
```

Manual flow:

```powershell
cd .\codex-windows-chrome-patcher
npm install

$source = (Get-ChildItem "C:\Program Files\WindowsApps" -Directory -Filter "OpenAI.Codex_*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$target = "C:\tmp\CodexChromePatched"

Copy-Item -LiteralPath $source -Destination $target -Recurse
node .\scripts\patch-codex-chrome-windows.mjs --app $target --apply --patch-exe-integrity
powershell -ExecutionPolicy Bypass -File .\scripts\launch-patched-codex.ps1 -AppRoot $target
```

If your Codex version folder differs, adjust `$source`. You can find it with:

```powershell
Get-ChildItem "C:\Program Files\WindowsApps" -Directory -Filter "OpenAI.Codex_*"
```

## What Happens When Codex Updates

Microsoft Store updates install a new protected package under `C:\Program Files\WindowsApps`, for example:

```text
OpenAI.Codex_<new-version>_x64__2p2nqsd0c76g0
```

Your loose patched copy, such as `C:\tmp\CodexChromePatched`, is not automatically updated. After a Codex update, one of these will usually be true:

- The Store version has the official feature enabled, and this patch is no longer needed.
- The Store version still hides Chrome, and you need to create a fresh loose copy from the new Store package and patch it again.
- The app bundle changed enough that the script cannot find its markers, and the script must be updated.

Recommended update flow:

1. Close Codex and Chrome.
2. Run `powershell -ExecutionPolicy Bypass -File .\scripts\auto-patch-codex.ps1 -ForceRebuild`.
3. Open Chrome and confirm the extension says `Connected`.
4. Verify Codex can see the Chrome backend before deleting any previous patched copy.

Keep one older working patched copy until the new one is verified.

### Automatic Patcher Options

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\auto-patch-codex.ps1 `
  -OutputRoot "C:\tmp" `
  -ForceRebuild
```

- `-OutputRoot`: where versioned patched app copies are stored.
- `-TargetRoot`: exact patched app directory to use instead of the versioned default.
- `-ForceRebuild`: delete and recreate the target from the newest Store package.
- `-NoLaunch`: patch only.
- `-NoShortcut`: do not create or update the dynamic Start Menu shortcut.
- `-NoPaseo`: do not update Paseo's Codex provider override.
- `-ShortcutName`: name for the generated `.lnk`; default is `Codex Patched`.
- `-ShortcutLocations`: `StartMenu`, `Desktop`, `Both`, `None`, or comma-separated values; default is `StartMenu`.
- `-RepairChromePlugin`: ask Codex to reinstall the bundled Chrome plugin during launch. Enabled by default; use `-NoRepairChromePlugin` to skip.
- `-SyncPluginCache`: sync the bundled Chrome/browser-use plugins into the user cache. Enabled by default; use `-NoSyncPluginCache` to skip.
- `-PatchBrowserClient`: patches bundled/user-cache browser client trust and backend checks. Enabled by default; use `-NoPatchBrowserClient` only when intentionally testing the minimal app-asar-only patch.

### Memories

The patcher also forces the desktop renderer to expose Codex Memories in Personalization and to treat the supported desktop experimental features as enabled even when the regional feature list hides them.

The matching `config.toml` settings are:

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

To add or refresh that block in your user config with a timestamped backup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-codex-memories.ps1
```

### Windows Remote Connections

Codex now has native Windows remote connections support. This repo no longer starts a custom localhost remote-control app-server or forces remote-control config keys. Use the native Codex remote connection UI after launching the patched app.

### Paseo

The automatic patcher also configures Paseo's built-in Codex provider to use the newest patched `codex.exe` directly. Using the direct executable avoids a Windows `cmd.exe` wrapper between Paseo and Codex, which makes stdio and process cleanup more reliable.

It also patches Paseo's Codex import path so the import dialog lists sessions from cheap `thread/list` metadata instead of hydrating every full Codex timeline during discovery. The actual imported session still hydrates history after you choose it.

Refresh the provider override manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-paseo-codex-provider.ps1
```

Paseo reads this provider config when its daemon starts. If its diagnostic still shows `C:\Users\...\AppData\Roaming\npm\codex.CMD`, restart the Paseo daemon after saving any running Paseo agents.

If the import dialog times out or says no Codex sessions are found, run:

```powershell
node .\scripts\patch-paseo-codex-import.mjs
```

Then restart Paseo so its daemon loads the patched app code.

## Verify

In Codex, ask to use Chrome or run a Chrome-backed check. The expected state is:

- Codex process path is the loose copy, for example `C:\tmp\CodexChromePatched\app\Codex.exe`.
- The Chrome extension popup says `Connected`.
- Codex can list open Chrome tabs.

If the extension says disconnected:

1. Make sure the patched Codex copy is running, not the Store copy.
2. Restart Chrome.
3. Open the extension popup once.
4. Confirm the extension is installed in the Chrome profile you are using.

## Restore / Rollback

For a loose copy, rollback is simple:

```powershell
Remove-Item -LiteralPath "C:\tmp\CodexChromePatched" -Recurse -Force
```

If you used the patch script on another copy and want to restore its `app.asar` from backup:

```powershell
node .\scripts\patch-codex-chrome-windows.mjs --app "C:\tmp\CodexChromePatched" --restore "C:\tmp\CodexChromePatched\app\resources\app.asar.bak-..."
```

## How It Works

Codex ships a bundled Chrome plugin, but the desktop bundle checks feature flags before exposing it. This patch changes the relevant minified feature checks so Chrome browser use is treated as available.

The patch modifies:

- The main Electron bundle feature defaults.
- The main bundle plugin availability predicates.
- The renderer feature dispatch value.
- The renderer/plugin filters that hide Chrome, browser-use, computer-use, and memories when regional gates are off.
- The bundled/user plugin browser-client files so Chrome backend trust and discovery checks do not re-hide the backend.
- On Windows only, the copied `Codex.exe` embedded ASAR header hash, so Electron accepts the repacked ASAR in a loose copy.
- On macOS only, the copied `.app` code signature via ad-hoc signing after `app.asar` is replaced.

## Troubleshooting

### The patch script cannot find markers

Codex updated and the minified JavaScript changed. Extract the new `app.asar`, search for `externalBrowserUse`, and update the markers in `scripts/patch-codex-chrome-windows.mjs`.

### The extension is connected but Codex cannot see Chrome

Restart the patched Codex copy, restart Chrome, then open the extension popup. In our testing, the runtime sometimes needed one extra browser setup retry before the `extension` backend appeared.

### The native host checker says HKCU registry key is missing

If the extension popup says `Connected`, Chrome already found the native host. Some sandboxed checks may read a different HKCU view. Treat the popup plus a running `extension-host.exe` process as stronger evidence.

## Prompt for a Local Agent

Paste the matching prompt into a capable local coding agent when Codex updates or when the patch stops applying.

### macOS Agent Prompt

```text
You are working on macOS. The goal is to enable Codex desktop Chrome browser use in Europe or another region-gated install by patching a copied Codex.app bundle. The macOS Chrome patch is supported by this repo and should be applied. Do not patch /Applications/Codex.app in place.

Safety rules:
- Do not modify /Applications/Codex.app directly.
- Patch only a copied app under ~/CodexPatched.
- Do not delete the previous working patched copy until the new patched copy is verified.
- Do not inspect or export Chrome cookies, passwords, tokens, or local storage.
- Prefer dry-run first, then apply only if all markers are found.

Tasks:
1. Locate the official Codex.app:
   ls -ld /Applications/Codex.app || mdfind "kMDItemFSName == 'Codex.app'"
2. Install repo dependencies if node_modules is missing:
   npm install
3. Run a dry-run against the official app bundle:
   node ./scripts/patch-codex-chrome-macos.mjs --app /Applications/Codex.app --dry-run --patch-browser-client
4. If dry-run succeeds, run the automatic copied-app patcher:
   bash ./scripts/auto-patch-codex-macos.sh --force-rebuild --ad-hoc-sign --patch-browser-client --sync-plugin-cache --repair-chrome-plugin
5. Launch only the patched copy under ~/CodexPatched. Do not launch /Applications/Codex.app when testing.
6. Verify the running Codex process path is under ~/CodexPatched:
   ps aux | grep -i '[C]odex'
7. Restart Chrome, open the Codex Chrome Extension popup, and confirm it says Connected.
8. In Codex, verify that browser-use metadata includes chrome and iab, @chrome is visible, and the Chrome backend can list open Chrome tabs.

If regional restrictions still appear, or Chrome fails with `browser-client is not trusted`:
1. Force rebuild:
   bash ./scripts/auto-patch-codex-macos.sh --force-rebuild --ad-hoc-sign --patch-browser-client --sync-plugin-cache --repair-chrome-plugin
2. Confirm the process path is not /Applications/Codex.app.
3. If the patcher fails because markers are missing, run:
   bash ./scripts/inspect-codex-macos.sh ./codex-macos-report.txt
4. Search the extracted bundle for externalBrowserUse, externalBrowserUseAllowed, inAppBrowserUse, computerUse, memories, plugin availability, and browser-client trust checks.
5. Update scripts/patch-codex-chrome-macos.mjs with the new exact minified markers.
6. Re-run dry-run, then apply only after all markers are found.

Expected result:
- Codex request metadata advertises ["chrome", "iab"].
- agent.browsers.list() includes a browser named Chrome with type extension.
- The official Codex Chrome Extension popup says Connected.
```

### Windows Agent Prompt

```text
You are working on Windows. The goal is to enable Codex desktop Chrome browser use in Europe or another region-gated install by patching a loose copy of the Codex desktop app. The patch should expose the bundled Codex Chrome plugin so Codex can connect to the official Codex Chrome Extension. Do not modify the protected Microsoft Store package in place.

Safety rules:
- Do not patch files directly under C:\Program Files\WindowsApps.
- Do not delete the previous working patched copy until the new patched copy is verified.
- Do not inspect or export Chrome cookies, passwords, tokens, or local storage.
- Prefer read-only investigation first, then patch a copied loose app directory.

Tasks:
1. Locate the newest installed Codex package:
   Get-ChildItem "C:\Program Files\WindowsApps" -Directory -Filter "OpenAI.Codex_*"
2. Copy that package to a writable loose directory, for example:
   C:\tmp\CodexChromePatched-<version>
3. Install repo dependencies with pnpm install if node_modules is missing.
4. Run:
   node .\scripts\patch-codex-chrome-windows.mjs --app "<loose-copy-path>" --dry-run
5. If dry-run succeeds, run:
   node .\scripts\patch-codex-chrome-windows.mjs --app "<loose-copy-path>" --apply --patch-exe-integrity
6. Launch the patched copy with:
   powershell -ExecutionPolicy Bypass -File .\scripts\launch-patched-codex.ps1 -AppRoot "<loose-copy-path>"
7. Confirm only the patched Codex.exe is running.
8. Start Chrome, open the Codex Chrome Extension popup, and confirm it says Connected.
9. In Codex, verify that browser-use metadata includes chrome and iab, and that the Chrome backend can list open Chrome tabs.

If the patcher fails because markers are missing:
1. Extract the new app.asar to a temporary folder.
2. Search the extracted bundle for externalBrowserUse, externalBrowserUseAllowed, chrome, and bundled plugin availability checks.
3. Identify the new minified equivalents of:
   - externalBrowserUse default false flags
   - externalBrowserUseAllowed checks around Chrome plugin availability
   - renderer feature dispatch for externalBrowserUse
4. Update scripts/patch-codex-chrome-windows.mjs with the new exact markers.
5. Re-run dry-run, then apply only after all markers are found.
6. Document the new Codex version and marker changes in the README.

Expected result:
- Codex request metadata advertises ["chrome", "iab"].
- agent.browsers.list() includes a browser named Chrome with type extension.
- The official Codex Chrome Extension popup says Connected.
```

## Files

- `scripts/patch-codex-chrome-windows.mjs`: patches a Codex app copy.
- `scripts/launch-patched-codex.ps1`: closes Store Codex processes and launches the patched copy.
- `scripts/auto-patch-codex.ps1`: finds the newest installed Codex package, creates or refreshes a patched copy, updates the dynamic shortcut, and optionally launches it.
- `scripts/create-patched-codex-shortcut.ps1`: creates Start Menu/Desktop shortcuts to the automatic patcher.
- `scripts/show-powertoys-copilot-remap.ps1`: prints exact PowerToys Keyboard Manager fields for binding the Copilot key.
- `scripts/build-copilot-launcher-exe.ps1`: builds a tiny no-console launcher exe for PowerToys bindings that do not run PowerShell commands reliably.
- `scripts/configure-codex-memories.ps1`: adds or refreshes the `[features]` and `[memories]` blocks in `~/.codex/config.toml` with a backup when changes are needed.
- `scripts/configure-paseo-codex-provider.ps1`: points Paseo's Codex provider at the patched Codex CLI.
- `scripts/patch-paseo-codex-import.mjs`: patches Paseo's Codex import discovery to avoid full-history hydration during the import list step.
- `scripts/codex-patched-cli.cmd`: stable command wrapper for tools like Paseo.
- `scripts/resolve-patched-codex-cli.ps1`: resolves the newest patched Codex CLI.
- `launcher/CodexPatchedLauncher.cs`: source for the no-console launcher exe.
