#!/usr/bin/env node
import asar from "@electron/asar";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const { createPackage, extractAll } = asar;

const WINDOWS_APPS = "C:\\Program Files\\WindowsApps";
const PACKAGE_SUFFIX = "_x64__2p2nqsd0c76g0";
const ORIGINAL_ASAR_HEADER_HASH =
  "0914b5a1cd66a81962edb46e3f8ac49bc574144a4460ec55ff46010273eda9fd";
const FORCED_EXPERIMENTAL_FEATURES =
  "apps:!0,memories:!0,plugins:!0,browser_use:!0,browser_use_external:!0,computer_use:!0,in_app_browser:!0,tool_search:!0,tool_suggest:!0,tool_call_mcp_elicitation:!0";

function forcedFeatureOverrideFunction(functionName, featureListName) {
  return `function ${functionName}(e){let t={${FORCED_EXPERIMENTAL_FEATURES}};for(let n of ${featureListName}){let r=e[n];r!=null&&(t[n]=t[n]===!0?!0:r)}return t}`;
}

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
  const binDir = join(process.cwd(), "node_modules", "@electron", "asar", "bin");
  const candidates = [join(binDir, "asar.mjs"), join(binDir, "asar.js")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function usage() {
  console.log(`Usage:
  node scripts/patch-codex-chrome-windows.mjs [--app PATH] [--asar PATH] [--node PATH] [--work PATH] [--dry-run] [--apply] [--patch-exe-integrity] [--patch-user-plugin-cache] [--patch-browser-client] [--plugin-cache PATH] [--cache-only]
  node scripts/patch-codex-chrome-windows.mjs --restore BACKUP_PATH [--app PATH]

Defaults:
  --app   CODEX_APP_ROOT env var, or latest OpenAI.Codex package under WindowsApps
  --asar  accepted for compatibility; ASAR work uses the @electron/asar library
  --node  accepted for compatibility; no separate Node executable is spawned
  --plugin-cache  CODEX_PLUGIN_CACHE_ROOT env var, or ~/.codex/plugins/cache/openai-bundled
  --patch-browser-client  advanced: also patch browser-client.mjs policy gates. This changes the trusted file hash.

Use this on a copied loose Codex app directory, not the protected WindowsApps package.`);
}

function defaultPluginCacheRoot() {
  return process.env.CODEX_PLUGIN_CACHE_ROOT || join(homedir(), ".codex", "plugins", "cache", "openai-bundled");
}

function parseArgs(argv) {
  const opts = {
    app: process.env.CODEX_APP_ROOT || null,
    asar: process.env.ASAR_BIN || localAsarTool(),
    node: process.env.NODE_EXE || null,
    work: null,
    dryRun: false,
    apply: false,
    restore: null,
    patchExeIntegrity: false,
    patchUserPluginCache: false,
    patchBrowserClient: false,
    pluginCache: defaultPluginCacheRoot(),
    cacheOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--apply") opts.apply = true;
    else if (arg === "--patch-exe-integrity") opts.patchExeIntegrity = true;
    else if (arg === "--patch-user-plugin-cache") opts.patchUserPluginCache = true;
    else if (arg === "--patch-browser-client") opts.patchBrowserClient = true;
    else if (arg === "--cache-only") opts.cacheOnly = true;
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
    else if (arg === "--plugin-cache") opts.pluginCache = argv[++i];
    else if (arg.startsWith("--plugin-cache=")) opts.pluginCache = arg.slice("--plugin-cache=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  opts.app ??= findLatestCodexApp();
  if (opts.app == null) throw new Error("Could not auto-detect Codex app. Pass --app PATH.");
  opts.app = resolve(opts.app);
  opts.pluginCache = resolve(opts.pluginCache);
  opts.node ??= join(opts.app, "app", "resources", "node.exe");

  if (opts.dryRun && opts.apply) throw new Error("Use either --dry-run or --apply, not both.");
  if (opts.cacheOnly && !opts.patchUserPluginCache) {
    throw new Error("--cache-only requires --patch-user-plugin-cache.");
  }
  if (!opts.apply) opts.dryRun = true;
  return opts;
}

function asarHeaderHash(asarPath) {
  const buffer = readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(12);
  return createHash("sha256").update(buffer.subarray(16, 16 + headerSize)).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function backupAsarHeaderHashes(appRoot) {
  const resources = join(appRoot, "app", "resources");
  if (!existsSync(resources)) return [];
  return readdirSync(resources)
    .filter((name) => name.startsWith("app.asar.bak-"))
    .map((name) => {
      try {
        return asarHeaderHash(join(resources, name));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function findUniqueHashOffset(exe, hash, exePath) {
  const needle = Buffer.from(hash, "utf8");
  const idx = exe.indexOf(needle);
  if (idx < 0) return -1;
  if (exe.indexOf(needle, idx + 1) >= 0) {
    throw new Error(`ASAR header hash ${hash} appears multiple times in ${exePath}`);
  }
  return idx;
}

function patchExeAsarIntegrity(appRoot, newHash, previousHashes = []) {
  const exePath = join(appRoot, "app", "Codex.exe");
  const exe = readFileSync(exePath);
  const after = Buffer.from(newHash, "utf8");

  const alreadyPatchedIdx = findUniqueHashOffset(exe, newHash, exePath);
  if (alreadyPatchedIdx >= 0) {
    return { exePath, oldHash: newHash, newHash, alreadyPatched: true };
  }

  const candidates = unique([...previousHashes, ...backupAsarHeaderHashes(appRoot), ORIGINAL_ASAR_HEADER_HASH])
    .filter((hash) => hash !== newHash);
  const matches = candidates
    .map((hash) => ({ hash, idx: findUniqueHashOffset(exe, hash, exePath) }))
    .filter((match) => match.idx >= 0);

  if (matches.length === 0) {
    return {
      exePath,
      oldHash: null,
      newHash,
      alreadyPatched: false,
      skipped: true,
      reason: "no known ASAR header hash found",
    };
  }
  if (matches.length > 1) {
    throw new Error(`Multiple possible ASAR header hashes found in ${exePath}: ${matches.map((match) => match.hash).join(", ")}`);
  }

  const [{ hash: oldHash, idx }] = matches;
  after.copy(exe, idx);
  writeFileSync(exePath, exe);
  return { exePath, oldHash, newHash, alreadyPatched: false };
}

function replaceOnce(text, search, replacement, label, changes) {
  const next = text.replace(search, replacement);
  if (next === text) {
    if (text.includes(replacement)) {
      changes.changed.push(`${label} (already patched)`);
      return text;
    }
    changes.missing.push(label);
    return text;
  }
  changes.changed.push(label);
  return next;
}

function replaceOneOf(text, searches, replacement, label, changes) {
  for (const search of searches) {
    const next = text.replace(search, replacement);
    if (next !== text) {
      changes.changed.push(label);
      return next;
    }
  }
  if (text.includes(replacement)) {
    changes.changed.push(`${label} (already patched)`);
    return text;
  }
  changes.missing.push(label);
  return text;
}

function replaceRegexOnce(text, search, replacement, label, changes, alreadyPatched) {
  const next = text.replace(search, replacement);
  if (next === text) {
    if (alreadyPatched?.test(text)) {
      changes.changed.push(`${label} (already patched)`);
      return text;
    }
    changes.missing.push(label);
    return text;
  }
  changes.changed.push(label);
  return next;
}

function markerMatches(text, marker) {
  return typeof marker === "string" ? text.includes(marker) : marker.test(text);
}

function findJsAssetContaining(root, pathParts, markers, label) {
  const dir = join(root, ...pathParts);
  const matches = readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => {
      const file = join(dir, name);
      const text = readFileSync(file, "utf8");
      const score = markers.filter((marker) => markerMatches(text, marker)).length;
      return { file, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  if (matches.length === 0) {
    throw new Error(`Could not find ${label} under ${dir}`);
  }
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    throw new Error(`Could not uniquely identify ${label} under ${dir}: ${matches.map((match) => match.file).join(", ")}`);
  }
  return matches[0].file;
}

function patchMain(root) {
  const file = findJsAssetContaining(
    root,
    [".vite", "build"],
    [
      "CODEX_ELECTRON_DESKTOP_FEATURE_OVERRIDES",
      "bundled_plugins_reconcile_started",
      "browserUseConfig:{computerUse:",
      "externalBrowserUse:!1,externalBrowserUseAllowed:!1",
      "externalBrowserUse:!0,externalBrowserUseAllowed:!0",
      "{forceReload:!0,name:lt,isAvailable:({buildFlavor:e,features:t})=>t.externalBrowserUseAllowed&&Yn(e)}",
      /function \w+\(e\)\{let t=\[\];return e\.externalBrowserUse&&t\.push\(`chrome`\),e\.inAppBrowserUse&&t\.push\(`iab`\),t\}/,
      /function \w+\(e\)\{let t=\[`chrome`\];return e\.inAppBrowserUse&&t\.push\(`iab`\),t\}/,
    ],
    "main Electron bundle",
  );
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "externalBrowserUse:!1,externalBrowserUseAllowed:!1",
    "externalBrowserUse:!0,externalBrowserUseAllowed:!0",
    "main default external browser availability",
    changes,
  );

  text = replaceOneOf(
    text,
    [
      "inAppBrowserUse:!1,inAppBrowserUseAllowed:!1,externalBrowserUse:!1,externalBrowserUseAllowed:!1,computerUse:!1,computerUseNodeRepl:!1",
      "inAppBrowserUse:!1,inAppBrowserUseAllowed:!1,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:!1,computerUseNodeRepl:!1",
    ],
    "inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:!0,computerUseNodeRepl:!0",
    "main default browser and computer-use feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,name:lt,isAvailable:({buildFlavor:e,features:t})=>t.externalBrowserUseAllowed&&Yn(e)}",
    "{installWhenMissing:!0,name:lt,isAvailable:()=>!0}",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,name:dt,isAvailable:({buildFlavor:e,features:t})=>t.externalBrowserUseAllowed&&sr(e)}",
    "{installWhenMissing:!0,name:dt,isAvailable:()=>!0}",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{autoInstallOptOutKey:e.Nn(e.Dn),forceReload:!0,installWhenMissing:!0,name:e.Dn,isAvailable:({features:e})=>e.inAppBrowserUseAllowed,migrate:$n}",
    "{autoInstallOptOutKey:e.Nn(e.Dn),installWhenMissing:!0,name:e.Dn,isAvailable:()=>!0,migrate:$n}",
    "main browser-use bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{autoInstallOptOutKey:e.yn(e.pn),forceReload:!0,installWhenMissing:!0,name:e.pn,isAvailable:({features:e})=>e.inAppBrowserUseAllowed,migrate:dr}",
    "{autoInstallOptOutKey:e.yn(e.pn),installWhenMissing:!0,name:e.pn,isAvailable:()=>!0,migrate:dr}",
    "main browser-use bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{autoInstallOptOutKey:e.Jn(e.Hn),forceReload:!0,installWhenMissing:!0,name:e.Hn,isAvailable:({features:e})=>e.inAppBrowserUseAllowed,migrate:Ir}",
    "{autoInstallOptOutKey:e.Jn(e.Hn),installWhenMissing:!0,name:e.Hn,isAvailable:()=>!0,migrate:Ir}",
    "main browser-use bundled plugin install policy and availability",
    changes,
  );

  text = replaceRegexOnce(
    text,
    /\{autoInstallOptOutKey:e\.Jn\(e\.Hn\),forceReload:!0,installWhenMissing:!0,name:e\.Hn,isAvailable:\(\{features:e\}\)=>e\.inAppBrowserUseAllowed,migrate:(\w+)\}/,
    "{autoInstallOptOutKey:e.Jn(e.Hn),installWhenMissing:!0,name:e.Hn,isAvailable:()=>!0,migrate:$1}",
    "main browser-use bundled plugin install policy and availability",
    changes,
    /\{autoInstallOptOutKey:e\.Jn\(e\.Hn\),installWhenMissing:!0,name:e\.Hn,isAvailable:\(\)=>!0,migrate:\w+\}/,
  );

  text = replaceOnce(
    text,
    "{autoInstallOptOutKey:e.rr(e.Zn),forceReload:!0,installWhenMissing:!0,name:e.Zn,isAvailable:({features:e})=>e.inAppBrowserUseAllowed,migrate:qi}",
    "{autoInstallOptOutKey:e.rr(e.Zn),installWhenMissing:!0,name:e.Zn,isAvailable:()=>!0,migrate:qi}",
    "main browser-use bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "name:e.On,isAvailable:({buildFlavor:e,features:t})=>Jn(e)&&t.externalBrowserUseAllowed",
    "name:e.On,isAvailable:()=>!0",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "name:e.mn,isAvailable:({buildFlavor:e,env:t,features:n})=>or(e,t)&&n.externalBrowserUseAllowed",
    "name:e.mn,isAvailable:()=>!0",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,name:Ae,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,env:t,features:n})=>Ar(e,t)&&n.externalBrowserUseAllowed}",
    "{installWhenMissing:!0,name:Ae,syncInstallStateWithChromeExtension:!0,isAvailable:()=>!0}",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,name:e.Un,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,env:t,features:n})=>jr(e,t)&&n.externalBrowserUseAllowed}",
    "{installWhenMissing:!0,name:e.Un,syncInstallStateWithChromeExtension:!0,isAvailable:()=>!0}",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,name:ke,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,features:t})=>t.externalBrowserUseAllowed&&Mr(e)}",
    "{installWhenMissing:!0,name:ke,syncInstallStateWithChromeExtension:!0,isAvailable:()=>!0}",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,name:dt,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,env:t,features:n})=>Bi(e,t)&&n.externalBrowserUseAllowed}",
    "{installWhenMissing:!0,name:dt,syncInstallStateWithChromeExtension:!0,isAvailable:()=>!0}",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,name:e.Qn,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,env:t,features:n})=>Vi(e,t)&&n.externalBrowserUseAllowed}",
    "{installWhenMissing:!0,name:e.Qn,syncInstallStateWithChromeExtension:!0,isAvailable:()=>!0}",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,name:ut,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,features:t})=>t.externalBrowserUseAllowed&&Hi(e)}",
    "{installWhenMissing:!0,name:ut,syncInstallStateWithChromeExtension:!0,isAvailable:()=>!0}",
    "main chrome bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{installWhenMissing:!0,name:e.kn,isAvailable:({buildFlavor:e,features:n,platform:r})=>t.T.isInternal(e)&&r===`win32`&&n.computerUse}",
    "{installWhenMissing:!0,name:e.kn,isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse}",
    "main windows computer-use plugin availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,installWhenMissing:!0,name:e.Wn,isAvailable:({buildFlavor:e,features:n,platform:r})=>t.O.isInternal(e)&&r===`win32`&&n.computerUse}",
    "{installWhenMissing:!0,name:e.Wn,isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse}",
    "main windows computer-use plugin availability",
    changes,
  );

  text = replaceRegexOnce(
    text,
    /\{forceReload:!0,installWhenMissing:!0,name:e\.Wn,isAvailable:\(\{buildFlavor:e,features:t,platform:n\}\)=>(\w+)\(e\)&&n===`win32`&&t\.computerUse\}/,
    "{installWhenMissing:!0,name:e.Wn,isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse}",
    "main windows computer-use plugin availability",
    changes,
    /\{installWhenMissing:!0,name:e\.Wn,isAvailable:\(\{features:e,platform:t\}\)=>t===`win32`&&e\.computerUse\}/,
  );

  text = replaceOnce(
    text,
    "{forceReload:!0,installWhenMissing:!0,name:e.hn,isAvailable:({buildFlavor:e,features:n,platform:r})=>t.D.isInternal(e)&&r===`win32`&&n.computerUse}",
    "{installWhenMissing:!0,name:e.hn,isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse}",
    "main windows computer-use plugin availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{name:e.$n,isAvailable:({buildFlavor:e,features:t,platform:n})=>Ui(e)&&n===`win32`&&t.computerUse}",
    "{installWhenMissing:!0,name:e.$n,isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse}",
    "main windows computer-use plugin availability",
    changes,
  );

  text = replaceRegexOnce(
    text,
    /let p=t\.inAppBrowserUse\|\|t\.externalBrowserUse,m=t\.computerUse&&t\.computerUseNodeRepl,h=(\w+)\(t\);if\(!p&&!m\)return null;/,
    "let p=!0,m=t.computerUse&&t.computerUseNodeRepl,h=$1(t);",
    "main browser-use node repl always enabled",
    changes,
    /let p=!0,m=t\.computerUse&&t\.computerUseNodeRepl,h=\w+\(t\);/,
  );

  text = replaceRegexOnce(
    text,
    /let m=n\.inAppBrowserUse\|\|n\.externalBrowserUse,h=n\.computerUse&&n\.computerUseNodeRepl,g=(\w+)\(n\);if\(!m&&!h\)return null;/,
    "let m=!0,h=n.computerUse&&n.computerUseNodeRepl,g=$1(n);",
    "main browser-use node repl always enabled",
    changes,
    /let m=!0,h=n\.computerUse&&n\.computerUseNodeRepl,g=\w+\(n\);/,
  );

  text = replaceRegexOnce(
    text,
    /function (\w+)\(e\)\{let t=\[\];return e\.externalBrowserUse&&t\.push\(`chrome`\),e\.inAppBrowserUse&&t\.push\(`iab`\),t\}/,
    "function $1(e){let t=[`chrome`];return e.inAppBrowserUse&&t.push(`iab`),t}",
    "main browser-use chrome backend request metadata",
    changes,
    /function \w+\(e\)\{let t=\[`chrome`\];return e\.inAppBrowserUse&&t\.push\(`iab`\),t\}/,
  );

  writeFileSync(file, text);
  return changes;
}

