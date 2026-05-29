import readline from "node:readline";
import { z } from "zod";
import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";
const DEFAULT_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;
const APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2000;
const APP_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS = 1000;
const STDERR_BUFFER_LIMIT = 8192;
const CodexThreadForkResponseSchema = z
    .object({
    thread: z
        .object({
        id: z.string(),
        sessionId: z.string().optional(),
        forkedFromId: z.string().nullable().optional(),
        turns: z.array(z.unknown()).optional(),
    })
        .passthrough(),
    model: z.string(),
    modelProvider: z.string(),
    serviceTier: z.string().nullable(),
    cwd: z.string(),
    runtimeWorkspaceRoots: z.array(z.string()).optional().default([]),
    instructionSources: z.array(z.string()).optional().default([]),
    approvalPolicy: z.unknown(),
    approvalsReviewer: z.unknown(),
    sandbox: z.unknown(),
    activePermissionProfile: z.unknown().optional(),
    reasoningEffort: z.string().nullable().optional(),
})
    .passthrough();
export function parseCodexThreadForkResponse(response) {
    return CodexThreadForkResponseSchema.parse(response);
}
const CodexThreadRollbackResponseSchema = z
    .object({
    thread: z
        .object({
        id: z.string(),
        sessionId: z.string().optional(),
        forkedFromId: z.string().nullable().optional(),
        turns: z.array(z.unknown()).optional(),
    })
        .passthrough(),
})
    .passthrough();
