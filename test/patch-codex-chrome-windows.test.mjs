import assert from "node:assert/strict";
import asar from "@electron/asar";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, "scripts", "patch-codex-chrome-windows.mjs");
const { createPackage } = asar;
const mainBundleFixtureName = "main-sqI8jfJr.js";
const appMainFixtureName = "app-main-DKFfP-X-.js";

const mainPatchMarkers = [
  "CODEX_ELECTRON_DESKTOP_FEATURE_OVERRIDES",
  "bundled_plugins_reconcile_started",
  "browserUseConfig:{computerUse:",
  "externalBrowserUse:!1,externalBrowserUseAllowed:!1",
  "inAppBrowserUse:!1,inAppBrowserUseAllowed:!1,externalBrowserUse:!1,externalBrowserUseAllowed:!1,computerUse:!1,computerUseNodeRepl:!1",
  "{autoInstallOptOutKey:e.Jn(e.Hn),forceReload:!0,installWhenMissing:!0,name:e.Hn,isAvailable:({features:e})=>e.inAppBrowserUseAllowed,migrate:Ir}",
  "{forceReload:!0,name:Ae,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,env:t,features:n})=>Ar(e,t)&&n.externalBrowserUseAllowed}",
  "{forceReload:!0,name:e.Un,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,env:t,features:n})=>jr(e,t)&&n.externalBrowserUseAllowed}",
  "{forceReload:!0,name:ke,syncInstallStateWithChromeExtension:!0,isAvailable:({buildFlavor:e,features:t})=>t.externalBrowserUseAllowed&&Mr(e)}",
  "{forceReload:!0,installWhenMissing:!0,name:e.Wn,isAvailable:({buildFlavor:e,features:n,platform:r})=>t.O.isInternal(e)&&r===`win32`&&n.computerUse}",
  "let p=t.inAppBrowserUse||t.externalBrowserUse,m=t.computerUse&&t.computerUseNodeRepl,h=Ot(t);if(!p&&!m)return null;",
  "function Ot(e){let t=[];return e.externalBrowserUse&&t.push(`chrome`),e.inAppBrowserUse&&t.push(`iab`),t}",
].join(";");

const rendererDesktopFeatureDispatch =
  "inAppBrowserUse:f.available,inAppBrowserUseAllowed:f.allowed,browserPane:s,externalBrowserUse:m.available,externalBrowserUseAllowed:m.allowed,computerUse:_.available,computerUseNodeRepl:_.available";

const rendererBrowserAvailabilityMarkers = [
  "browser_use_external",
  "computer_use",
  "browser_use",
  "in_app_browser",
  "runCodexInWsl",
  "let _=a&&i&&u&&(o||g),v=_&&!o&&h.enabled&&!h.isLoading,y=_&&h.isLoading,b=_&&(o||h.isLoading),x;return",
  "let l=f(s),u=a===`chrome-extension`||o&&l.enabled&&!l.isLoading,p=r&&u,m=a===`chrome-extension`?!1:l.isLoading,h;return",
  "let u=f(l),p=o(e.runCodexInWsl),m=u.enabled&&!u.isLoading,h=u.isLoading,g=p===!0,v;",
].join(";");

const rendererPluginFilterMarkers =
  "availablePlugins;featuredPluginIds;function H(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!(!r&&U(e)||!n&&W(e)||!t&&G(e))}";
const rendererDefaultFeatureOverridesMarker =
  "electron-desktop-features-changed;set-default-feature-overrides;statsig_default_enable_features;function mN(e){let t={};for(let n of fN){let r=e[n];r!=null&&(t[n]=r)}return t}";
const rendererExperimentalFeaturesQueriesMarker =
  "list-experimental-features;batch-write-config-value;memories;function p(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}";
const rendererPersonalizationSettingsMarker =
  "settings.personalization.memory.title;settings.memory.enableMemoriesLabel;generateMemories;useMemories;let oe=H?.enabled===!0,se=l?.config,ce;";

