#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);

function readArg(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function defaultPaseoAsarPath() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is not set; pass --asar explicitly.");
  }
  return path.join(localAppData, "Programs", "Paseo", "resources", "app.asar");
}

function replaceSameLength(buffer, search, replacement, label, results) {
  const searchBytes = Buffer.from(search, "utf8");
  const index = buffer.indexOf(searchBytes);
  if (index === -1) {
    if (buffer.indexOf(Buffer.from("codex import quick-list patch", "utf8")) !== -1 && label.includes("quick-list")) {
      results.push({ label, status: "already-patched" });
      return buffer;
    }
    results.push({ label, status: "missing" });
    return buffer;
  }

  const replacementBytesRaw = Buffer.from(replacement, "utf8");
  if (replacementBytesRaw.length > searchBytes.length) {
    throw new Error(`${label} replacement is longer than search block (${replacementBytesRaw.length} > ${searchBytes.length})`);
  }

  const replacementBytes = Buffer.concat([
    replacementBytesRaw,
    Buffer.from(" ".repeat(searchBytes.length - replacementBytesRaw.length), "utf8"),
  ]);

  const next = Buffer.from(buffer);
  replacementBytes.copy(next, index);
  results.push({ label, status: "patched" });
  return next;
}

function replaceTargetedTimeout(buffer, anchor, from, to, label, results) {
  const anchorBytes = Buffer.from(anchor, "utf8");
  const anchorIndex = buffer.indexOf(anchorBytes);
  if (anchorIndex === -1) {
    results.push({ label, status: "missing-anchor" });
    return buffer;
  }

  const windowEnd = Math.min(buffer.length, anchorIndex + 1600);
  const window = buffer.subarray(anchorIndex, windowEnd);
  const fromBytes = Buffer.from(from, "utf8");
  const relativeIndex = window.indexOf(fromBytes);
  if (relativeIndex === -1) {
    if (window.indexOf(Buffer.from(to, "utf8")) !== -1) {
      results.push({ label, status: "already-patched" });
      return buffer;
    }
    results.push({ label, status: "missing-timeout" });
    return buffer;
  }

  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) {
    throw new Error(`${label} timeout replacement must be byte-length stable.`);
  }

  const next = Buffer.from(buffer);
  Buffer.from(to, "utf8").copy(next, anchorIndex + relativeIndex);
  results.push({ label, status: "patched" });
  return next;
}

function replaceAfterAnchor(buffer, anchor, search, replacement, label, results, windowSize = 4096) {
  const anchorBytes = Buffer.from(anchor, "utf8");
  const anchorIndex = buffer.indexOf(anchorBytes);
  if (anchorIndex === -1) {
    results.push({ label, status: "missing-anchor" });
    return buffer;
  }

  const windowEnd = Math.min(buffer.length, anchorIndex + windowSize);
  const window = buffer.subarray(anchorIndex, windowEnd);
  const searchBytes = Buffer.from(search, "utf8");
  const relativeIndex = window.indexOf(searchBytes);
  if (relativeIndex === -1) {
    if (window.indexOf(Buffer.from(replacement.trim(), "utf8")) !== -1) {
      results.push({ label, status: "already-patched" });
      return buffer;
    }
    results.push({ label, status: "missing" });
    return buffer;
  }

  const replacementBytes = Buffer.from(replacement, "utf8");
  if (replacementBytes.length !== searchBytes.length) {
    throw new Error(`${label} replacement must be byte-length stable (${replacementBytes.length} !== ${searchBytes.length}).`);
  }

  const next = Buffer.from(buffer);
  replacementBytes.copy(next, anchorIndex + relativeIndex);
  results.push({ label, status: "patched" });
  return next;
}

const asarPath = path.resolve(readArg("--asar", defaultPaseoAsarPath()));
const dryRun = hasFlag("--dry-run");
const noBackup = hasFlag("--no-backup");

if (!fs.existsSync(asarPath)) {
  throw new Error(`Missing Paseo app.asar: ${asarPath}`);
}

