#!/usr/bin/env node
import http from "node:http";

function parseArgs(argv) {
  const options = {
    port: 14567,
    mode: "enable",
    readyTimeoutMs: 20_000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg.startsWith("--port=")) options.port = Number(arg.slice("--port=".length));
    else if (arg === "--mode") options.mode = argv[++i];
    else if (arg.startsWith("--mode=")) options.mode = arg.slice("--mode=".length);
    else if (arg === "--ready-timeout-ms") options.readyTimeoutMs = Number(argv[++i]);
    else if (arg.startsWith("--ready-timeout-ms=")) {
      options.readyTimeoutMs = Number(arg.slice("--ready-timeout-ms=".length));
    } else if (/^\d+$/.test(arg)) options.port = Number(arg);
    else if (["enable", "disable", "status"].includes(arg)) options.mode = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!["enable", "disable", "status"].includes(options.mode)) {
    throw new Error(`Invalid mode: ${options.mode}`);
  }
  return options;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkReady(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/readyz`, (res) => {
      res.resume();
      res.statusCode === 200 ? resolve() : reject(new Error(`readyz ${res.statusCode}`));
    });
    req.on("error", reject);
    req.setTimeout(1_000, () => req.destroy(new Error("readyz timeout")));
  });
}

async function waitForReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await checkReady(port);
      return;
    } catch (error) {
      lastError = error;
      await wait(500);
    }
  }
  throw new Error(`Codex app-server did not become ready on port ${port}: ${lastError?.message ?? "timeout"}`);
}

function eventText(event) {
  const data = event.data;
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
}

async function connectWebSocket(port) {
  if (typeof WebSocket === "undefined") {
    throw new Error("Node.js WebSocket API is unavailable. Use the bundled Codex Node.js or a recent Node.js.");
  }

  const url = `ws://127.0.0.1:${port}`;
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`Unable to connect to ${url}`));
  });
  return ws;
}

function createRpc(ws) {
  let nextId = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(eventText(event));
    if (message.method === "remoteControl/status/changed") {
      const status = message.params ?? {};
      console.log(`status=${status.status ?? "unknown"} server=${status.serverName ?? ""} environment=${status.environmentId ?? ""}`);
    }

    if (message.id != null && pending.has(String(message.id))) {
      const { resolve, reject, allowError, timer } = pending.get(String(message.id));
      clearTimeout(timer);
      pending.delete(String(message.id));
      if (message.error && !allowError) reject(new Error(`${message.error.code ?? "error"} ${message.error.message ?? JSON.stringify(message.error)}`));
      else resolve(message);
    }
  };

  return (method, params = null, { allowError = false, timeoutMs = 15_000 } = {}) =>
    new Promise((resolve, reject) => {
      const id = String(++nextId);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, allowError, timer });
      const request = params == null ? { id, method } : { id, method, params };
      ws.send(JSON.stringify(request));
    });
}

async function main() {
  const { port, mode, readyTimeoutMs } = parseArgs(process.argv.slice(2));
  await waitForReady(port, readyTimeoutMs);

  const ws = await connectWebSocket(port);
  const rpc = createRpc(ws);

  try {
    await rpc("initialize", {
      clientInfo: { name: "codex-remote-control-wrapper", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });

    const featureResult = await rpc(
      "experimentalFeature/enablement/set",
      { enablement: { remote_control: true } },
      { allowError: true },
    );
    if (featureResult.error) {
      console.warn(`remote_control feature enablement warning: ${featureResult.error.message ?? JSON.stringify(featureResult.error)}`);
    }

    if (mode === "disable") {
      const disabled = await rpc("remoteControl/disable");
      console.log(`final=${JSON.stringify(disabled.result ?? null)}`);
      return;
    }

    if (mode === "enable") {
      await rpc("remoteControl/enable");
    }

    let latest = await rpc("remoteControl/status/read");
    for (let i = 0; i < 20 && latest.result?.status !== "connected"; i += 1) {
      await wait(1_000);
      latest = await rpc("remoteControl/status/read");
    }

    console.log(`final=${JSON.stringify(latest.result ?? null)}`);
    if (mode === "enable" && latest.result?.status !== "connected") {
      process.exitCode = 2;
    }
  } finally {
    ws.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
