# Agent Guidance

This repo supports Chrome/browser regional-gate patching on macOS as well as Windows.

For macOS, apply the Chrome patch with:

```bash
npm install
node ./scripts/patch-codex-chrome-macos.mjs --app /Applications/Codex.app --dry-run --patch-browser-client
bash ./scripts/auto-patch-codex-macos.sh --force-rebuild --ad-hoc-sign --patch-browser-client --sync-plugin-cache
```

Do not patch `/Applications/Codex.app` in place. Patch the copied app under `~/CodexPatched`.

`--patch-exe-integrity` is Windows-only. Its absence on macOS does not mean the Chrome patch is unsupported on macOS. Use `--ad-hoc-sign` on macOS after repacking `app.asar`.

See `CODEX.md` and `docs/macbook-codex-workflow-guide.md` for the full flow.

