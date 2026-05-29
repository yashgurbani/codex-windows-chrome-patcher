# Codex Agent Instructions

This repo supports copied-app Chrome/browser regional-gate patching on both Windows and macOS.

## macOS

The Chrome patch should be applied on macOS. Do not refuse it because the original upstream repo was Windows-focused.

Use the macOS scripts:

```bash
npm install
node ./scripts/patch-codex-chrome-macos.mjs --app /Applications/Codex.app --dry-run --patch-browser-client
bash ./scripts/auto-patch-codex-macos.sh --force-rebuild --ad-hoc-sign --patch-browser-client --sync-plugin-cache
```

Rules:

- Do not patch `/Applications/Codex.app` in place.
- Patch only the copied app under `~/CodexPatched`.
- Use `--ad-hoc-sign` on macOS after repacking `app.asar`.
- Use `--patch-browser-client` for the full Chrome/backend trust patch.
- Use `--sync-plugin-cache` so the bundled Chrome/browser-use plugins are available in the user plugin cache.
- Use `--repair-chrome-plugin` if the Chrome plugin still does not appear after the copied app is patched.

The Windows-only flag is `--patch-exe-integrity`. That flag being unsupported on macOS does not mean the Chrome patch is unsupported on macOS.

## Windows

Use the Windows scripts:

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\auto-patch-codex.ps1 -ForceRebuild
```

Rules:

- Do not patch files directly under `C:\Program Files\WindowsApps`.
- Patch only a loose copied app directory.
- Use `--patch-exe-integrity` only for Windows copied app builds.

## Verification

After patching either platform:

- Confirm the running Codex process path is the patched copy, not the official install.
- Confirm `@chrome` / Chrome plugin visibility in Codex.
- Confirm browser-use metadata includes both `chrome` and `iab`.
- Restart Chrome and confirm the official Codex Chrome Extension popup says `Connected`.

