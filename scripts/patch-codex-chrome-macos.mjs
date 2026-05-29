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
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

const { createPackage, extractAll } = asar;
const FORCED_EXPERIMENTAL_FEATURES =
  "apps:!0,memories:!0,plugins:!0,browser_use:!0,browser_use_external:!0,computer_use:!0,in_app_browser:!0,remote_control:!0,tool_search:!0,tool_suggest:!0,tool_call_mcp_elicitation:!0";

function forcedFeatureOverrideFunction(functionName, featureListName) {
  return `function ${functionName}(e){let t={${FORCED_EXPERIMENTAL_FEATURES}};for(let n of ${featureListName}){let r=e[n];r!=null&&(t[n]=t[n]===!0?!0:r)}return t}`;
}

function appResources(appRoot) {
  return join(appRoot, "Contents", "Resources");
}

function appAsar(appRoot) {
  return join(appResources(appRoot), "app.asar");
}

function bundledPluginRoot(appRoot) {
  return join(appResources(appRoot), "plugins", "openai-bundled", "plugins");
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0;
}

function findLatestCodexApp() {
  const candidates = [
    "/Applications/Codex.app",
    join(homedir(), "Applications", "Codex.app"),
  ];

  if (process.platform === "darwin" && commandExists("mdfind")) {
    const result = spawnSync("mdfind", ["kMDItemFSName == 'Codex.app'"], { encoding: "utf8" });
    if (result.status === 0) {
      for (const line of result.stdout.split(/\r?\n/)) {
        if (line.trim().length > 0) candidates.push(line.trim());
      }
    }
  }

  const uniqueCandidates = [...new Set(candidates)]
    .filter((candidate) => existsSync(appAsar(candidate)))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return uniqueCandidates[0] ?? null;
}

