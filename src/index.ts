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
} from "./tools/index.js";
export type { DiscoveryOptions } from "./tools/index.js";

// =============================================================================
// Re-exports: Connector system
// =============================================================================
export {
    ConnectorRegistry,
    resolveAuth,
    discoverExtensions,
    getExtensionPath,
    listChannelExtensions,
    listProviderExtensions,
} from "./connectors/index.js";
export type { AuthResolver, ExtensionInfo } from "./connectors/index.js";

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
}

/**
 * Create a pre-configured clawtools instance.
 *
 * This is the recommended entry point for catalog-only use (listing tools,
 * filtering by profile, resolving metadata). Tool factories are registered
 * lazily but **cannot execute** without pre-loaded modules — call
 * {@link createClawtoolsAsync} when you need `resolveAll()` to return
 * executable tools backed by real implementations.
 *
 * @param options - Configuration options.
 * @returns A configured Clawtools instance.
 *
 * @example
 * ```ts
 * import { createClawtools } from "clawtools";
 *
 * const ct = createClawtools();
 *
 * // Catalog metadata is always available
 * for (const meta of ct.tools.list()) {
 *   console.log(`${meta.id}: ${meta.description}`);
 * }
 *
 * // For executable tools, use createClawtoolsAsync() instead.
 * ```
 */
export function createClawtools(options?: ClawtoolsOptions): Clawtools {
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
    };
}

/**
 * Create a pre-configured clawtools instance with fully executable tools.
 *
 * Async variant of {@link createClawtools}. Uses {@link discoverCoreToolsAsync}
 * to load pre-built tool bundles (or openclaw TypeScript source under a
 * compatible runtime). After awaiting, `ct.tools.resolveAll()` returns live
 * tool objects with working `execute` methods.
 *
 * @param options - Configuration options.
 * @returns A configured Clawtools instance with executable tools.
 *
 * @example
 * ```ts
 * import { createClawtoolsAsync } from "clawtools";
 *
 * const ct = await createClawtoolsAsync();
 *
 * // Tools are fully executable
 * const tools = ct.tools.resolveAll({ workspaceDir: "/my/project" });
 * console.log(`${tools.length} tools loaded`);
 * ```
 */
export async function createClawtoolsAsync(options?: ClawtoolsOptions): Promise<Clawtools> {
    const toolRegistry = new ToolRegistry();
    const connectorRegistry = new ConnectorRegistry();

    if (!options?.skipCoreTools) {
        await discoverCoreToolsAsync(toolRegistry, {
            openclawRoot: options?.openclawRoot,
            ...options?.tools,
        });
    }

    const extensions = discoverExtensions(options?.extensionsDir);

    return {
        tools: toolRegistry,
        connectors: connectorRegistry,
        extensions,
    };
}