export function parseCodexThreadRollbackResponse(response) {
    return CodexThreadRollbackResponseSchema.parse(response);
}
function isRecord(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}
function isJsonRpcResponse(msg) {
    if (!isRecord(msg))
        return false;
    return typeof msg.id === "number";
}
function isJsonRpcRequest(msg) {
    if (!isRecord(msg))
        return false;
    return typeof msg.id === "number" && typeof msg.method === "string";
}
function isJsonRpcNotification(msg) {
    if (!isRecord(msg))
        return false;
    return typeof msg.method === "string" && msg.id === undefined;
}
function readProviderSessionId(params) {
    if (!isRecord(params)) {
        return undefined;
    }
    return typeof params.threadId === "string" ? params.threadId : undefined;
}
function readProviderTurnId(params) {
    if (!isRecord(params)) {
        return undefined;
    }
    if (typeof params.turnId === "string") {
        return params.turnId;
    }
    const turn = params.turn;
    return isRecord(turn) && typeof turn.id === "string" ? turn.id : undefined;
}
export class CodexAppServerClient {
    constructor(child, logger, getTraceContext = () => ({})) {
        this.child = child;
        this.logger = logger;
        this.getTraceContext = getTraceContext;
        this.pending = new Map();
        this.requestHandlers = new Map();
        this.notificationHandler = null;
        this.nextId = 1;
        this.disposed = false;
        this.stderrBuffer = "";
        this.rl = readline.createInterface({ input: child.stdout });
        this.rl.on("line", (line) => {
            void this.handleLine(line).catch((error) => {
                this.logger.warn({ error, line }, "Failed to handle Codex app-server stdout line");
            });
        });
        child.stderr.on("data", (chunk) => {
            this.stderrBuffer += chunk.toString();
            if (this.stderrBuffer.length > STDERR_BUFFER_LIMIT) {
                this.stderrBuffer = this.stderrBuffer.slice(-STDERR_BUFFER_LIMIT);
            }
        });
        child.on("error", (err) => {
            this.logger.error({ err }, "Codex app-server child process error");
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(err);
            }
            this.pending.clear();
            this.disposed = true;
        });
        child.on("exit", (code, signal) => {
            const message = code === 0 && !signal
                ? "Codex app-server exited"
                : `Codex app-server exited with code ${code ?? "null"} and signal ${signal ?? "null"}`;
            const error = new Error(`${message}\n${this.stderrBuffer}`.trim());
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(error);
            }
            this.pending.clear();
            this.disposed = true;
        });
    }
    setNotificationHandler(handler) {
        this.notificationHandler = handler;
    }
    setRequestHandler(method, handler) {
        this.requestHandlers.set(method, handler);
    }
    request(method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
        if (this.disposed) {
            return Promise.reject(new Error("Codex app-server client is closed"));
        }
        const id = this.nextId++;
        const payload = { id, method, params };
        const serialized = JSON.stringify(payload);
        this.child.stdin.write(`${serialized}\n`);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Codex app-server request timed out for ${method}`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
        });
    }
    async forkThread(params) {
        return parseCodexThreadForkResponse(await this.request("thread/fork", params));
    }
    async rollbackThread(params) {
        return parseCodexThreadRollbackResponse(await this.request("thread/rollback", params));
    }
    notify(method, params) {
        if (this.disposed) {
            return;
        }
        const payload = { method, params };
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.rl.close();
        try {
            this.child.stdin.end();
        }
        catch {
            // ignore
        }
        const result = await terminateWithTreeKill(this.child, {
            gracefulTimeoutMs: APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
            forceTimeoutMs: APP_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS,
            onForceSignal: () => {
                this.logger.warn({ timeoutMs: APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS }, "Codex app-server did not exit after SIGTERM; sending SIGKILL");
            },
        });
        if (result === "kill-timeout") {
            this.logger.warn({ timeoutMs: APP_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS }, "Codex app-server did not report exit after SIGKILL");
        }
    }
    writeJsonRpcResponse(response) {
        if (this.disposed || this.child.stdin.destroyed || !this.child.stdin.writable) {
            return;
        }
        try {
            this.child.stdin.write(`${JSON.stringify(response)}\n`);
        }
        catch (error) {
            this.logger.debug({ error }, "Failed to write Codex app-server JSON-RPC response");
        }
    }
    async handleLine(line) {
        if (!line.trim())
            return;
        let raw;
        try {
            raw = JSON.parse(line);
        }
        catch (error) {
            this.logger.warn({ error, line }, "Ignoring non-JSON Codex app-server stdout line");
            return;
        }
        if (!isRecord(raw)) {
            this.logger.warn({ line }, "Parsed JSON is not an object");
            return;
        }
        if (isJsonRpcResponse(raw)) {
            const id = raw.id;
            if (raw.result !== undefined || raw.error) {
                const pending = this.pending.get(id);
                if (!pending)
                    return;
                clearTimeout(pending.timer);
                this.pending.delete(id);
                if (raw.error) {
                    pending.reject(new Error(raw.error.message ?? "Unknown error"));
                }
                else {
                    pending.resolve(raw.result);
                }
                return;
            }
            if (isJsonRpcRequest(raw)) {
                const request = raw;
                this.traceRawEvent(request);
                const handler = this.requestHandlers.get(request.method);
                try {
                    const result = handler ? await handler(request.params) : {};
                    this.writeJsonRpcResponse({ id: request.id, result });
                }
                catch (error) {
                    this.writeJsonRpcResponse({
                        id: request.id,
                        error: { message: error instanceof Error ? error.message : String(error) },
                    });
                }
                return;
            }
        }
        if (isJsonRpcNotification(raw)) {
            this.traceRawEvent(raw);
            this.notificationHandler?.(raw.method, raw.params);
        }
    }
    traceRawEvent(raw) {
        const traceContext = this.getTraceContext();
        this.logger.trace({
            provider: "codex",
            agentId: traceContext.agentId,
            sessionId: traceContext.sessionId ?? readProviderSessionId(raw.params),
            turnId: traceContext.turnId ?? readProviderTurnId(raw.params),
            method: raw.method,
            params: raw.params,
            rawEvent: raw,
        }, "provider.codex.raw_event");
    }
}
//# sourceMappingURL=app-server-transport.js.map