const quickListSearch = `            const descriptors = await Promise.all(threads.slice(0, limit).map(async (thread) => {
                const threadId = typeof thread.id === "string" ? thread.id : "";
                const cwd = typeof thread.cwd === "string" ? thread.cwd : process.cwd();
                const title = typeof thread.preview === "string" ? thread.preview : null;
                let timeline = [];
                try {
                    timeline = await loadCodexThreadHistoryTimeline({
                        threadId,
                        cwd,
                        requestThread: (threadIdToRead) => {
                            return readCodexThread(client, threadIdToRead);
                        },
                    });
                }
                catch {
                    timeline = [];
                }
                return {
                    provider: CODEX_PROVIDER,
                    sessionId: threadId,
                    cwd,
                    title,
                    lastActivityAt: new Date(((typeof thread.updatedAt === "number" ? thread.updatedAt : undefined) ??
                        (typeof thread.createdAt === "number" ? thread.createdAt : undefined) ??
                        0) * 1000),
                    persistence: {
                        provider: CODEX_PROVIDER,
                        sessionId: threadId,
                        nativeHandle: threadId,
                        metadata: {
                            provider: CODEX_PROVIDER,
                            cwd,
                            title,
                            threadId,
                        },
                    },
                    timeline: timeline.map((entry) => entry.item),
                };
            }));`;

const quickListReplacement = `            const descriptors = threads.slice(0, limit).map((thread) => {
                const threadId = typeof thread.id === "string" ? thread.id : "";
                const cwd = typeof thread.cwd === "string" ? thread.cwd : process.cwd();
                const title = typeof thread.preview === "string" ? thread.preview : null;
                const preview = title && title.trim() ? title : threadId;
                // codex import quick-list patch: avoid full thread/read hydration while listing imports.
                return {
                    provider: CODEX_PROVIDER,
                    sessionId: threadId,
                    cwd,
                    title,
                    lastActivityAt: new Date(((typeof thread.updatedAt === "number" ? thread.updatedAt : undefined) ??
                        (typeof thread.createdAt === "number" ? thread.createdAt : undefined) ??
                        0) * 1000),
                    persistence: {
                        provider: CODEX_PROVIDER,
                        sessionId: threadId,
                        nativeHandle: threadId,
                        metadata: {
                            provider: CODEX_PROVIDER,
                            cwd,
                            title,
                            threadId,
                        },
                    },
                    timeline: preview ? [{ type: "user_message", text: preview }] : [],
                };
            });`;

let buffer = fs.readFileSync(asarPath);
const results = [];

buffer = replaceSameLength(buffer, quickListSearch, quickListReplacement, "server codex import quick-list", results);
buffer = replaceTargetedTimeout(
  buffer,
  `type: "fetch_recent_provider_sessions_request",`,
  `timeout: 10000,`,
  `timeout: 60000,`,
  "client recent provider sessions timeout",
  results,
);
buffer = replaceTargetedTimeout(
  buffer,
  `type: "import_agent_request",`,
  `timeout: 15000,`,
  `timeout: 60000,`,
  "client import agent timeout",
  results,
);
buffer = replaceAfterAnchor(
  buffer,
  `async listPersistedAgents(options) {\n        const child = await this.spawnAppServer();`,
  `await client.dispose();`,
  `void client.dispose(); `,
  "server codex import nonblocking dispose",
  results,
);

const changed = results.some((result) => result.status === "patched");
if (changed && !dryRun) {
  if (!noBackup) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
    const backupPath = `${asarPath}.bak-codex-import-${stamp}`;
    fs.copyFileSync(asarPath, backupPath);
    results.push({ label: "backup", status: backupPath });
  }
  fs.writeFileSync(asarPath, buffer);
}

console.log(JSON.stringify({
  mode: dryRun ? "dry-run" : "apply",
  asarPath,
  changed,
  results,
  note: changed && !dryRun ? "Restart Paseo for this patch to load." : undefined,
}, null, 2));
