import assert from "node:assert/strict";
import asar from "@electron/asar";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, "scripts", "patch-codex-chrome-macos.mjs");
const { createPackage } = asar;

const mainPatchMarkers = [
  "externalBrowserUse:!1,externalBrowserUseAllowed:!1",
  "inAppBrowserUse:!1,inAppBrowserUseAllowed:!1,externalBrowserUse:!1,externalBrowserUseAllowed:!1,computerUse:!1,computerUseNodeRepl:!1",
  "{forceReload:!0,name:lt,isAvailable:({buildFlavor:e,features:t})=>t.externalBrowserUseAllowed&&Yn(e)}",
  "{autoInstallOptOutKey:e.Nn(e.Dn),forceReload:!0,installWhenMissing:!0,name:e.Dn,isAvailable:({features:e})=>e.inAppBrowserUseAllowed,migrate:$n}",
  "name:e.On,isAvailable:({buildFlavor:e,features:t})=>Jn(e)&&t.externalBrowserUseAllowed",
  "{installWhenMissing:!0,name:e.kn,isAvailable:({buildFlavor:e,features:n,platform:r})=>t.T.isInternal(e)&&r===`win32`&&n.computerUse}",
  "let p=t.inAppBrowserUse||t.externalBrowserUse,m=t.computerUse&&t.computerUseNodeRepl,h=Jt(t);if(!p&&!m)return null;",
  "function Jt(e){let t=[];return e.externalBrowserUse&&t.push(`chrome`),e.inAppBrowserUse&&t.push(`iab`),t}",
].join(";");

const rendererDesktopFeatureDispatch =
  "inAppBrowserUse:c.available,inAppBrowserUseAllowed:c.allowed,browserPane:r,externalBrowserUse:d.available,externalBrowserUseAllowed:d.allowed,computerUse:m.available,computerUseNodeRepl:m.available&&h";

const rendererBrowserAvailabilityMarkers = [
  "let _=a&&i&&l&&(o||m),v=_&&!o&&p.enabled&&!p.isLoading,y=_&&p.isLoading,b=_&&(o||p.isLoading),x;return",
  "let o=h(a),c=i&&o.enabled&&!o.isLoading,l=r&&c,u;return",
  "let f=h(u),p=c(e.RUN_CODEX_IN_WSL),m=f.enabled&&!f.isLoading,g=o&&l&&m&&!p.isLoading&&p.data!==!0,_=a&&g,v=f.isLoading||p.isLoading,y;return",
].join(";");

const rendererPluginFilterMarkers =
  "function H(e,{isComputerUseAvailable:t,isExternalBrowserUseAvailable:n,isInAppBrowserUseAvailable:r}){return!(!r&&U(e)||!n&&W(e)||!t&&G(e))}";
const rendererDefaultFeatureOverridesMarker =
  "function EP(e){let t={};for(let n of wP){let r=e[n];r!=null&&(t[n]=r)}return t}";
const rendererExperimentalFeaturesQueriesMarker =
  "function m(e,t){return t||e.some(e=>e.name===`memories`&&e.enabled)}";
const rendererPersonalizationSettingsMarker =
  "let ae=ie?.enabled===!0,oe=c?.config,se;";

function writeAsarPatchFixtures(sourceRoot) {
  writeFileSync(join(sourceRoot, ".vite", "build", "main-DcB8P4Mu.js"), mainPatchMarkers);
  writeFileSync(
    join(sourceRoot, "webview", "assets", "app-main-BssxuQ1L.js"),
    `${rendererDesktopFeatureDispatch};${rendererDefaultFeatureOverridesMarker}`,
  );
  writeFileSync(
    join(sourceRoot, "webview", "assets", "use-in-app-browser-use-availability-_UMFu9j2.js"),
    rendererBrowserAvailabilityMarkers,
  );
  writeFileSync(join(sourceRoot, "webview", "assets", "use-plugins-BytcsIoF.js"), rendererPluginFilterMarkers);
  writeFileSync(
    join(sourceRoot, "webview", "assets", "experimental-features-queries-CbYry4Xm.js"),
    rendererExperimentalFeaturesQueriesMarker,
  );
  writeFileSync(
    join(sourceRoot, "webview", "assets", "personalization-settings-BF3OPzwC.js"),
    rendererPersonalizationSettingsMarker,
  );
}

function asarHeaderHash(asarPath) {
  const buffer = readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(12);
  return createHash("sha256").update(buffer.subarray(16, 16 + headerSize)).digest("hex");
}

function bashPathFromRoot(file) {
  return relative(root, file).replaceAll("\\", "/");
}