function findAsset(root, prefix) {
  const assetRoot = join(root, "webview", "assets");
  const matches = readdirSync(assetRoot).filter((name) => name.startsWith(prefix) && name.endsWith(".js"));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${prefix}*.js asset in ${assetRoot}, found ${matches.length}`);
  }
  return join(assetRoot, matches[0]);
}

function findRendererAssetContaining(root, markers, label) {
  return findJsAssetContaining(root, ["webview", "assets"], markers, label);
}

function patchRendererDesktopFeatures(root) {
  const file = findRendererAssetContaining(
    root,
    [
      "electron-desktop-features-changed",
      "set-default-feature-overrides",
      "statsig_default_enable_features",
    ],
    "renderer app-main bundle",
  );
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "externalBrowserUse:d.available,externalBrowserUseAllowed:d.allowed",
    "externalBrowserUse:!0,externalBrowserUseAllowed:!0",
    "renderer desktop feature dispatch external browser",
    changes,
  );

  text = replaceOnce(
    text,
    "externalBrowserUse:p.available,externalBrowserUseAllowed:p.allowed",
    "externalBrowserUse:!0,externalBrowserUseAllowed:!0",
    "renderer desktop feature dispatch external browser",
    changes,
  );

  text = replaceOnce(
    text,
    "externalBrowserUse:m.available,externalBrowserUseAllowed:m.allowed",
    "externalBrowserUse:!0,externalBrowserUseAllowed:!0",
    "renderer desktop feature dispatch external browser",
    changes,
  );

  text = replaceOneOf(
    text,
    [
      "inAppBrowserUse:c.available,inAppBrowserUseAllowed:c.allowed,browserPane:r,externalBrowserUse:d.available,externalBrowserUseAllowed:d.allowed,computerUse:m.available,computerUseNodeRepl:m.available&&h",
      "inAppBrowserUse:c.available,inAppBrowserUseAllowed:c.allowed,browserPane:r,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:m.available,computerUseNodeRepl:m.available&&h",
    ],
    "inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,browserPane:r,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:!0,computerUseNodeRepl:!0",
    "renderer desktop feature dispatch browser and computer-use",
    changes,
  );

  text = replaceOneOf(
    text,
    [
      "inAppBrowserUse:d.available,inAppBrowserUseAllowed:d.allowed,browserPane:o,externalBrowserUse:p.available,externalBrowserUseAllowed:p.allowed,computerUse:g.available,computerUseNodeRepl:g.available",
      "inAppBrowserUse:d.available,inAppBrowserUseAllowed:d.allowed,browserPane:o,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:g.available,computerUseNodeRepl:g.available",
    ],
    "inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,browserPane:o,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:!0,computerUseNodeRepl:!0",
    "renderer desktop feature dispatch browser and computer-use",
    changes,
  );

  text = replaceOneOf(
    text,
    [
      "inAppBrowserUse:f.available,inAppBrowserUseAllowed:f.allowed,browserPane:s,externalBrowserUse:m.available,externalBrowserUseAllowed:m.allowed,computerUse:_.available,computerUseNodeRepl:_.available",
      "inAppBrowserUse:f.available,inAppBrowserUseAllowed:f.allowed,browserPane:s,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:_.available,computerUseNodeRepl:_.available",
      "inAppBrowserUse:d.available,inAppBrowserUseAllowed:d.allowed,browserPane:s,externalBrowserUse:p.available,externalBrowserUseAllowed:p.allowed,computerUse:h.available,computerUseNodeRepl:h.available",
      "inAppBrowserUse:d.available,inAppBrowserUseAllowed:d.allowed,browserPane:s,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:h.available,computerUseNodeRepl:h.available",
    ],
    "inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,browserPane:s,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:!0,computerUseNodeRepl:!0",
    "renderer desktop feature dispatch browser and computer-use",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function patchRendererBrowserAvailability(root) {
  const file = findRendererAssetContaining(
    root,
    [
      "browser_use_external",
      "computer_use",
      "browser_use",
      "in_app_browser",
      "RUN_CODEX_IN_WSL",
      "runCodexInWsl",
    ],
    "renderer browser availability bundle",
  );
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "let _=a&&i&&l&&(o||m),v=_&&!o&&p.enabled&&!p.isLoading,y=_&&p.isLoading,b=_&&(o||p.isLoading),x;return",
    "let _=!0,v=!0,y=!1,b=!1,x;return",
    "renderer computer-use statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let _=a&&i&&u&&(o||g),v=_&&!o&&h.enabled&&!h.isLoading,y=_&&h.isLoading,b=_&&(o||h.isLoading),x;return",
    "let _=!0,v=!0,y=!1,b=!1,x;return",
    "renderer computer-use statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let _=p(h),v;n[2]!==_.enabled||n[3]!==_.isLoading||n[4]!==a||n[5]!==d||n[6]!==c||n[7]!==o||n[8]!==s?(v=g({enabled:a,isComputerUseFeatureEnabled:_.enabled,isComputerUseFeatureLoading:_.isLoading,isComputerUseGateEnabled:d,isHostCompatiblePlatform:m(s),isHostLocal:c,isPlatformLoading:o,windowType:`electron`}),n[2]=_.enabled,n[3]=_.isLoading,n[4]=a,n[5]=d,n[6]=c,n[7]=o,n[8]=s,n[9]=v):v=n[9];let y=v,b=y===`available`,x=y===`loading`&&_.isLoading,S=y===`loading`,C;return",
    "let _=p(h),v=`available`,y=v,b=!0,x=!1,S=!1,C;return",
    "renderer computer-use statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let _=g,v=_===`available`,y=_===`loading`&&h.isLoading,b=_===`loading`,x;return",
    "let _=`available`,v=!0,y=!1,b=!1,x;return",
    "renderer computer-use statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "function p({enabled:e,isComputerUseFeatureEnabled:t,isComputerUseFeatureLoading:n,isComputerUseGateEnabled:r,isHostCompatiblePlatform:i,isPlatformLoading:a,windowType:o}){return e?o===`electron`?r?a?`loading`:i?n?`loading`:t?`available`:`config-requirement-disabled`:`unsupported-platform`:`statsig-disabled`:`window-type-disabled`:`disabled`}",
    "function p({enabled:e,isComputerUseFeatureEnabled:t,isComputerUseFeatureLoading:n,isComputerUseGateEnabled:r,isHostCompatiblePlatform:i,isPlatformLoading:a,windowType:o}){return`available`}",
    "renderer computer-use statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let o=h(a),c=i&&o.enabled&&!o.isLoading,l=r&&c,u;return",
    "let o=h(a),c=!0,l=!0,u;return",
    "renderer external browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let l=f(s),u=a===`chrome-extension`||o&&l.enabled&&!l.isLoading,p=r&&u,m=a===`chrome-extension`?!1:l.isLoading,h;return",
    "let l=f(s),u=!0,p=!0,m=!1,h;return",
    "renderer external browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let c=p(s),u=a===`chrome-extension`||o&&c.enabled&&!c.isLoading,d=r&&u,m=a===`chrome-extension`?!1:c.isLoading,h;return",
    "let c=p(s),u=!0,d=!0,m=!1,h;return",
    "renderer external browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let a=h(i),o=r&&a.enabled&&!a.isLoading,c;return t[2]!==o||t[3]!==a.isLoading?(c={allowed:o,available:o,isLoading:a.isLoading},t[2]=o,t[3]=a.isLoading,t[4]=c):c=t[4],c",
    "let a=h(i),o=!0,c;return t[2]!==o?(c={allowed:o,available:o,isLoading:!1},t[2]=o,t[3]=!1,t[4]=c):c=t[4],c",
    "renderer external browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let c=u(s),d=i===`chrome-extension`||o&&c.enabled&&!c.isLoading,f=i===`chrome-extension`?!1:c.isLoading,p;return",
    "let c=u(s),d=!0,f=!1,p;return",
    "renderer external browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let u=f(l),p=o(e.runCodexInWsl),m=u.enabled&&!u.isLoading,h=u.isLoading,g=p===!0,v;",
    "let u=f(l),p=o(e.runCodexInWsl),m=!0,h=!1,g=!1,v;",
    "renderer in-app browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{hostId:o}=t,s=n(c),d=a(`410262010`),f;",
    "{hostId:o}=t,s=!0,d=!0,f;",
    "renderer in-app browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let p=u(f),m=r(e.runCodexInWsl),h=p.enabled&&!p.isLoading,_=p.isLoading,v=m===!0,y;",
    "let p=u(f),m=r(e.runCodexInWsl),h=!0,_=!1,v=!1,y;",
    "renderer in-app browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "function g({isBrowserAgentGateEnabled:e,isBrowserSidebarEnabled:t,isBrowserUseEnabled:n,isLoading:r,runCodexInWsl:i,windowType:a}){return a===`chrome-extension`?`window-type-disabled`:r?`loading`:t?e?n?i?`wsl-disabled`:`available`:`config-requirement-disabled`:`statsig-disabled`:`browser-pane-disabled`}",
    "function g({isBrowserAgentGateEnabled:e,isBrowserSidebarEnabled:t,isBrowserUseEnabled:n,isLoading:r,runCodexInWsl:i,windowType:a}){return`available`}",
    "renderer in-app browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let u=p(c),d=s(e.runCodexInWsl),m=u.enabled&&!u.isLoading,h=u.isLoading,g=d===!0,_;",
    "let u=p(c),d=s(e.runCodexInWsl),m=!0,h=!1,g=!1,_;",
    "renderer in-app browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let f=h(u),p=c(e.RUN_CODEX_IN_WSL),m=f.enabled&&!f.isLoading,g=o&&l&&m&&!p.isLoading&&p.data!==!0,_=a&&g,v=f.isLoading||p.isLoading,y;return",
    "let f=h(u),p=c(e.RUN_CODEX_IN_WSL),m=!0,g=!0,_=!0,v=!1,y;return",
    "renderer in-app browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let u=h(l),f=c(e.RUN_CODEX_IN_WSL),p=u.enabled&&!u.isLoading,m=a&&o&&p&&!f.isLoading&&f.data!==!0,g=u.isLoading||f.isLoading,_=f.data===!0,v;",
    "let u=h(l),f=c(e.RUN_CODEX_IN_WSL),p=!0,m=!0,g=!1,_=!1,v;",
    "renderer in-app browser statsig and feature availability",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function patchRendererPluginFilters(root) {
  const file = findRendererAssetContaining(
    root,
    [
      "isComputerUseAvailable",
      "isExternalBrowserUseAvailable",
      "isInAppBrowserUseAvailable",
      "availablePlugins",
      "featuredPluginIds",
    ],
    "renderer plugin list bundle",
  );
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "function H(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!(!r&&U(e)||!n&&W(e)||!t&&G(e))}",
    "function H(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!0}",
    "renderer plugin list browser and computer-use availability filter",
    changes,
  );

  text = replaceOnce(
    text,
    "function V(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!(!r&&H(e)||!n&&U(e)||!t&&W(e))}",
    "function V(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!0}",
    "renderer plugin list browser and computer-use availability filter",
    changes,
  );

  text = replaceOnce(
    text,
    "function U(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!(!r&&W(e)||!n&&G(e)||!t&&K(e))}",
    "function U(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!0}",
    "renderer plugin list browser and computer-use availability filter",
    changes,
  );

  text = replaceOnce(
    text,
    "function W(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!(!r&&G(e)||!n&&K(e)||!t&&q(e))}",
    "function W(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!0}",
    "renderer plugin list browser and computer-use availability filter",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function patchRendererDefaultFeatureOverrides(root) {
  const file = findRendererAssetContaining(
    root,
    [
      "set-default-feature-overrides",
      "statsig_default_enable_features",
      "set-experimental-feature-enablement-for-host",
    ],
    "renderer app-main feature overrides bundle",
  );
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "function EP(e){let t={};for(let n of wP){let r=e[n];r!=null&&(t[n]=r)}return t}",
    forcedFeatureOverrideFunction("EP", "wP"),
    "renderer default experimental feature overrides force supported flags",
    changes,
  );

  text = replaceOnce(
    text,
    "function qF(e){let t={};for(let n of GF){let r=e[n];r!=null&&(t[n]=r)}return t}",
    forcedFeatureOverrideFunction("qF", "GF"),
    "renderer default experimental feature overrides force supported flags",
    changes,
  );

  text = replaceOnce(
    text,
    "function mN(e){let t={};for(let n of fN){let r=e[n];r!=null&&(t[n]=r)}return t}",
    forcedFeatureOverrideFunction("mN", "fN"),
    "renderer default experimental feature overrides force supported flags",
    changes,
  );

  text = replaceOnce(
    text,
    "function uI(e,t){let n={};for(let t of oI){let r=e[t];r!=null&&(n[t]=r)}return n[cI]=t,n}",
    `function uI(e,t){let n={${FORCED_EXPERIMENTAL_FEATURES}};for(let r of oI){let t=e[r];t!=null&&(n[r]=n[r]===!0?!0:t)}return n[cI]=t,n}`,
    "renderer default experimental feature overrides force supported flags",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function patchRendererMemoriesAvailability(root) {
  const results = [];

  {
    const file = findRendererAssetContaining(
      root,
      [
        "function m(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}",
        "function p(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}",
        "function f(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}",
        "function m(e,t){return!0}",
        "function p(e,t){return!0}",
        "function f(e,t){return!0}",
      ],
      "renderer experimental features queries bundle",
    );
    const changes = { file, changed: [], missing: [] };
    let text = readFileSync(file, "utf8");

    text = replaceOnce(
      text,
      "function m(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}",
      "function m(e,t){return!0}",
      "renderer memories feature availability",
      changes,
    );

    text = replaceOnce(
      text,
      "function p(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}",
      "function p(e,t){return!0}",
      "renderer memories feature availability",
      changes,
    );

    text = replaceOnce(
      text,
      "function f(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}",
      "function f(e,t){return!0}",
      "renderer memories feature availability",
      changes,
    );

    writeFileSync(file, text);
    results.push(changes);
  }

  {
    const file = findRendererAssetContaining(
      root,
      [
        "let ae=ie?.enabled===!0,oe=c?.config,se;",
        "let ae=!0,oe=c?.config,se;",
        "let se=oe?.enabled===!0,ce=u?.config,le;",
        "let se=!0,ce=u?.config,le;",
        "let oe=H?.enabled===!0,se=l?.config,ce;",
        "let oe=!0,se=l?.config,ce;",
        "let de=ue?.enabled===!0,fe=p?.config,pe;",
        "let de=!0,fe=p?.config,pe;",
      ],
      "renderer personalization settings bundle",
    );
    const changes = { file, changed: [], missing: [] };
    let text = readFileSync(file, "utf8");

    text = replaceOnce(
      text,
      "let ae=ie?.enabled===!0,oe=c?.config,se;",
      "let ae=!0,oe=c?.config,se;",
      "renderer personalization memories enabled state",
      changes,
    );

    text = replaceOnce(
      text,
      "let se=oe?.enabled===!0,ce=u?.config,le;",
      "let se=!0,ce=u?.config,le;",
      "renderer personalization memories enabled state",
      changes,
    );

    text = replaceOnce(
      text,
      "let oe=H?.enabled===!0,se=l?.config,ce;",
      "let oe=!0,se=l?.config,ce;",
      "renderer personalization memories enabled state",
      changes,
    );

    text = replaceOnce(
      text,
      "let de=ue?.enabled===!0,fe=p?.config,pe;",
      "let de=!0,fe=p?.config,pe;",
      "renderer personalization memories enabled state",
      changes,
    );

    writeFileSync(file, text);
    results.push(changes);
  }

  return results;
}

function patchRenderer(root) {
  return [
    patchRendererDesktopFeatures(root),
    patchRendererBrowserAvailability(root),
    patchRendererPluginFilters(root),
    patchRendererDefaultFeatureOverrides(root),
    ...patchRendererMemoriesAvailability(root),
  ];
}

function patchBrowserClient(file, { write }) {
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  if (
    text.includes("privileged native pipe bridge is not available; browser-client is not trusted") &&
    text.includes("globalThis.nodeRepl?.nativePipe") &&
    !text.includes("function HF(){return globalThis.nodeRepl?.requestMeta")
  ) {
    changes.changed.push("browser-client native pipe trust handled by app hash");
    return changes;
  }

  text = replaceOnce(
    text,
    "function HF(){return globalThis.nodeRepl?.requestMeta?.[qF]===$F}",
    "function HF(){return!0}",
    "browser-client disable remote url policy gate",
    changes,
  );

  text = replaceOneOf(
    text,
    [
      "function WS(t){if(t===`cdp`)return;let e=YS();if(!(e==null||e.includes(t)))throw new Error(BO(t))}",
      'function WS(t){if(t==="cdp")return;let e=YS();if(!(e==null||e.includes(t)))throw new Error(BO(t))}',
    ],
    "function WS(t){return}",
    "browser-client disable backend command whitelist",
    changes,
  );

  text = replaceOneOf(
    text,
    [
      "function KS(t){if(t===`cdp`)return!0;let e=YS();return e==null||e.includes(t)}",
      'function KS(t){if(t==="cdp")return!0;let e=YS();return e==null||e.includes(t)}',
    ],
    "function KS(t){return!0}",
    "browser-client disable backend discovery whitelist",
    changes,
  );

  if (write) writeFileSync(file, text);
  return changes;
}

function patchPluginResources(appRoot, { write, patchBrowserClientFiles }) {
  if (!patchBrowserClientFiles) return [];
  const pluginRoot = join(appRoot, "app", "resources", "plugins", "openai-bundled", "plugins");
  const files = [
    join(pluginRoot, "chrome", "scripts", "browser-client.mjs"),
    join(pluginRoot, "browser-use", "scripts", "browser-client.mjs"),
  ];
  return files.filter((file) => existsSync(file)).map((file) => patchBrowserClient(file, { write }));
}

function syncBundledPluginCache(appRoot, cacheRoot, { write }) {
  const bundledPluginRoot = join(appRoot, "app", "resources", "plugins", "openai-bundled", "plugins");
  const results = [];

  for (const pluginName of ["chrome", "browser-use"]) {
    const source = join(bundledPluginRoot, pluginName);
    const manifest = join(source, ".codex-plugin", "plugin.json");
    const changes = [];
    const missing = [];

    if (!existsSync(manifest)) {
      missing.push(`bundled ${pluginName} plugin manifest`);
      results.push({ file: source, changed: changes, missing });
      continue;
    }

    const { version } = JSON.parse(readFileSync(manifest, "utf8"));
    if (typeof version !== "string" || version.length === 0) {
      missing.push(`bundled ${pluginName} plugin version`);
      results.push({ file: manifest, changed: changes, missing });
      continue;
    }

    const pluginCacheRoot = join(cacheRoot, pluginName);
    const target = join(pluginCacheRoot, version);
    const latest = join(pluginCacheRoot, "latest");
    changes.push(`sync bundled ${pluginName} plugin cache ${version}`);

    if (write) {
      mkdirSync(pluginCacheRoot, { recursive: true });
      cpSync(source, target, { recursive: true, force: true });
      if (!existsSync(latest)) symlinkSync(target, latest, "junction");
    }

    results.push({ file: target, changed: changes, missing });
  }

  return results;
}

function patchUserPluginCache(appRoot, cacheRoot, { write, patchBrowserClientFiles }) {
  const syncResults = syncBundledPluginCache(appRoot, cacheRoot, { write });
  if (!patchBrowserClientFiles) return syncResults;

  const files = [];
  for (const pluginName of ["chrome", "browser-use"]) {
    const pluginRoot = join(cacheRoot, pluginName);
    if (!existsSync(pluginRoot)) continue;
    for (const entry of readdirSync(pluginRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const file = join(pluginRoot, entry.name, "scripts", "browser-client.mjs");
      if (existsSync(file)) files.push(file);
    }
  }
  return [...syncResults, ...files.map((file) => patchBrowserClient(file, { write }))];
}

function filterUnhandledMissing(result) {
  const handledLabels = new Set(result.changed.map((label) => label.replace(/ \(already patched\)$/, "")));
  return result.missing.filter((label) => !handledLabels.has(label));
}

function normalizeVariantMisses(results) {
  return results.map((result) => ({ ...result, missing: filterUnhandledMissing(result) }));
}

function assertAllMarkersFound(results) {
  const missing = results.flatMap((result) => filterUnhandledMissing(result).map((label) => `${label} in ${result.file}`));
  if (missing.length > 0) {
    throw new Error(`Patch markers missing:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  }
}