function localAsarTool() {
  const binDir = join(process.cwd(), "node_modules", "@electron", "asar", "bin");
  const candidates = [join(binDir, "asar.mjs"), join(binDir, "asar.js")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function usage() {
  console.log(`Usage:
  node scripts/patch-codex-chrome-macos.mjs [--app PATH] [--asar PATH] [--node PATH] [--work PATH] [--dry-run] [--apply] [--ad-hoc-sign] [--patch-user-plugin-cache] [--patch-browser-client] [--plugin-cache PATH] [--cache-only]
  node scripts/patch-codex-chrome-macos.mjs --restore BACKUP_PATH [--app PATH]

Defaults:
  --app   CODEX_APP_ROOT env var, or Codex.app under /Applications, ~/Applications, or Spotlight
  --asar  accepted for compatibility; ASAR work uses the @electron/asar library
  --node  accepted for compatibility; no separate Node executable is spawned
  --plugin-cache  CODEX_PLUGIN_CACHE_ROOT env var, or ~/.codex/plugins/cache/openai-bundled
  --ad-hoc-sign  run codesign --force --deep --sign - after applying the ASAR patch
  --patch-browser-client  advanced: also patch browser-client.mjs policy gates. This changes trusted plugin files.

Use this on a copied Codex.app bundle, not the official /Applications/Codex.app install.`);
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
    adHocSign: false,
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
    else if (arg === "--ad-hoc-sign") opts.adHocSign = true;
    else if (arg === "--patch-exe-integrity") {
      throw new Error("--patch-exe-integrity is Windows-only. Use --ad-hoc-sign for a copied macOS app bundle.");
    } else if (arg === "--patch-user-plugin-cache") opts.patchUserPluginCache = true;
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
  if (opts.app == null) throw new Error("Could not auto-detect Codex.app. Pass --app PATH.");
  opts.app = resolve(opts.app);
  opts.pluginCache = resolve(opts.pluginCache);

  if (opts.dryRun && opts.apply) throw new Error("Use either --dry-run or --apply, not both.");
  if (opts.cacheOnly && !opts.patchUserPluginCache) {
    throw new Error("--cache-only requires --patch-user-plugin-cache.");
  }
  if (opts.adHocSign && !opts.apply) {
    throw new Error("--ad-hoc-sign only applies with --apply.");
  }
  if (!opts.apply) opts.dryRun = true;
  return opts;
}

function asarHeaderHash(asarPath) {
  const buffer = readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(12);
  return createHash("sha256").update(buffer.subarray(16, 16 + headerSize)).digest("hex");
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
    "{autoInstallOptOutKey:e.Nn(e.Dn),forceReload:!0,installWhenMissing:!0,name:e.Dn,isAvailable:({features:e})=>e.inAppBrowserUseAllowed,migrate:$n}",
    "{autoInstallOptOutKey:e.Nn(e.Dn),installWhenMissing:!0,name:e.Dn,isAvailable:()=>!0,migrate:$n}",
    "main browser-use bundled plugin install policy and availability",
    changes,
  );

  text = replaceOnce(
    text,
    "name:e.On,isAvailable:({buildFlavor:e,features:t})=>Jn(e)&&t.externalBrowserUseAllowed",
    "name:e.On,isAvailable:()=>!0",
    "main external browser helper plugin availability",
    changes,
  );

  text = replaceOnce(
    text,
    "{installWhenMissing:!0,name:e.kn,isAvailable:({buildFlavor:e,features:n,platform:r})=>t.T.isInternal(e)&&r===`win32`&&n.computerUse}",
    "{installWhenMissing:!0,name:e.kn,isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse}",
    "main macOS computer-use plugin availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let p=t.inAppBrowserUse||t.externalBrowserUse,m=t.computerUse&&t.computerUseNodeRepl,h=Jt(t);if(!p&&!m)return null;",
    "let p=!0,m=t.computerUse&&t.computerUseNodeRepl,h=Jt(t);",
    "main browser-use node repl always enabled",
    changes,
  );

  text = replaceOnce(
    text,
    "function Jt(e){let t=[];return e.externalBrowserUse&&t.push(`chrome`),e.inAppBrowserUse&&t.push(`iab`),t}",
    "function Jt(e){let t=[`chrome`];return e.inAppBrowserUse&&t.push(`iab`),t}",
    "main browser-use chrome backend request metadata",
    changes,
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

function patchRendererDesktopFeatures(root) {
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

  writeFileSync(file, text);
  return changes;
}

function patchRendererBrowserAvailability(root) {
  const file = findAsset(root, "use-in-app-browser-use-availability-");
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
    "let o=h(a),c=i&&o.enabled&&!o.isLoading,l=r&&c,u;return",
    "let o=h(a),c=!0,l=!0,u;return",
    "renderer external browser statsig and feature availability",
    changes,
  );

  text = replaceOnce(
    text,
    "let f=h(u),p=c(e.RUN_CODEX_IN_WSL),m=f.enabled&&!f.isLoading,g=o&&l&&m&&!p.isLoading&&p.data!==!0,_=a&&g,v=f.isLoading||p.isLoading,y;return",
    "let f=h(u),p=c(e.RUN_CODEX_IN_WSL),m=!0,g=!0,_=!0,v=!1,y;return",
    "renderer in-app browser statsig and feature availability",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function patchRendererPluginFilters(root) {
  const file = findAsset(root, "use-plugins-");
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "function H(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!(!r&&U(e)||!n&&W(e)||!t&&G(e))}",
    "function H(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!0}",
    "renderer plugin list browser and computer-use availability filter",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function patchRendererDefaultFeatureOverrides(root) {
  const file = join(root, "webview", "assets", "app-main-BssxuQ1L.js");
  const changes = { file, changed: [], missing: [] };
  let text = readFileSync(file, "utf8");

  text = replaceOnce(
    text,
    "function EP(e){let t={};for(let n of wP){let r=e[n];r!=null&&(t[n]=r)}return t}",
    forcedFeatureOverrideFunction("EP", "wP"),
    "renderer default experimental feature overrides force supported flags",
    changes,
  );

  writeFileSync(file, text);
  return changes;
}

function patchRendererMemoriesAvailability(root) {
  const results = [];

  {
    const file = findAsset(root, "experimental-features-queries-");
    const changes = { file, changed: [], missing: [] };
    let text = readFileSync(file, "utf8");

    text = replaceOnce(
      text,
      "function m(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}",
      "function m(e,t){return!0}",
      "renderer memories feature availability",
      changes,
    );

    writeFileSync(file, text);
    results.push(changes);
  }

  {
    const file = findAsset(root, "personalization-settings-");
    const changes = { file, changed: [], missing: [] };
    let text = readFileSync(file, "utf8");

    text = replaceOnce(
      text,
      "let ae=ie?.enabled===!0,oe=c?.config,se;",
      "let ae=!0,oe=c?.config,se;",
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
  const pluginRoot = bundledPluginRoot(appRoot);
  const files = [
    join(pluginRoot, "chrome", "scripts", "browser-client.mjs"),
    join(pluginRoot, "browser-use", "scripts", "browser-client.mjs"),
  ];
  return files.filter((file) => existsSync(file)).map((file) => patchBrowserClient(file, { write }));
}

function syncBundledPluginCache(appRoot, cacheRoot, { write }) {
  const pluginRoot = bundledPluginRoot(appRoot);
  const results = [];

  for (const pluginName of ["chrome", "browser-use"]) {
    const source = join(pluginRoot, pluginName);
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
      if (!existsSync(latest)) {
        symlinkSync(target, latest, process.platform === "win32" ? "junction" : "dir");
      }
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

function assertAllMarkersFound(results) {
  const missing = results.flatMap((result) => result.missing.map((label) => `${label} in ${result.file}`));
  if (missing.length > 0) {
    throw new Error(`Patch markers missing:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  }
}

function patchTree(root) {
  const results = [patchMain(root), ...patchRenderer(root)];
  assertAllMarkersFound(results);
  return results;
}

function signAppAdHoc(appRoot) {
  if (process.platform !== "darwin") {
    throw new Error("--ad-hoc-sign requires macOS.");
  }
  if (!commandExists("codesign")) {
    throw new Error("codesign was not found.");
  }
  const result = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appRoot], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`codesign failed:\n${result.stdout}\n${result.stderr}`.trim());
  }
  return { appRoot, signed: true };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const appRoot = resolve(opts.app);
  const asarPath = appAsar(appRoot);

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
    if (!existsSync(dirname(asarPath))) throw new Error(`Missing required path: ${dirname(asarPath)}`);
    cpSync(backup, asarPath);
    console.log(`Restored ${asarPath} from ${backup}`);
    return;
  }

  const work = opts.work == null ? join(tmpdir(), `codex-chrome-patch-macos-${Date.now()}`) : resolve(opts.work);
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
  const packed = join(tmpdir(), `codex-chrome-patched-macos-${stamp}.asar`);
  const previousAsarHash = asarHeaderHash(asarPath);
  await createPackage(work, packed);
  cpSync(asarPath, backup);
  cpSync(packed, asarPath);
  const nextAsarHash = asarHeaderHash(asarPath);
  const signing = opts.adHocSign ? signAppAdHoc(appRoot) : null;

  console.log(`Applied patch. Backup: ${backup}`);
  console.log(`Temporary patched ASAR: ${packed}`);
  console.log(`ASAR header hash: ${previousAsarHash} -> ${nextAsarHash}`);
  if (signing != null) {
    console.log(`Ad-hoc signed copied app bundle: ${signing.appRoot}`);
  } else {
    console.log("Copied app bundle was not re-signed. Use --ad-hoc-sign on macOS if Gatekeeper rejects the modified copy.");
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