test("--app is honored before macOS app auto-detection", () => {
  const missingApp = join(root, ".does-not-exist.app");
  const result = spawnSync(
    process.execPath,
    [script, "--app", missingApp, "--dry-run"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required path:.*\.does-not-exist\.app.*Contents.*Resources.*app\.asar/s);
  assert.doesNotMatch(result.stderr, /WindowsApps|Codex\.exe|mdfind/s);
});

test("macOS shell entrypoints parse cleanly", (t) => {
  const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (bash.status !== 0) {
    t.skip("bash is not available in this environment");
    return;
  }

  for (const file of [
    join(root, "scripts", "auto-patch-codex-macos.sh"),
    join(root, "scripts", "launch-patched-codex-macos.sh"),
    join(root, "scripts", "setup-codex-macos.sh"),
    join(root, "scripts", "create-codex-macos-copy.sh"),
    join(root, "scripts", "create-codex-macos-launcher.sh"),
    join(root, "scripts", "configure-codex-memories.sh"),
    join(root, "scripts", "codex-doctor-macos.sh"),
    join(root, "scripts", "inspect-codex-macos.sh"),
  ]) {
    const result = spawnSync("bash", ["-n", bashPathFromRoot(file)], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `${file}\n${result.stdout}\n${result.stderr}`);
  }
});

test("macOS workflow applies Chrome bridge trust patch by default", () => {
  const autoPatch = readFileSync(join(root, "scripts", "auto-patch-codex-macos.sh"), "utf8");
  const launcher = readFileSync(join(root, "scripts", "launch-patched-codex-macos.sh"), "utf8");
  const setup = readFileSync(join(root, "scripts", "setup-codex-macos.sh"), "utf8");
  const agentGuidance = readFileSync(join(root, "CODEX.md"), "utf8");

  assert.match(autoPatch, /sync_plugin_cache=1/);
  assert.match(autoPatch, /repair_chrome_plugin=1/);
  assert.match(autoPatch, /patch_browser_client=1/);
  assert.match(autoPatch, /patch_revision=4/);
  assert.match(launcher, /patch_browser_client=1/);
  assert.match(launcher, /--patch-user-plugin-cache/);
  assert.match(launcher, /--patch-browser-client/);
  assert.match(setup, /intentionally applies the macOS Chrome patch/);
  assert.doesNotMatch(setup, /does not patch Codex Electron bundles|bypass regional gates/);
  assert.match(agentGuidance, /browser-client is not trusted/);
  assert.match(agentGuidance, /patch-codex-chrome-macos\.mjs/);
});

test("dry-run patches a macOS app bundle layout without touching app.asar", async (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-macos-app-asar");
  const appRoot = join(fixtureRoot, "Codex.app");
  const sourceRoot = join(fixtureRoot, "asar-source");
  const workRoot = join(fixtureRoot, "work");
  const resources = join(appRoot, "Contents", "Resources");
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(sourceRoot, ".vite", "build"), { recursive: true });
  mkdirSync(join(sourceRoot, "webview", "assets"), { recursive: true });
  mkdirSync(resources, { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeAsarPatchFixtures(sourceRoot);
  await createPackage(sourceRoot, join(resources, "app.asar"));
  const originalHash = asarHeaderHash(join(resources, "app.asar"));

  const result = spawnSync(
    process.execPath,
    [script, "--app", appRoot, "--work", workRoot, "--dry-run", "--patch-browser-client"],
    { cwd: root, encoding: "utf8", env: { ...process.env, CODEX_APP_ROOT: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(asarHeaderHash(join(resources, "app.asar")), originalHash);
  assert.match(result.stdout, /"mode": "dry-run"/);
  assert.match(result.stdout, /"appRoot":/);
  assert.doesNotMatch(result.stdout, /Codex\.exe|patch-exe-integrity/);

  const patchedMainText = readFileSync(join(workRoot, ".vite", "build", "main-DcB8P4Mu.js"), "utf8");
  assert.match(
    patchedMainText,
    /inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0,computerUse:!0,computerUseNodeRepl:!0/,
  );
});

test("user plugin cache sync reads bundled plugins from Contents/Resources", (t) => {
  const fixtureRoot = join(root, ".test-fixtures", "codex-macos-plugin-cache");
  const appRoot = join(fixtureRoot, "Codex.app");
  const cacheRoot = join(fixtureRoot, "cache", "openai-bundled");
  const resources = join(appRoot, "Contents", "Resources");
  const pluginRoot = join(resources, "plugins", "openai-bundled", "plugins");
  const browserClient = [
    "function HF(){return globalThis.nodeRepl?.requestMeta?.[qF]===$F}",
    'function WS(t){if(t==="cdp")return;let e=YS();if(!(e==null||e.includes(t)))throw new Error(BO(t))}',
    'function KS(t){if(t==="cdp")return!0;let e=YS();return e==null||e.includes(t)}',
  ].join(";");

  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(join(pluginRoot, "chrome", "scripts"), { recursive: true });
  mkdirSync(join(pluginRoot, "chrome", ".codex-plugin"), { recursive: true });
  mkdirSync(join(pluginRoot, "browser-use", "scripts"), { recursive: true });
  mkdirSync(join(pluginRoot, "browser-use", ".codex-plugin"), { recursive: true });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  writeFileSync(join(pluginRoot, "chrome", "scripts", "browser-client.mjs"), browserClient);
  writeFileSync(join(pluginRoot, "chrome", ".codex-plugin", "plugin.json"), '{"name":"chrome","version":"0.1.7"}');
  writeFileSync(join(pluginRoot, "browser-use", "scripts", "browser-client.mjs"), browserClient);
  writeFileSync(
    join(pluginRoot, "browser-use", ".codex-plugin", "plugin.json"),
    '{"name":"browser-use","version":"0.1.0-alpha2"}',
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
  for (const file of [
    join(cacheRoot, "chrome", "0.1.7", "scripts", "browser-client.mjs"),
    join(cacheRoot, "browser-use", "0.1.0-alpha2", "scripts", "browser-client.mjs"),
  ]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /function HF\(\)\{return!0\}/);
    assert.match(text, /function WS\(t\)\{return\}/);
    assert.match(text, /function KS\(t\)\{return!0\}/);
  }
  assert.ok(existsSync(join(cacheRoot, "chrome", "latest")));
  assert.ok(readdirSync(join(cacheRoot, "browser-use")).includes("latest"));
});
