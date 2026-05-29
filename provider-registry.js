import { isDefaultAgentCreateConfigUnattended, resolveDefaultAgentCreateConfig, } from "./create-agent-mode.js";
import { normalizeAgentModelDefinition } from "./agent-sdk-types.js";
import { ClaudeAgentClient } from "./providers/claude/agent.js";
import { CodexAppServerAgentClient } from "./providers/codex-app-server-agent.js";
import { CopilotACPAgentClient } from "./providers/copilot-acp-agent.js";
import { CursorACPAgentClient } from "./providers/cursor-acp-agent.js";
import { GenericACPAgentClient } from "./providers/generic-acp-agent.js";
import { OpenCodeAgentClient } from "./providers/opencode-agent.js";
import { PiRpcAgentClient } from "./providers/pi/agent.js";
import { MockLoadTestAgentClient } from "./providers/mock-load-test-agent.js";
import { MockSlowProviderClient } from "./providers/mock-slow-provider.js";
import { AGENT_PROVIDER_DEFINITIONS, BUILTIN_PROVIDER_IDS, DEV_AGENT_PROVIDER_DEFINITIONS, getAgentProviderDefinition, } from "@getpaseo/protocol/provider-manifest";
function isNonEmptyStringArray(value) {
    return value.length > 0;
}
export { AGENT_PROVIDER_DEFINITIONS, getAgentProviderDefinition };
export { IMPORTABLE_PROVIDERS } from "@getpaseo/protocol/importable-providers";
const PROVIDER_CLIENT_FACTORIES = {
    claude: (logger, runtimeSettings) => new ClaudeAgentClient({
        logger,
        runtimeSettings,
    }),
    codex: (logger, runtimeSettings, options) => new CodexAppServerAgentClient(logger, runtimeSettings, {
        workspaceGitService: options?.workspaceGitService,
        customProvider: options?.customProvider,
    }),
    copilot: (logger, runtimeSettings) => new CopilotACPAgentClient({
        logger,
        runtimeSettings,
    }),
    cursor: (logger, runtimeSettings) => new CursorACPAgentClient({
        logger,
        command: getCursorACPCommand(runtimeSettings),
        env: runtimeSettings?.env,
    }),
    opencode: (logger, runtimeSettings) => new OpenCodeAgentClient(logger, runtimeSettings),
    pi: (logger, runtimeSettings) => new PiRpcAgentClient({
        logger,
        runtimeSettings,
    }),
    mock: (logger) => new MockLoadTestAgentClient(logger),
    "mock-slow": () => new MockSlowProviderClient(),
};
function getCursorACPCommand(runtimeSettings) {
    if (runtimeSettings?.command?.mode === "replace" &&
        isNonEmptyStringArray(runtimeSettings.command.argv)) {
        return runtimeSettings.command.argv;
    }
    return ["cursor-agent", "acp"];
}
function getProviderClientFactory(provider) {
    const factory = PROVIDER_CLIENT_FACTORIES[provider];
    if (!factory) {
        throw new Error(`No provider client factory registered for '${provider}'`);
    }
    return factory;
}
function toRuntimeSettings(override) {
    if (!override?.command && !override?.env && !override?.disallowedTools) {
        return undefined;
    }
    return {
        command: override.command
            ? {
                mode: "replace",
                argv: override.command,
            }
            : undefined,
        env: override.env,
        disallowedTools: override.disallowedTools,
    };
}
function mergeRuntimeSettings(base, override) {
    if (!base && !override) {
        return undefined;
    }
    return {
        command: override?.command ?? base?.command,
        env: base?.env || override?.env
            ? {
                ...base?.env,
                ...override?.env,
            }
            : undefined,
        disallowedTools: base?.disallowedTools || override?.disallowedTools
            ? [...(base?.disallowedTools ?? []), ...(override?.disallowedTools ?? [])]
            : undefined,
    };
}
function applyOverrideToDefinition(definition, override) {
    if (!override) {
        return definition;
    }
    return {
        ...definition,
        label: override.label ?? definition.label,
        description: override.description ?? definition.description,
    };
}
function createDerivedDefinition(providerId, baseDefinition, override) {
    if (!override.label) {
        throw new Error(`Custom provider '${providerId}' requires a label`);
    }
    return {
        ...baseDefinition,
        id: providerId,
        label: override.label,
        description: override.description ?? baseDefinition.description,
    };
}
function mapPersistenceHandle(provider, handle) {
    if (!handle) {
        return null;
    }
    return {
        ...handle,
        provider,
    };
}
function mapRuntimeInfo(provider, runtimeInfo) {
    return {
        ...runtimeInfo,
        provider,
    };
}
function mapStreamEvent(provider, event) {
    return {
        ...event,
        provider,
    };
}
function mapPersistedAgentDescriptor(provider, descriptor) {
    return {
        ...descriptor,
        provider,
        persistence: {
            ...descriptor.persistence,
            provider,
        },
    };
}
function mapModel(provider, model) {
    return normalizeAgentModelDefinition({ ...model, provider });
}
function mergeModels(provider, profileModels, additionalModels, runtimeModels, options) {
    const baseModels = runtimeModels.map((model) => mapModel(provider, model));
    if (profileModels.length > 0 && options?.profileModelsAreAdditive !== true) {
        return mergeModelAdditions(provider, profileModels.map((model) => mapModel(provider, model)), additionalModels);
    }
    return mergeModelAdditions(provider, baseModels, [...profileModels, ...additionalModels]);
}
function mergeModelAdditions(provider, baseModels, modelAdditions) {
    if (modelAdditions.length === 0) {
        return baseModels;
    }
    const mergedModels = [...baseModels];
    let hasAdditionalDefault = false;
    for (const model of modelAdditions) {
        const additionalModel = mapModel(provider, model);
        hasAdditionalDefault || (hasAdditionalDefault = additionalModel.isDefault === true);
        const existingIndex = mergedModels.findIndex((candidate) => candidate.id === model.id);
        if (existingIndex === -1) {
            mergedModels.push(additionalModel);
            continue;
        }
        mergedModels[existingIndex] = {
            ...mergedModels[existingIndex],
            ...additionalModel,
        };
    }
    if (!hasAdditionalDefault) {
        return mergedModels;
    }
    const additionalDefaultIds = new Set(modelAdditions.filter((model) => model.isDefault === true).map((model) => model.id));
    return mergedModels.map((model) => additionalDefaultIds.has(model.id) ? model : Object.assign({}, model, { isDefault: false }));
}
export function wrapSessionProvider(provider, inner) {
    return {
        provider,
        id: inner.id,
        capabilities: inner.capabilities,
        get features() {
            return inner.features;
        },
        run: (prompt, options) => inner.run(prompt, options),
        startTurn: (prompt, options) => inner.startTurn(prompt, options),
        subscribe: (callback) => inner.subscribe((event) => callback(mapStreamEvent(provider, event))),
        async *streamHistory() {
            for await (const event of inner.streamHistory()) {
                yield mapStreamEvent(provider, event);
            }
        },
        getRuntimeInfo: async () => mapRuntimeInfo(provider, await inner.getRuntimeInfo()),
        getAvailableModes: () => inner.getAvailableModes(),
        getCurrentMode: () => inner.getCurrentMode(),
        setMode: (modeId) => inner.setMode(modeId),
        getPendingPermissions: () => inner.getPendingPermissions(),
        respondToPermission: (requestId, response) => inner.respondToPermission(requestId, response),
        describePersistence: () => mapPersistenceHandle(provider, inner.describePersistence()),
        interrupt: () => inner.interrupt(),
        close: () => inner.close(),
        listCommands: inner.listCommands?.bind(inner),
        setModel: inner.setModel?.bind(inner),
        setThinkingOption: inner.setThinkingOption?.bind(inner),
        setFeature: inner.setFeature?.bind(inner),
        revertConversation: inner.revertConversation?.bind(inner),
        revertFiles: inner.revertFiles?.bind(inner),
        revertBoth: inner.revertBoth?.bind(inner),
        tryHandleOutOfBand: inner.tryHandleOutOfBand?.bind(inner),
    };
}
function wrapClientProvider(provider, inner, profileModels, additionalModels, profileModelsAreAdditive) {
    const listPersistedAgents = inner.listPersistedAgents?.bind(inner);
    return {
        provider,
        capabilities: inner.capabilities,
        createSession: async (config, launchContext) => wrapSessionProvider(provider, await inner.createSession({
            ...config,
            provider: inner.provider,
        }, launchContext)),
        resumeSession: async (handle, overrides, launchContext) => wrapSessionProvider(provider, await inner.resumeSession({
            ...handle,
            provider: inner.provider,
        }, overrides
            ? {
                ...overrides,
                provider: inner.provider,
            }
            : undefined, launchContext)),
        listModels: async (options) => mergeModels(provider, profileModels, additionalModels, await inner.listModels(options), {
            profileModelsAreAdditive,
        }),
        listModes: inner.listModes?.bind(inner),
        resolveCreateConfig: inner.resolveCreateConfig?.bind(inner),
        isCreateConfigUnattended: inner.isCreateConfigUnattended?.bind(inner),
        listPersistedAgents: listPersistedAgents
            ? async (options) => (await listPersistedAgents(options)).map((descriptor) => mapPersistedAgentDescriptor(provider, descriptor))
            : undefined,
        isAvailable: () => inner.isAvailable(),
        getDiagnostic: inner.getDiagnostic?.bind(inner),
    };
}
function createRegistryEntry(logger, provider, resolved) {
    const modelClient = resolved.createBaseClient(logger);
    return {
        ...resolved.definition,
        enabled: resolved.enabled,
        derivedFromProviderId: resolved.derivedFromProviderId,
        createClient: (providerLogger) => createResolvedProviderClient(providerLogger, provider, resolved),
        resolveCreateConfig: modelClient.resolveCreateConfig ?? resolveDefaultAgentCreateConfig,
        isCreateConfigUnattended: modelClient.isCreateConfigUnattended ?? isDefaultAgentCreateConfigUnattended,
        fetchModels: async (options) => mergeModels(provider, resolved.profileModels, resolved.additionalModels, await modelClient.listModels(options), {
            profileModelsAreAdditive: resolved.profileModelsAreAdditive,
        }),
        fetchModes: async (options) => {
            const modes = modelClient.listModes
                ? await modelClient.listModes(options)
                : resolved.definition.modes;
            return modes.map((mode) => {
                if (mode.icon && mode.colorTier)
                    return mode;
                const definitionMode = resolved.definition.modes.find((d) => d.id === mode.id);
                if (!definitionMode)
                    return mode;
                return Object.assign({}, mode, {
                    icon: mode.icon ?? definitionMode.icon,
                    colorTier: mode.colorTier ?? definitionMode.colorTier,
                });
            });
        },
    };
}
function createResolvedProviderClient(logger, provider, resolved) {
    const inner = resolved.createBaseClient(logger);
    const hasModelOverrides = resolved.profileModels.length > 0 || resolved.additionalModels.length > 0;
    if (inner.provider === provider && !hasModelOverrides) {
        return inner;
    }
    return wrapClientProvider(provider, inner, resolved.profileModels, resolved.additionalModels, resolved.profileModelsAreAdditive);
}
function buildResolvedBuiltinProviders(providerOverrides, runtimeSettings, options, isDev) {
    const resolvedProviders = new Map();
    const definitions = isDev
        ? [...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS]
        : AGENT_PROVIDER_DEFINITIONS;
    for (const definition of definitions) {
        const override = providerOverrides[definition.id];
        const factory = getProviderClientFactory(definition.id);
        const mergedRuntimeSettings = mergeRuntimeSettings(runtimeSettings?.[definition.id], toRuntimeSettings(override));
        resolvedProviders.set(definition.id, {
            definition: applyOverrideToDefinition(definition, override),
            runtimeSettings: mergedRuntimeSettings,
            profileModels: override?.models ?? [],
            additionalModels: override?.additionalModels ?? [],
            profileModelsAreAdditive: definition.id === "claude",
            enabled: override?.enabled !== false,
            derivedFromProviderId: null,
            createBaseClient: (logger) => factory(logger, mergedRuntimeSettings, {
                workspaceGitService: options.workspaceGitService,
            }),
        });
    }
    return resolvedProviders;
}
function addDerivedProviders(resolvedProviders, providerOverrides) {
    for (const [providerId, override] of Object.entries(providerOverrides)) {
        if (resolvedProviders.has(providerId) || BUILTIN_PROVIDER_IDS.includes(providerId)) {
            continue;
        }
        if (!override.extends) {
            throw new Error(`Custom provider '${providerId}' requires an extends value`);
        }
        if (override.extends === "acp") {
            if (!override.command || !isNonEmptyStringArray(override.command)) {
                throw new Error(`ACP provider '${providerId}' requires a command`);
            }
            // Capture command in const for closure - TypeScript can't track type refinement inside closures
            const command = override.command;
            resolvedProviders.set(providerId, {
                definition: createDerivedDefinition(providerId, {
                    id: providerId,
                    label: override.label ?? providerId,
                    description: override.description ?? "Custom ACP provider",
                    defaultModeId: null,
                    modes: [],
                }, override),
                runtimeSettings: toRuntimeSettings(override),
                profileModels: override.models ?? [],
                additionalModels: override.additionalModels ?? [],
                profileModelsAreAdditive: false,
                enabled: override.enabled !== false,
                derivedFromProviderId: null,
                createBaseClient: (logger) => providerId === "cursor"
                    ? new CursorACPAgentClient({
                        logger,
                        command,
                        env: override.env,
                        providerId,
                        label: override.label ?? providerId,
                    })
                    : new GenericACPAgentClient({
                        logger,
                        command,
                        env: override.env,
                        providerId,
                        label: override.label ?? providerId,
                    }),
            });
            continue;
        }
        const baseProviderId = override.extends;
        const baseProvider = resolvedProviders.get(baseProviderId);
        if (!baseProvider) {
            throw new Error(`Custom provider '${providerId}' extends unknown provider '${baseProviderId}'`);
        }
        const mergedRuntimeSettings = mergeRuntimeSettings(baseProvider.runtimeSettings, toRuntimeSettings(override));
        const baseDefinition = baseProvider.definition;
        const baseFactory = getProviderClientFactory(baseProviderId);
        resolvedProviders.set(providerId, {
            definition: createDerivedDefinition(providerId, baseDefinition, override),
            runtimeSettings: mergedRuntimeSettings,
            profileModels: override.models ?? [],
            additionalModels: override.additionalModels ?? [],
            profileModelsAreAdditive: false,
            enabled: override.enabled !== false,
            derivedFromProviderId: baseProviderId,
            createBaseClient: (logger) => baseFactory(logger, mergedRuntimeSettings, {
                customProvider: {
                    id: providerId,
                    label: override.label ?? providerId,
                    extends: baseProviderId,
                },
            }),
        });
    }
}
export function buildProviderRegistry(logger, options) {
    const runtimeSettings = options?.runtimeSettings;
    const providerOverrides = options?.providerOverrides ?? {};
    const resolvedProviders = buildResolvedBuiltinProviders(providerOverrides, runtimeSettings, {
        workspaceGitService: options?.workspaceGitService,
    }, options?.isDev === true);
    addDerivedProviders(resolvedProviders, providerOverrides);
    return Object.fromEntries([...resolvedProviders.entries()].map(([provider, resolved]) => [
        provider,
        createRegistryEntry(logger, provider, resolved),
    ]));
}
export function getProviderIds(registry) {
    return Object.keys(registry);
}
// Deprecated: Use buildProviderRegistry instead
export const PROVIDER_REGISTRY = null;
export function createAllClients(logger, options) {
    return createClientsFromRegistry(buildProviderRegistry(logger, options), logger);
}
export function createClientsFromRegistry(registry, logger) {
    return Object.fromEntries(Object.entries(registry).map(([provider, definition]) => [
        provider,
        definition.createClient(logger),
    ]));
}
export async function shutdownProviders(logger, options) {
    const clients = createAllClients(logger, options);
    await shutdownAgentClients(Object.values(clients), logger);
}
export async function shutdownAgentClients(clients, logger) {
    await Promise.all(Array.from(clients).map(async (client) => {
        if (!client.shutdown)
            return;
        try {
            await client.shutdown();
        }
        catch (error) {
            logger.warn({ err: error, provider: client.provider }, "Provider client shutdown failed");
        }
    }));
}
//# sourceMappingURL=provider-registry.js.map