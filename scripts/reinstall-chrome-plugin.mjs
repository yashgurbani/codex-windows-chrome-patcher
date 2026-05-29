#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function usage() {
  console.log(`Usage:
  node scripts/reinstall-chrome-plugin.mjs --app PATH [--plugin chrome]

Reinstalls the bundled Chrome plugin through Codex app-server APIs, then
verifies the Chrome native messaging host manifest. This does not write the
Chrome registry key directly.`);
}

function parseArgs(argv) {
  const opts = {
    app: process.env.CODEX_APP_ROOT || null,
    plugin: "chrome",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--app") opts.app = argv[++i];
    else if (arg.startsWith("--app=")) opts.app = arg.slice("--app=".length);
    else if (arg === "--plugin") opts.plugin = argv[++i];
    else if (arg.startsWith("--plugin=")) opts.plugin = arg.slice("--plugin=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (opts.app == null) throw new Error("Missing --app PATH.");
  opts.app = resolve(opts.app);
  return opts;
}

function request(appServer, id, method, params, timeoutMs = 90_000) {
  const payload = { id, method };
  if (params !== undefined) payload.params = params;
  appServer.stdin.write(`${JSON.stringify(payload)}\n`);

  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (appServer.responses.has(id)) {
        clearInterval(timer);
        const response = appServer.responses.get(id);
        appServer.responses.delete(id);
        resolve(response);
        return;
      }
      if (appServer.process.exitCode != null) {
        clearInterval(timer);
        reject(new Error(`app-server exited with ${appServer.process.exitCode}: ${appServer.stderr.slice(-20).join("\n")}`));
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`${method} timed out: ${appServer.stderr.slice(-20).join("\n")}`));
      }
    }, 50);
  });
}

function startAppServer(codexExe) {
  const child = spawn(codexExe, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const appServer = { process: child, responses: new Map(), stderr: [], stdin: child.stdin };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      try {
        const message = JSON.parse(line);
        if (message.id != null) appServer.responses.set(message.id, message);
      } catch {
        // Ignore non-protocol output.
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim().length > 0) appServer.stderr.push(line.trim());
    }
  });
  return appServer;
}

async function reinstallPlugin({ appRoot, pluginName }) {
  const codexExe = join(appRoot, "app", "resources", "codex.exe");
  const marketplacePath = join(appRoot, "app", "resources", "plugins", "openai-bundled", ".agents", "plugins", "marketplace.json");
  const checkManifest = join(appRoot, "app", "resources", "plugins", "openai-bundled", "plugins", pluginName, "scripts", "check-native-host-manifest.js");

  for (const path of [codexExe, marketplacePath, checkManifest]) {
    if (!existsSync(path)) throw new Error(`Missing required path: ${path}`);
  }

  const appServer = startAppServer(codexExe);
  try {
    const initialize = await request(appServer, "initialize", "initialize", {
      clientInfo: { name: "chrome-plugin-reinstall", title: "Chrome Plugin Reinstall", version: "0" },
      capabilities: { experimentalApi: true },
    }, 30_000);
    if (initialize.error) throw new Error(`initialize failed: ${initialize.error.message}`);

    const uninstall = await request(appServer, "uninstall", "plugin/uninstall", {
      pluginId: `${pluginName}@openai-bundled`,
    });
    if (uninstall.error) throw new Error(`plugin/uninstall failed: ${uninstall.error.message}`);

    const install = await request(appServer, "install", "plugin/install", {
      marketplacePath,
      remoteMarketplaceName: null,
      pluginName,
    }, 120_000);
    if (install.error) throw new Error(`plugin/install failed: ${install.error.message}`);

    const verify = spawnSync(process.execPath, [checkManifest, "--json"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const verifyText = verify.stdout.trim();
    const verifyJson = verifyText.length > 0 ? JSON.parse(verifyText) : null;
    if (verify.status !== 0) {
      throw new Error(`native host verification failed: ${verifyText || verify.stderr.trim()}`);
    }

    return { marketplacePath, pluginName, uninstall, install, nativeHost: verifyJson };
  } finally {
    appServer.process.kill();
  }
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const result = await reinstallPlugin({ appRoot: opts.app, pluginName: opts.plugin });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
