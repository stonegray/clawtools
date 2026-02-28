/**
 * clawtools — Platform-agnostic adapter for OpenClaw tools and connectors.
 *
 * This library exposes OpenClaw's tool and connector systems as a standalone
 * NPM package, enabling third-party software to integrate with OpenClaw's
 * extensible capabilities without depending on the full OpenClaw runtime.
 *
 * ## Quick Start
 *
 * ```ts
 * import { createClawtools } from "clawtools";
 *
 * const ct = createClawtools();
 *
 * // List all available tools
 * for (const meta of ct.tools.list()) {
 *   console.log(`${meta.id}: ${meta.description}`);
 * }
 *
 * // Resolve tools for an LLM context
 * // Note: pass root + bridge (FileBridge) to enable the fs tools (read/write/edit).
 * // e.g.: ct.tools.resolveAll({ workspaceDir: "/my/project", root: "/my/project", bridge: createNodeBridge("/my/project") })
 * const tools = ct.tools.resolveAll({ workspaceDir: "/my/project" });
 *
 * // Register a custom tool
 * ct.tools.register({
 *   name: "my_tool",
 *   description: "Does something",
 *   parameters: { type: "object", properties: {} },
 *   execute: async () => ({ content: [{ type: "text", text: "done" }] }),
 * });
 *
 * // Discover openclaw extensions
 * const extensions = ct.extensions;
 * ```
 *
 * ## Architecture
 *
 * The library is organized into three sub-modules:
 *
 * - **tools/** — Tool registry, discovery, parameter helpers, schema utilities.
 * - **connectors/** — Connector registry, auth resolution, extension discovery.
 * - **plugins/** — Plugin loader for OpenClaw-compatible plugin packages.
 *
 * @module
 */

// =============================================================================
// Re-exports: Types
// =============================================================================

export type {
    // Tool types
    Tool,
    ToolResult,
    ToolUpdateCallback,
    ToolContext,
    ToolFactory,
    ToolMeta,
    ToolProfile,
    ToolSection,
    ContentBlock,
    TextContent,
    ImageContent,
    FsBridge,
    FsStat,

    // Connector types
    Connector,
    Api,
    KnownApi,
    ModelDescriptor,
    ModelCost,
    ProviderConfig,
    AuthMode,
    ResolvedAuth,
    StreamEvent,
    StreamOptions,
    StreamContext,
    UserMessage,
    AssistantMessage,
    ConversationMessage,
    ContextMessage,
    ToolResultMessage,
    UsageInfo,

    // Plugin types
    PluginDefinition,
    PluginApi,
} from "./types.js";

// =============================================================================
// Re-exports: Tool system
// =============================================================================

export {
    ToolRegistry,
    discoverCoreTools,
    discoverCoreToolsAsync,
    getCoreToolCatalog,
    getCoreSections,
    jsonResult,
    textResult,
    errorResult,
    imageResult,
    readStringParam,
    readNumberParam,
    readBooleanParam,
    readStringArrayParam,
    assertRequiredParams,
    ToolInputError,
    ToolAuthorizationError,
    extractToolSchema,
    extractToolSchemas,
    normalizeSchema,
    cleanSchemaForGemini,
    createNodeBridge,
} from "./tools/index.js";
export type {
    DiscoveryOptions,
    StringParamOptions,
    NumberParamOptions,
    BooleanParamOptions,
} from "./tools/index.js";

// =============================================================================
// Re-exports: Connector system
// =============================================================================
export {
    ConnectorRegistry,
    resolveAuth,
    serializeModel,
    deserializeModel,
    discoverExtensions,
    discoverBuiltinConnectors,
    discoverBuiltinConnectorsAsync,
    getExtensionPath,
    listChannelExtensions,
    listProviderExtensions,
} from "./connectors/index.js";
export type { AuthResolver, ExtensionInfo, SerializedModel } from "./connectors/index.js";

// =============================================================================
// Re-exports: Plugin system
// =============================================================================

export { loadPlugins } from "./plugins/index.js";
export type {
    LoadedPlugin,
    PluginLoaderOptions,
    PluginManifest,
} from "./plugins/index.js";

// =============================================================================
// Convenience: Pre-configured instance
// =============================================================================

import { ToolRegistry } from "./tools/registry.js";
import { ConnectorRegistry } from "./connectors/registry.js";
import { discoverCoreTools, discoverCoreToolsAsync, type DiscoveryOptions } from "./tools/discovery.js";
import {
    discoverExtensions,
    discoverBuiltinConnectors,
    discoverBuiltinConnectorsAsync,
    type ExtensionInfo,
} from "./connectors/discovery.js";

/**
 * Options for creating a pre-configured clawtools instance.
 */
export interface ClawtoolsOptions {
    /**
     * Override the openclaw submodule root path.
     * Defaults to `./openclaw` relative to the package root.
     */
    openclawRoot?: string;

    /**
     * Tool discovery options (include/exclude filters).
     */
    tools?: DiscoveryOptions;

    /**
     * Override the openclaw extensions directory.
     */
    extensionsDir?: string;

    /**
     * If true, skip auto-discovery of core tools.
     * Useful when you only want custom tools.
     */
    skipCoreTools?: boolean;

    /**
     * If true, skip auto-registration of built-in LLM provider connectors.
     *
     * By default, `createClawtools()` (async) registers connectors for every
     * provider in the `@mariozechner/pi-ai` catalog (anthropic, openai,
     * google, amazon-bedrock, …). Set this flag to manage connectors manually.
     *
     * Has no effect on `createClawtoolsSync()`, which never loads connectors.
     */
    skipBuiltinConnectors?: boolean;