function writeAsarPatchFixtures(sourceRoot) {
  writeFileSync(join(sourceRoot, ".vite", "build", mainBundleFixtureName), mainPatchMarkers);
  writeFileSync(
    join(sourceRoot, "webview", "assets", appMainFixtureName),
    `${rendererDesktopFeatureDispatch};${rendererDefaultFeatureOverridesMarker}`,
  );
  writeFileSync(
    join(sourceRoot, "webview", "assets", "use-is-plugins-enabled-aU0WrVOp.js"),
    rendererBrowserAvailabilityMarkers,
  );
  writeFileSync(join(sourceRoot, "webview", "assets", "use-plugins-CpT1TMqr.js"), rendererPluginFilterMarkers);
  writeFileSync(
    join(sourceRoot, "webview", "assets", "experimental-features-queries-CTmahqSy.js"),
    rendererExperimentalFeaturesQueriesMarker,
  );
  writeFileSync(
    join(sourceRoot, "webview", "assets", "personalization-settings-DIKmjat4.js"),
    rendererPersonalizationSettingsMarker,
  );
}

function asarHeaderHash(asarPath) {
  const buffer = readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(12);
  return createHash("sha256").update(buffer.subarray(16, 16 + headerSize)).digest("hex");
}

test("--app is honored before WindowsApps auto-detection", () => {
  const missingApp = join(root, ".does-not-exist");
  const result = spawnSync(
    process.execPath,
    [script, "--app", missingApp, "--dry-run"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required path:.*\.does-not-exist.*app\.asar/s);
  assert.doesNotMatch(result.stderr, /asar\.mjs/);
  assert.doesNotMatch(result.stderr, /WindowsApps|scandir/);
});

test("PowerShell entrypoints parse cleanly", () => {
  const powershell = process.platform === "win32" ? "powershell" : "pwsh";
  for (const file of [
    join(root, "scripts", "launch-patched-codex.ps1"),
    join(root, "scripts", "auto-patch-codex.ps1"),
    join(root, "scripts", "create-patched-codex-shortcut.ps1"),
    join(root, "scripts", "show-powertoys-copilot-remap.ps1"),
    join(root, "scripts", "build-copilot-launcher-exe.ps1"),
    join(root, "scripts", "configure-codex-memories.ps1"),
    join(root, "scripts", "configure-paseo-codex-provider.ps1"),
    join(root, "scripts", "resolve-patched-codex-cli.ps1"),
  ]) {
    const command = [
      "$errors = $null;",
      `[System.Management.Automation.PSParser]::Tokenize((Get-Content -LiteralPath '${file.replaceAll("'", "''")}' -Raw), [ref]$errors) | Out-Null;`,
      "if ($errors) { $errors | Format-List *; exit 1 };",
      "exit 0",
    ].join(" ");
    const result = spawnSync(powershell, ["-NoProfile", "-Command", command], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `${file}\n${result.stdout}\n${result.stderr}`);
  }
});

test("Windows launcher uses native remote connections and full Chrome repair defaults", () => {
  const autoPatch = readFileSync(join(root, "scripts", "auto-patch-codex.ps1"), "utf8");
  const launcher = readFileSync(join(root, "scripts", "launch-patched-codex.ps1"), "utf8");
  const shortcut = readFileSync(join(root, "scripts", "create-patched-codex-shortcut.ps1"), "utf8");

  assert.match(autoPatch, /\$patchRevision = 7/);
  assert.match(autoPatch, /\$shouldConfigurePaseo = \$Paseo -and -not \$NoPaseo/);
  assert.match(autoPatch, /Forcing a clean rebuild/);
  assert.match(shortcut, /"-PatchBrowserClient"/);
  assert.match(shortcut, /"-SyncPluginCache"/);
  assert.match(shortcut, /"-RepairChromePlugin"/);
  assert.match(launcher, /--patch-user-plugin-cache/);
  assert.match(launcher, /--patch-browser-client/);
  assert.match(launcher, /"extension-host\.exe"/);
  assert.match(launcher, /Wait-Process -Id \$process\.ProcessId -Timeout 10/);
  assert.doesNotMatch(autoPatch, /RemoteControlPort|NoRemoteControl|start-codex-remote-control/);
  assert.doesNotMatch(launcher, /RemoteControlPort|NoRemoteControl|start-codex-remote-control|codex-remote-control-enable/);
});

test("Windows launcher keeps Start shortcuts resilient across Codex updates", () => {
  const autoPatch = readFileSync(join(root, "scripts", "auto-patch-codex.ps1"), "utf8");
  const shortcut = readFileSync(join(root, "scripts", "create-patched-codex-shortcut.ps1"), "utf8");

  assert.match(autoPatch, /Remove-StalePatchedCodexShortcuts/);
  assert.match(autoPatch, /Set-DynamicPatchedCodexShortcut -Name "Codex"/);
  assert.match(autoPatch, /\[switch\]\$NoCodexAlias/);
  assert.match(shortcut, /\[string\]\$CodexAliasName = "Codex"/);
  assert.match(shortcut, /foreach \(\$name in \$shortcutNames\)/);
});

test("Chrome reinstall script repairs native host manifest after plugin install", () => {
  const reinstall = readFileSync(join(root, "scripts", "reinstall-chrome-plugin.mjs"), "utf8");

  assert.match(reinstall, /installNativeHostManifest/);
  assert.match(reinstall, /pathToFileURL/);
  assert.match(reinstall, /appServerRuntimePaths/);
});

test("local ASAR tool detection supports the installed package bin", (t) => {
  const appRoot = join(root, ".test-fixtures", "fake-codex");
  const resources = join(appRoot, "app", "resources");
  rmSync(appRoot, { recursive: true, force: true });
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(resources, "app.asar"), "not a real asar");
  writeFileSync(join(resources, "node.exe"), "not a real executable");
  t.after(() => rmSync(appRoot, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [script, "--app", appRoot, "--work", join(root, ".test-fixtures", "work"), "--dry-run"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Missing required path:.*@electron.*asar.*asar\.mjs/s);
});

test("dry-run extraction does not require a separate node executable", (t) => {
  const appRoot = join(root, ".test-fixtures", "fake-codex-no-node");
  const resources = join(appRoot, "app", "resources");
  const missingNode = join(appRoot, "missing-node.exe");
  rmSync(appRoot, { recursive: true, force: true });
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(resources, "app.asar"), "not a real asar");
  t.after(() => rmSync(appRoot, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [
      script,
      "--app",
      appRoot,
      "--node",
      missingNode,
      "--work",
      join(root, ".test-fixtures", "work-no-node"),
      "--dry-run",
    ],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Missing required path:.*missing-node\.exe/s);
});

test("chrome bundled plugin is installed when missing after patch", async (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-app-asar");
  const appRoot = join(fixtureRoot, "app-root");
  const sourceRoot = join(fixtureRoot, "asar-source");
  const workRoot = join(fixtureRoot, "work");
  const resources = join(appRoot, "app", "resources");
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(sourceRoot, ".vite", "build"), { recursive: true });
  mkdirSync(join(sourceRoot, "webview", "assets"), { recursive: true });
  mkdirSync(resources, { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeAsarPatchFixtures(sourceRoot);
  await createPackage(sourceRoot, join(resources, "app.asar"));

  const result = spawnSync(
    process.execPath,
    [script, "--app", appRoot, "--work", workRoot, "--dry-run", "--patch-browser-client"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  const patchedMain = join(workRoot, ".vite", "build", mainBundleFixtureName);
  const patchedMainText = readFileSync(patchedMain, "utf8");
  assert.match(
    patchedMainText,
    /\{autoInstallOptOutKey:e\.Jn\(e\.Hn\),installWhenMissing:!0,name:e\.Hn,isAvailable:\(\)=>!0,migrate:Ir\}/,
  );
  assert.match(
    patchedMainText,
    /\{installWhenMissing:!0,name:Ae,syncInstallStateWithChromeExtension:!0,isAvailable:\(\)=>!0\}/,
  );
  assert.match(
    patchedMainText,
    /\{installWhenMissing:!0,name:e\.Un,syncInstallStateWithChromeExtension:!0,isAvailable:\(\)=>!0\}/,
  );
  assert.match(
    patchedMainText,
    /\{installWhenMissing:!0,name:ke,syncInstallStateWithChromeExtension:!0,isAvailable:\(\)=>!0\}/,
  );
  assert.match(
    patchedMainText,
    /\{installWhenMissing:!0,name:e\.Wn,isAvailable:\(\{features:e,platform:t\}\)=>t===`win32`&&e\.computerUse\}/,
  );
  assert.match(
    patchedMainText,
    /inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:!0,computerUseNodeRepl:!0/,
  );
  assert.match(patchedMainText, /let p=!0,m=t\.computerUse&&t\.computerUseNodeRepl,h=Ot\(t\);/);
  assert.match(patchedMainText, /function Ot\(e\)\{let t=\[`chrome`\];return e\.inAppBrowserUse&&t\.push\(`iab`\),t\}/);
  assert.doesNotMatch(patchedMainText, /forceReload:!0,name:ke/);

  const patchedDesktopFeatures = readFileSync(join(workRoot, "webview", "assets", appMainFixtureName), "utf8");
  assert.match(
    patchedDesktopFeatures,
    /inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,browserPane:s,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:!0,computerUseNodeRepl:!0/,
  );
  assert.match(
    patchedDesktopFeatures,
    /function mN\(e\)\{let t=\{apps:!0,memories:!0,plugins:!0,browser_use:!0,browser_use_external:!0,computer_use:!0,in_app_browser:!0,tool_search:!0,tool_suggest:!0,tool_call_mcp_elicitation:!0\};for\(let n of fN\)\{let r=e\[n\];r!=null&&\(t\[n\]=t\[n\]===!0\?!0:r\)\}return t\}/,
  );
  const patchedAvailability = readFileSync(
    join(workRoot, "webview", "assets", "use-is-plugins-enabled-aU0WrVOp.js"),
    "utf8",
  );
  assert.match(patchedAvailability, /let _=!0,v=!0,y=!1,b=!1,x;return/);
  assert.match(patchedAvailability, /let l=f\(s\),u=!0,p=!0,m=!1,h;return/);
  assert.match(patchedAvailability, /let u=f\(l\),p=o\(e\.runCodexInWsl\),m=!0,h=!1,g=!1,v;/);
  const patchedPluginFilters = readFileSync(join(workRoot, "webview", "assets", "use-plugins-CpT1TMqr.js"), "utf8");
  assert.match(
    patchedPluginFilters,
    /function H\(e,\{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r\}\)\{return!0\}/,
  );
  const patchedExperimentalFeatures = readFileSync(
    join(workRoot, "webview", "assets", "experimental-features-queries-CTmahqSy.js"),
    "utf8",
  );
  assert.match(patchedExperimentalFeatures, /function p\(e,t\)\{return!0\}/);
  const patchedPersonalization = readFileSync(
    join(workRoot, "webview", "assets", "personalization-settings-DIKmjat4.js"),
    "utf8",
  );
  assert.match(patchedPersonalization, /let oe=!0,se=l\?\.config,ce;/);
});

test("renderer memories patch handles Codex 26.527 marker names", async (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-app-current-memories");
  const appRoot = join(fixtureRoot, "app-root");
  const sourceRoot = join(fixtureRoot, "asar-source");
  const workRoot = join(fixtureRoot, "work");
  const resources = join(appRoot, "app", "resources");
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(sourceRoot, ".vite", "build"), { recursive: true });
  mkdirSync(join(sourceRoot, "webview", "assets"), { recursive: true });
  mkdirSync(resources, { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeAsarPatchFixtures(sourceRoot);
  rmSync(join(sourceRoot, "webview", "assets", "experimental-features-queries-CTmahqSy.js"));
  rmSync(join(sourceRoot, "webview", "assets", "personalization-settings-DIKmjat4.js"));
  writeFileSync(
    join(sourceRoot, "webview", "assets", "experimental-features-queries-CVjYsT-k.js"),
    "list-experimental-features;batch-write-config-value;memories;function f(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}",
  );
  writeFileSync(
    join(sourceRoot, "webview", "assets", "personalization-settings-DR8kNyTH.js"),
    "settings.personalization.memory.title;settings.memory.enableMemoriesLabel;generateMemories;useMemories;let de=ue?.enabled===!0,fe=p?.config,pe;",
  );
  await createPackage(sourceRoot, join(resources, "app.asar"));

  const result = spawnSync(
    process.execPath,
    [script, "--app", appRoot, "--work", workRoot, "--dry-run"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(join(workRoot, "webview", "assets", "experimental-features-queries-CVjYsT-k.js"), "utf8"),
    /function f\(e,t\)\{return!0\}/,
  );
  assert.match(
    readFileSync(join(workRoot, "webview", "assets", "personalization-settings-DR8kNyTH.js"), "utf8"),
    /let de=!0,fe=p\?\.config,pe;/,
  );
});

test("exe ASAR integrity updates from the currently embedded app.asar hash", async (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-app-integrity");
  const appRoot = join(fixtureRoot, "app-root");
  const sourceRoot = join(fixtureRoot, "asar-source");
  const workRoot = join(fixtureRoot, "work");
  const resources = join(appRoot, "app", "resources");
  const exePath = join(appRoot, "app", "Codex.exe");
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(sourceRoot, ".vite", "build"), { recursive: true });
  mkdirSync(join(sourceRoot, "webview", "assets"), { recursive: true });
  mkdirSync(resources, { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeAsarPatchFixtures(sourceRoot);
  await createPackage(sourceRoot, join(resources, "app.asar"));
  const previousHash = asarHeaderHash(join(resources, "app.asar"));
  writeFileSync(exePath, `fake exe bytes ${previousHash} trailing bytes`);

  const result = spawnSync(
    process.execPath,
    [script, "--app", appRoot, "--work", workRoot, "--apply", "--patch-exe-integrity"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  const newHash = asarHeaderHash(join(resources, "app.asar"));
  const exeText = readFileSync(exePath, "utf8");
  assert.notEqual(newHash, previousHash);
  assert.match(exeText, new RegExp(newHash));
  assert.doesNotMatch(exeText, new RegExp(previousHash));
  assert.match(result.stdout, /Patched Electron ASAR integrity/);
});

test("exe ASAR integrity patch skips builds without embedded ASAR header hash", async (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-app-integrity-skip");
  const appRoot = join(fixtureRoot, "app-root");
  const sourceRoot = join(fixtureRoot, "asar-source");
  const workRoot = join(fixtureRoot, "work");
  const resources = join(appRoot, "app", "resources");
  const exePath = join(appRoot, "app", "Codex.exe");
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(sourceRoot, ".vite", "build"), { recursive: true });
  mkdirSync(join(sourceRoot, "webview", "assets"), { recursive: true });
  mkdirSync(resources, { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeAsarPatchFixtures(sourceRoot);
  await createPackage(sourceRoot, join(resources, "app.asar"));
  writeFileSync(exePath, "fake exe bytes without an embedded asar header hash");

  const result = spawnSync(
    process.execPath,
    [script, "--app", appRoot, "--work", workRoot, "--apply", "--patch-exe-integrity"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skipped Electron ASAR integrity patch/);
});

test("bundled browser clients ignore region backend and url gates", async (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-app-plugins");
  const appRoot = join(fixtureRoot, "app-root");
  const sourceRoot = join(fixtureRoot, "asar-source");
  const workRoot = join(fixtureRoot, "work");
  const resources = join(appRoot, "app", "resources");
  const pluginRoot = join(resources, "plugins", "openai-bundled", "plugins");
  const browserClient = [
    "function HF(){return globalThis.nodeRepl?.requestMeta?.[qF]===$F}",
    "function WS(t){if(t===`cdp`)return;let e=YS();if(!(e==null||e.includes(t)))throw new Error(BO(t))}",
    "function KS(t){if(t===`cdp`)return!0;let e=YS();return e==null||e.includes(t)}",
  ].join(";");

  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(sourceRoot, ".vite", "build"), { recursive: true });
  mkdirSync(join(sourceRoot, "webview", "assets"), { recursive: true });
  mkdirSync(join(pluginRoot, "chrome", "scripts"), { recursive: true });
  mkdirSync(join(pluginRoot, "browser-use", "scripts"), { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeAsarPatchFixtures(sourceRoot);
  writeFileSync(join(pluginRoot, "chrome", "scripts", "browser-client.mjs"), browserClient);
  writeFileSync(join(pluginRoot, "browser-use", "scripts", "browser-client.mjs"), browserClient);
  await createPackage(sourceRoot, join(resources, "app.asar"));

  const result = spawnSync(
    process.execPath,
    [script, "--app", appRoot, "--work", workRoot, "--dry-run", "--patch-browser-client"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /browser-client disable remote url policy gate/);
  assert.match(result.stdout, /browser-client disable backend command whitelist/);
  assert.match(result.stdout, /browser-client disable backend discovery whitelist/);
});

test("user plugin cache browser clients can be patched after app resources", async (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-app-cache");
  const appRoot = join(fixtureRoot, "app-root");
  const sourceRoot = join(fixtureRoot, "asar-source");
  const workRoot = join(fixtureRoot, "work");
  const cacheRoot = join(fixtureRoot, "cache", "openai-bundled");
  const resources = join(appRoot, "app", "resources");
  const pluginRoot = join(resources, "plugins", "openai-bundled", "plugins");
  const browserClient = [
    "function HF(){return globalThis.nodeRepl?.requestMeta?.[qF]===$F}",
    'function WS(t){if(t==="cdp")return;let e=YS();if(!(e==null||e.includes(t)))throw new Error(BO(t))}',
    'function KS(t){if(t==="cdp")return!0;let e=YS();return e==null||e.includes(t)}',
  ].join(";");

  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(sourceRoot, ".vite", "build"), { recursive: true });
  mkdirSync(join(sourceRoot, "webview", "assets"), { recursive: true });
  mkdirSync(join(pluginRoot, "chrome", "scripts"), { recursive: true });
  mkdirSync(join(pluginRoot, "chrome", ".codex-plugin"), { recursive: true });
  mkdirSync(join(pluginRoot, "browser-use", "scripts"), { recursive: true });
  mkdirSync(join(pluginRoot, "browser-use", ".codex-plugin"), { recursive: true });
  mkdirSync(join(cacheRoot, "chrome", "0.1.7", "scripts"), { recursive: true });
  mkdirSync(join(cacheRoot, "browser-use", "0.1.0-alpha2", "scripts"), { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeAsarPatchFixtures(sourceRoot);
  writeFileSync(join(pluginRoot, "chrome", "scripts", "browser-client.mjs"), browserClient);
  writeFileSync(join(pluginRoot, "chrome", ".codex-plugin", "plugin.json"), '{"name":"chrome","version":"0.1.7"}');
  writeFileSync(join(pluginRoot, "browser-use", "scripts", "browser-client.mjs"), browserClient);
  writeFileSync(
    join(pluginRoot, "browser-use", ".codex-plugin", "plugin.json"),
    '{"name":"browser-use","version":"0.1.0-alpha2"}',
  );
  writeFileSync(join(cacheRoot, "chrome", "0.1.7", "scripts", "browser-client.mjs"), browserClient);
  writeFileSync(join(cacheRoot, "browser-use", "0.1.0-alpha2", "scripts", "browser-client.mjs"), browserClient);
  await createPackage(sourceRoot, join(resources, "app.asar"));

  const preserveResult = spawnSync(
    process.execPath,
    [
      script,
      "--app",
      appRoot,
      "--cache-only",
      "--apply",
      "--patch-user-plugin-cache",
      "--plugin-cache",
      cacheRoot,
    ],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(preserveResult.status, 0, preserveResult.stderr);
  assert.match(
    readFileSync(join(cacheRoot, "chrome", "0.1.7", "scripts", "browser-client.mjs"), "utf8"),
    /function HF\(\)\{return globalThis\.nodeRepl\?\.requestMeta\?\.\[qF\]===\$F\}/,
  );

  const result = spawnSync(
    process.execPath,
    [
      script,
      "--app",
      appRoot,
      "--work",
      workRoot,
      "--apply",
      "--patch-user-plugin-cache",
      "--patch-browser-client",
      "--plugin-cache",
      cacheRoot,
    ],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  for (const file of [
    join(cacheRoot, "chrome", "0.1.7", "scripts", "browser-client.mjs"),
    join(cacheRoot, "browser-use", "0.1.0-alpha2", "scripts", "browser-client.mjs"),
  ]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /function HF\(\)\{return!0\}/);
    assert.match(text, /function WS\(t\)\{return\}/);
    assert.match(text, /function KS\(t\)\{return!0\}/);
  }

  const chromeCacheClient = join(cacheRoot, "chrome", "0.1.7", "scripts", "browser-client.mjs");
  writeFileSync(chromeCacheClient, browserClient);
  const cacheOnlyResult = spawnSync(
    process.execPath,
    [
      script,
      "--app",
      appRoot,
      "--cache-only",
      "--apply",
      "--patch-user-plugin-cache",
      "--patch-browser-client",
      "--plugin-cache",
      cacheRoot,
    ],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(cacheOnlyResult.status, 0, cacheOnlyResult.stderr);
  assert.match(readFileSync(chromeCacheClient, "utf8"), /function HF\(\)\{return!0\}/);
});

test("user plugin cache sync supports renamed bundled browser plugin layout", async (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-app-cache-renamed-browser");
  const appRoot = join(fixtureRoot, "app-root");
  const cacheRoot = join(fixtureRoot, "cache", "openai-bundled");
  const resources = join(appRoot, "app", "resources");
  const pluginRoot = join(resources, "plugins", "openai-bundled", "plugins");
  const browserClient = [
    "function HF(){return globalThis.nodeRepl?.requestMeta?.[qF]===$F}",
    'function WS(t){if(t==="cdp")return;let e=YS();if(!(e==null||e.includes(t)))throw new Error(BO(t))}',
    'function KS(t){if(t==="cdp")return!0;let e=YS();return e==null||e.includes(t)}',
  ].join(";");

  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(pluginRoot, "chrome", "scripts"), { recursive: true });
  mkdirSync(join(pluginRoot, "chrome", ".codex-plugin"), { recursive: true });
  mkdirSync(join(pluginRoot, "browser", "scripts"), { recursive: true });
  mkdirSync(join(pluginRoot, "browser", ".codex-plugin"), { recursive: true });
  mkdirSync(join(pluginRoot, "computer-use", ".codex-plugin"), { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeFileSync(join(pluginRoot, "chrome", "scripts", "browser-client.mjs"), browserClient);
  writeFileSync(join(pluginRoot, "chrome", ".codex-plugin", "plugin.json"), '{"name":"chrome","version":"26.527.31326"}');
  writeFileSync(join(pluginRoot, "browser", "scripts", "browser-client.mjs"), browserClient);
  writeFileSync(join(pluginRoot, "browser", ".codex-plugin", "plugin.json"), '{"name":"browser","version":"26.527.31326"}');
  writeFileSync(
    join(pluginRoot, "computer-use", ".codex-plugin", "plugin.json"),
    '{"name":"computer-use","version":"26.527.31326"}',
  );

  const result = spawnSync(
    process.execPath,
    [
      script,
      "--app",
      appRoot,
      "--cache-only",
      "--apply",
      "--patch-user-plugin-cache",
      "--patch-browser-client",
      "--plugin-cache",
      cacheRoot,
    ],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /browser-use/);
  for (const pluginName of ["chrome", "browser"]) {
    const text = readFileSync(join(cacheRoot, pluginName, "26.527.31326", "scripts", "browser-client.mjs"), "utf8");
    assert.match(text, /function HF\(\)\{return!0\}/);
    assert.match(text, /function WS\(t\)\{return\}/);
    assert.match(text, /function KS\(t\)\{return!0\}/);
  }
  assert.ok(existsSync(join(cacheRoot, "computer-use", "26.527.31326", ".codex-plugin", "plugin.json")));
});
