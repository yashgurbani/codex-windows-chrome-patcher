#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const WINDOWS_APPS = "C:\\Program Files\\WindowsApps";
const PACKAGE_SUFFIX = "_x64__2p2nqsd0c76g0";
const ORIGINAL_ASAR_HEADER_HASH =
  "0914b5a1cd66a81962edb46e3f8ac49bc574144a4460ec55ff46010273eda9fd";

function findLatestCodexApp() {
  if (!existsSync(WINDOWS_APPS)) return null;
  const candidates = readdirSync(WINDOWS_APPS)
    .filter((name) => name.startsWith("OpenAI.Codex_") && name.endsWith(PACKAGE_SUFFIX))
    .map((name) => join(WINDOWS_APPS, name))
    .filter((path) => existsSync(join(path, "app", "resources", "app.asar")))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function localAsarTool() {
  return join(process.cwd(), "node_modules", "@electron", "asar", "bin", "asar.mjs");
}

function usage() {
  console.log(`Usage:
  node scripts/patch-codex-chrome-windows.mjs [--app PATH] [--asar PATH] [--node PATH] [--work PATH] [--dry-run] [--apply] [--patch-exe-integrity]
  node scripts/patch-codex-chrome-windows.mjs --restore BACKUP_PATH [--app PATH]

Defaults:
  --app   CODEX_APP_ROOT env var, or latest OpenAI.Codex package under WindowsApps
  --asar  ASAR_BIN env var, or ./node_modules/@electron/asar/bin/asar.mjs
  --node  NODE_EXE env var, or app/resources/node.exe

Use this on a copied loose Codex app directory, not the protected WindowsApps package.`);
}

function parseArgs(argv) {
  const app = process.env.CODEX_APP_ROOT || findLatestCodexApp();
  const opts = {
    app,
    asar: process.env.ASAR_BIN || localAsarTool(),
    node: process.env.NODE_EXE || null,
    work: null,
    dryRun: false,
    apply: false,
    restore: null,
    patchExeIntegrity: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--apply") opts.apply = true;
    else if (arg === "--patch-exe-integrity") opts.patchExeIntegrity = true;
    else if (arg === "--restore") opts.restore = argv[++i];
    else if (arg.startsWith("--restore=")) opts.restore = arg.slice("--restore=".length);
    else if (arg === "--app") opts.app = argv[++i];
    else if (arg.startsWith("--app=")) opts.app = arg.slice("--app=".length);
    else if (arg === "--asar") opts.asar = argv[++i];
    else if (arg.startsWith("--asar=")) opts.asar = arg.slice("--asar=".length);
    else if (arg === "--node") opts.node = argv[++i];
    else if (arg.startsWith("--node=")) opts.node = arg.slice("--node=".length);
    else if (arg === "--work") opts.work = argv[++i];
    else if (arg.startsWith("--work=")) opts.work = arg.slice("--work=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (opts.app == null) throw new Error("Could not auto-detect Codex app. Pass --app PATH.");
  opts.app = resolve(opts.app);
  opts.node ??= join(opts.app, "app", "resources", "node.exe");

  if (opts.dryRun && opts.apply) throw new Error("Use either --dry-run or --apply, not both.");
  if (!opts.apply) opts.dryRun = true;
  return opts;
}

function asarHeaderHash(asarPath) {
  const buffer = readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(12);
  return createHash("sha256").update(buffer.subarray(16, 16 + headerSize)).digest("hex");
}

function patchExeAsarIntegrity(appRoot, newHash) {
  const exePath = join(appRoot, "app", "Codex.exe");
  const exe = readFileSync(exePath);
  const before = Buffer.from(ORIGINAL_ASAR_HEADER_HASH, "utf8");
  const after = Buffer.from(newHash, "utf8");
  const idx = exe.indexOf(before);
  if (idx < 0) throw new Error(`Original ASAR header hash not found in ${exePath}`);
  if (exe.indexOf(before, idx + 1) >= 0) {
    throw new Error(`Original ASAR header hash appears multiple times in ${exePath}`);
  }
  after.copy(exe, idx);
  writeFileSync(exePath, exe);
  return { exePath, oldHash: ORIGINAL_ASAR_HEADER_HASH, newHash };
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function replaceOnce(text, search, replacement, label, changes) {
  const next = text.replace(search, replacement);
  if (next === text) {
    changes.missing.push(label);
    return text;
  }
  changes.changed.push(label);
  return next;
}

function patchMain(root) {
  const file = join(root, ".vite", "build", "main-DcB8P4Mu.js");
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "externalBrowserUse:!1,externalBrowserUseAllowed:!1",
    "externalBrowserUse:!0,externalBrowserUseAllowed:!0",
    "main default external browser availability",
    changes,
  );

  text = replaceOnce(
    text,
    "name:lt,isAvailable:({buildFlavor:e,features:t})=>t.externalBrowserUseAllowed&&Yn(e)",
    "name:lt,isAvailable:()=>!0",
    "main chrome bundled plugin availability",
    changes,
  );

  text = replaceOnce(
    text,
    "name:e.On,isAvailable:({buildFlavor:e,features:t})=>Jn(e)&&t.externalBrowserUseAllowed",
    "name:e.On,isAvailable:()=>!0",
    "main external browser helper plugin availability",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function patchRenderer(root) {
  const file = join(root, "webview", "assets", "app-main-BssxuQ1L.js");
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "externalBrowserUse:d.available,externalBrowserUseAllowed:d.allowed",
    "externalBrowserUse:!0,externalBrowserUseAllowed:!0",
    "renderer desktop feature dispatch external browser",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function assertAllMarkersFound(results) {
  const missing = results.flatMap((result) => result.missing.map((label) => `${label} in ${result.file}`));
  if (missing.length > 0) {
    throw new Error(`Patch markers missing:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  }
}

function patchTree(root) {
  const results = [patchMain(root), patchRenderer(root)];
  assertAllMarkersFound(results);
  return results;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const appRoot = resolve(opts.app);
  const asarPath = join(appRoot, "app", "resources", "app.asar");

  if (opts.restore != null) {
    const backup = resolve(opts.restore);
    if (!existsSync(backup)) throw new Error(`Missing backup: ${backup}`);
    cpSync(backup, asarPath);
    console.log(`Restored ${asarPath} from ${backup}`);
    return;
  }

  const work = opts.work == null ? join("C:\\tmp", `codex-chrome-patch-${Date.now()}`) : resolve(opts.work);
  for (const required of [asarPath, opts.asar, opts.node]) {
    if (!existsSync(required)) throw new Error(`Missing required path: ${required}`);
  }

  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
  mkdirSync(dirname(work), { recursive: true });
  run(opts.node, [opts.asar, "extract", asarPath, work]);

  const results = patchTree(work);
  console.log(JSON.stringify({ mode: opts.apply ? "apply" : "dry-run", appRoot, work, results }, null, 2));

  if (!opts.apply) {
    console.log("Dry run complete. Extracted patched tree left in place; app.asar was not changed.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${asarPath}.bak-${stamp}`;
  const packed = join("C:\\tmp", `codex-chrome-patched-${stamp}.asar`);
  run(opts.node, [opts.asar, "pack", work, packed]);
  cpSync(asarPath, backup);
  cpSync(packed, asarPath);

  const exePatch = opts.patchExeIntegrity ? patchExeAsarIntegrity(appRoot, asarHeaderHash(asarPath)) : null;
  console.log(`Applied patch. Backup: ${backup}`);
  console.log(`Temporary patched ASAR: ${packed}`);
  if (exePatch != null) {
    console.log(`Patched Electron ASAR integrity in ${exePatch.exePath}: ${exePatch.oldHash} -> ${exePatch.newHash}`);
  } else {
    console.log("Electron EXE ASAR integrity was not patched. Use --patch-exe-integrity for loose-copy experiments.");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