    /**
     * If true, start loading tools and connectors in the background but return
     * the `Clawtools` instance immediately without waiting.
     *
     * Useful when you only need catalog metadata at startup (listing providers,
     * filtering by profile, etc.) and want to defer the cost of pulling in all
     * provider SDKs until they are actually needed. Await `ct.ready` before
     * calling `resolveAll()` or streaming when using this mode.
     *
     * Has no effect on `createClawtoolsSync()`, which never performs async
     * loading.
     */
    lazy?: boolean;
}

/**
 * A pre-configured clawtools instance with tools and connectors ready to use.
 */
export interface Clawtools {
    /** Tool registry with discovered tools. */
    tools: ToolRegistry;
    /** Connector registry. */
    connectors: ConnectorRegistry;
    /** Discovered openclaw extensions metadata. */
    extensions: ExtensionInfo[];
    /**
     * Resolves when all background loading is complete.
     *
     * For `createClawtoolsSync()` this is always already resolved.
     * For `createClawtools()` (async) without `lazy: true` this is also
     * already resolved by the time the instance is returned.
     * For `createClawtools({ lazy: true })`, await this before calling
     * `tools.resolveAll()` or streaming for the first time.
     */
    ready: Promise<void>;
}

/**
 * Create a pre-configured clawtools instance (sync, catalog-only).
 *
 * This is the recommended entry point for catalog-only use (listing tools,
 * filtering by profile, resolving metadata). Tool factories are registered
 * lazily but **cannot execute** without pre-loaded modules — call
 * {@link createClawtools} (async) when you need `resolveAll()` to return
 * executable tools backed by real implementations.
 *
 * @param options - Configuration options.
 * @returns A configured Clawtools instance.
 *
 * @example
 * ```ts
 * import { createClawtoolsSync } from "clawtools";
 *
 * const ct = createClawtoolsSync();
 *
 * // Catalog metadata is always available
 * for (const meta of ct.tools.list()) {
 *   console.log(`${meta.id}: ${meta.description}`);
 * }
 *
 * // For executable tools, use await createClawtools() instead.
 * ```
 */
export function createClawtoolsSync(options?: ClawtoolsOptions): Clawtools {
    const toolRegistry = new ToolRegistry();
    const connectorRegistry = new ConnectorRegistry();

    // Discover core tools (metadata-only — factories return null without async load)
    if (!options?.skipCoreTools) {
        discoverCoreTools(toolRegistry, {
            openclawRoot: options?.openclawRoot,
            ...options?.tools,
        });
    }

    // Discover extensions
    const extensions = discoverExtensions(options?.extensionsDir);

    return {
        tools: toolRegistry,
        connectors: connectorRegistry,
        extensions,
        ready: Promise.resolve(),
    };
}

/**
 * Create a pre-configured clawtools instance with fully executable tools.
 *
 * Uses {@link discoverCoreToolsAsync} to load pre-built tool bundles (or
 * openclaw TypeScript source under a compatible runtime). After awaiting,
 * `ct.tools.resolveAll()` returns live tool objects with working `execute`
 * methods.
 *
 * This is the **async default** entry point — prefer this over
 * {@link createClawtoolsSync} unless you only need catalog metadata.
 *
 * @param options - Configuration options.
 * @returns A configured Clawtools instance with executable tools.
 *
 * @example
 * ```ts
 * import { createClawtools, createNodeBridge } from "clawtools";
 *
 * const ct = await createClawtools();
 * const root = process.cwd();
 *
 * // Tools are fully executable after awaiting
 * const tools = ct.tools.resolveAll({
 *   root,
 *   bridge: createNodeBridge(root),
 * });
 * console.log(`${tools.length} tools loaded`);
 *
 * // Iterate connectors directly from the facade
 * for (const connector of ct.connectors) {
 *   console.log(connector.id);
 * }
 * ```
 */
export async function createClawtools(options?: ClawtoolsOptions): Promise<Clawtools> {
    const toolRegistry = new ToolRegistry();
    const connectorRegistry = new ConnectorRegistry();

    // Build the two load tasks and run them concurrently to avoid serialising
    // what are effectively two independent dynamic imports.
    const toolsLoad = options?.skipCoreTools
        ? Promise.resolve()
        : discoverCoreToolsAsync(toolRegistry, {
              openclawRoot: options?.openclawRoot,
              ...options?.tools,
          });

    const connectorsLoad = options?.skipBuiltinConnectors
        ? Promise.resolve()
        : discoverBuiltinConnectors().then((builtins) => {
              for (const connector of builtins) {
                  connectorRegistry.register(connector);
              }
          });

    const extensions = discoverExtensions(options?.extensionsDir);

    if (options?.lazy) {
        // Start both loads in the background; callers can await `ready` when
        // they need the registries to be fully populated.
        const ready = Promise.all([toolsLoad, connectorsLoad]).then(() => undefined);
        return { tools: toolRegistry, connectors: connectorRegistry, extensions, ready };
    }

    // Default: wait for everything before returning, same observable behaviour
    // as before but both loads now run concurrently rather than in series.
    await Promise.all([toolsLoad, connectorsLoad]);

    return {
        tools: toolRegistry,
        connectors: connectorRegistry,
        extensions,
        ready: Promise.resolve(),
    };
}

/**
 * @deprecated Use {@link createClawtools} instead.
 * Renamed to drop the `Async` suffix per the async-by-default naming convention.
 * The sync variant is now {@link createClawtoolsSync}.
 */
export async function createClawtoolsAsync(options?: ClawtoolsOptions): Promise<Clawtools> {
    return createClawtools(options);
}