function patchTree(root) {
  const results = [patchMain(root), ...patchRenderer(root)];
  assertAllMarkersFound(results);
  return normalizeVariantMisses(results);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const appRoot = resolve(opts.app);
  const asarPath = join(appRoot, "app", "resources", "app.asar");

  if (opts.cacheOnly) {
    const results = patchUserPluginCache(appRoot, opts.pluginCache, {
      write: opts.apply,
      patchBrowserClientFiles: opts.patchBrowserClient,
    });
    assertAllMarkersFound(results);
    console.log(
      JSON.stringify(
        { mode: opts.apply ? "apply" : "dry-run", cacheOnly: true, pluginCache: opts.pluginCache, results },
        null,
        2,
      ),
    );
    if (!opts.apply) console.log("Dry run complete. User plugin cache was not changed.");
    else console.log(`Applied user plugin cache patch: ${opts.pluginCache}`);
    return;
  }

  if (opts.restore != null) {
    const backup = resolve(opts.restore);
    if (!existsSync(backup)) throw new Error(`Missing backup: ${backup}`);
    cpSync(backup, asarPath);
    console.log(`Restored ${asarPath} from ${backup}`);
    return;
  }

  const work = opts.work == null ? join("C:\\tmp", `codex-chrome-patch-${Date.now()}`) : resolve(opts.work);
  for (const required of [asarPath]) {
    if (!existsSync(required)) throw new Error(`Missing required path: ${required}`);
  }

  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
  mkdirSync(dirname(work), { recursive: true });
  extractAll(asarPath, work);

  const pluginResourceResults = patchPluginResources(appRoot, {
    write: opts.apply,
    patchBrowserClientFiles: opts.patchBrowserClient,
  });
  const cacheResults = opts.patchUserPluginCache
    ? patchUserPluginCache(appRoot, opts.pluginCache, {
        write: opts.apply,
        patchBrowserClientFiles: opts.patchBrowserClient,
      })
    : [];
  const results = [
    ...patchTree(work),
    ...pluginResourceResults,
    ...cacheResults,
  ];
  assertAllMarkersFound(results);
  console.log(JSON.stringify({ mode: opts.apply ? "apply" : "dry-run", appRoot, work, results }, null, 2));

  if (!opts.apply) {
    console.log("Dry run complete. Extracted patched tree left in place; app.asar was not changed.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${asarPath}.bak-${stamp}`;
  const packed = join("C:\\tmp", `codex-chrome-patched-${stamp}.asar`);
  const previousAsarHash = asarHeaderHash(asarPath);
  await createPackage(work, packed);
  cpSync(asarPath, backup);
  cpSync(packed, asarPath);

  const exePatch = opts.patchExeIntegrity ? patchExeAsarIntegrity(appRoot, asarHeaderHash(asarPath), [previousAsarHash]) : null;
  console.log(`Applied patch. Backup: ${backup}`);
  console.log(`Temporary patched ASAR: ${packed}`);
  if (exePatch != null) {
    if (exePatch.skipped) {
      console.log(`Skipped Electron ASAR integrity patch in ${exePatch.exePath}: ${exePatch.reason}.`);
    } else if (exePatch.alreadyPatched) {
      console.log(`Electron ASAR integrity already patched in ${exePatch.exePath}: ${exePatch.newHash}`);
    } else {
      console.log(`Patched Electron ASAR integrity in ${exePatch.exePath}: ${exePatch.oldHash} -> ${exePatch.newHash}`);
    }
  } else {
    console.log("Electron EXE ASAR integrity was not patched. Use --patch-exe-integrity for loose-copy experiments.");
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

