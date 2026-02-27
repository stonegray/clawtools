/**
 * OpenClaw Tool Discovery — scans the openclaw submodule for built-in tools.
 *
 * ## Tool loading strategy
 *
 * The tool catalog metadata (names, descriptions, sections) is always available
 * with no dependencies. **Actual tool execution** uses pre-bundled JS modules:
 *
 * - **Bundled tools** (preferred): The build step (`npm run build`) produces
 *   standalone ESM bundles in `dist/core-tools/`. These are compiled from
 *   openclaw's TypeScript source at build time — no TypeScript runtime or
 *   openclaw source tree is needed at runtime.
 *
 * - **Source fallback** (development): If bundles are not present and the
 *   openclaw git submodule exists, tools can be loaded directly from `.ts`
 *   source files. This requires a TypeScript-capable runtime (vitest, tsx,
 *   ts-node).
 *
 * @module
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Tool, ToolContext, ToolMeta, ToolSection } from "../types.js";
import { ToolRegistry } from "./registry.js";

// =============================================================================
// Bundle and source root resolution
// =============================================================================

/** Entry in the bundle manifest (dist/core-tools/manifest.json). */
interface BundleManifestEntry {
    bundle: string;
    factory: string;
}

/** Resolved bundle manifest with absolute paths. */
interface ResolvedManifest {
    entries: Record<string, { bundlePath: string; factory: string }>;
}

/**
 * Locate and read the pre-built tool bundle manifest.
 *
 * The manifest lives at `dist/core-tools/manifest.json` relative to the
 * package root. From the compiled `dist/tools/discovery.js`, that's
 * `../core-tools/manifest.json`.
 */
function resolveBundleManifest(): ResolvedManifest | null {
    // From dist/tools/discovery.js → ../core-tools/manifest.json
    const distDir = resolve(new URL(".", import.meta.url).pathname, "..");
    const manifestPath = join(distDir, "core-tools", "manifest.json");

    if (!existsSync(manifestPath)) return null;

    try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
            string,
            BundleManifestEntry
        >;
        const entries: ResolvedManifest["entries"] = {};
        for (const [id, entry] of Object.entries(raw)) {
            // Bundle paths in the manifest are relative to dist/, e.g. "./core-tools/foo.js"
            entries[id] = {
                bundlePath: join(distDir, entry.bundle),
                factory: entry.factory,
            };
        }
        return { entries };
    } catch {
        return null;
    }
}

/**
 * Resolve the openclaw root directory to use for source-based fallback loading.
 *
 * Priority order:
 * 1. Caller-supplied `openclawRoot`
 * 2. The git submodule at `../../openclaw` relative to this compiled file
 *    (works in development and monorepo setups)
 *
 * Returns the path and whether the directory actually exists on disk.
 */
function resolveOpenclawRoot(override?: string): { root: string; exists: boolean } {
    if (override) {
        return { root: override, exists: existsSync(override) };
    }
    // From dist/tools/discovery.js → ../../openclaw
    const submodule = resolve(
        new URL(".", import.meta.url).pathname,
        "../../openclaw",
    );
    return { root: submodule, exists: existsSync(submodule) };
}

/**
 * Build the importable module path for a tool factory.
 *
 * openclaw stores tool factories as TypeScript source files (e.g.
 * `src/agents/bash-tools.ts`). These can only be dynamically imported when
 * running under a TypeScript-capable runtime. The function returns the path
 * as-is; callers must handle import errors gracefully.
 */
function toolModulePath(root: string, factoryModule: string): string {
    return join(root, factoryModule);
}

/**
 * Core tool section ordering — mirrors openclaw's `tool-catalog.ts`.
 *
 * This is reimplemented here to avoid importing from openclaw.
 * Original source: openclaw/src/agents/tool-catalog.ts (MIT license)
 */
const CORE_SECTIONS: ToolSection[] = [
    { id: "fs", label: "Files" },
    { id: "runtime", label: "Runtime" },
    { id: "web", label: "Web" },
    { id: "memory", label: "Memory" },
    { id: "sessions", label: "Sessions" },
    { id: "ui", label: "UI" },
    { id: "messaging", label: "Messaging" },
    { id: "automation", label: "Automation" },
    { id: "nodes", label: "Nodes" },
    { id: "agents", label: "Agents" },
    { id: "media", label: "Media" },
];

/**
 * Core tool catalog — reimplemented from openclaw's `tool-catalog.ts`.
 *
 * Each entry maps a tool name to its metadata and the factory function path
 * within the openclaw submodule that creates it.
 *
 * Original source: openclaw/src/agents/tool-catalog.ts (MIT license)
 */
const CORE_TOOL_CATALOG: Array<
    ToolMeta & { factoryName: string; factoryModule: string }
> = [
        {
            id: "read",
            label: "read",
            description: "Read file contents",
            sectionId: "fs",
            profiles: ["coding"],
            source: "core",
            factoryModule: "src/agents/pi-tools.read.ts",
            factoryName: "createSandboxedReadTool",
        },
        {
            id: "write",
            label: "write",
            description: "Create or overwrite files",
            sectionId: "fs",
            profiles: ["coding"],
            source: "core",
            factoryModule: "src/agents/pi-tools.read.ts",
            factoryName: "createSandboxedWriteTool",
        },
        {
            id: "edit",
            label: "edit",
            description: "Make precise edits",
            sectionId: "fs",
            profiles: ["coding"],
            source: "core",
            factoryModule: "src/agents/pi-tools.read.ts",
            factoryName: "createSandboxedEditTool",
        },
        {
            id: "exec",
            label: "exec",
            description: "Run shell commands",
            sectionId: "runtime",
            profiles: ["coding"],
            source: "core",
            factoryModule: "src/agents/bash-tools.exec.ts",
            factoryName: "createExecTool",
        },
        {
            id: "web_search",
            label: "web_search",
            description: "Search the web",
            sectionId: "web",
            profiles: [],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/web-search.ts",
            factoryName: "createWebSearchTool",
        },
        {
            id: "web_fetch",
            label: "web_fetch",
            description: "Fetch web content",
            sectionId: "web",
            profiles: [],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/web-fetch.ts",
            factoryName: "createWebFetchTool",
        },
        {
            id: "memory_search",
            label: "memory_search",
            description: "Semantic memory search",
            sectionId: "memory",
            profiles: ["coding"],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/memory-tool.ts",
            factoryName: "createMemorySearchTool",
        },
        {
            id: "memory_get",
            label: "memory_get",
            description: "Read memory files",
            sectionId: "memory",
            profiles: ["coding"],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/memory-tool.ts",
            factoryName: "createMemoryGetTool",
        },
        {
            id: "sessions_list",
            label: "sessions_list",
            description: "List active sessions",
            sectionId: "sessions",
            profiles: ["coding", "messaging"],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/sessions-list-tool.ts",
            factoryName: "createSessionsListTool",
        },
        {
            id: "sessions_history",
            label: "sessions_history",
            description: "View session history",
            sectionId: "sessions",
            profiles: ["coding", "messaging"],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/sessions-history-tool.ts",
            factoryName: "createSessionsHistoryTool",
        },
        {
            id: "sessions_send",
            label: "sessions_send",
            description: "Send messages to a session",
            sectionId: "sessions",
            profiles: ["coding", "messaging"],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/sessions-send-tool.ts",
            factoryName: "createSessionsSendTool",
        },
        {
            id: "sessions_spawn",
            label: "sessions_spawn",
            description: "Spawn a sub-agent session",
            sectionId: "sessions",
            profiles: ["coding"],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/sessions-spawn-tool.ts",
            factoryName: "createSessionsSpawnTool",
        },
        {
            id: "subagents",
            label: "subagents",
            description: "Manage sub-agent sessions",
            sectionId: "sessions",
            profiles: ["coding"],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/subagents-tool.ts",
            factoryName: "createSubagentsTool",
        },
        {
            id: "session_status",
            label: "session_status",
            description: "View session status and model info",
            sectionId: "sessions",
            profiles: ["minimal", "coding", "messaging"],
            source: "core",
            includeInOpenClawGroup: true,
            factoryModule: "src/agents/tools/session-status-tool.ts",
            factoryName: "createSessionStatusTool",
        },
        {
            id: "browser",
            label: "browser",
            description: "Control a headless browser",
            sectionId: "ui",
            profiles: ["coding"],
            source: "core",
            factoryModule: "src/agents/tools/browser-tool.ts",
            factoryName: "createBrowserTool",
        },
        {
            id: "canvas",
            label: "canvas",
            description: "Render canvas visualizations",
            sectionId: "ui",
            profiles: ["coding"],
            source: "core",
            factoryModule: "src/agents/tools/canvas-tool.ts",
            factoryName: "createCanvasTool",
        },
        {
            id: "message",
            label: "message",
            description: "Send messages across channels",
            sectionId: "messaging",
            profiles: ["messaging"],
            source: "core",
            factoryModule: "src/agents/tools/message-tool.ts",
            factoryName: "createMessageTool",
        },
        {
            id: "cron",
            label: "cron",
            description: "Schedule recurring tasks",
            sectionId: "automation",
            profiles: [],
            source: "core",
            factoryModule: "src/agents/tools/cron-tool.ts",
            factoryName: "createCronTool",
        },
        {
            id: "gateway",
            label: "gateway",
            description: "Gateway management",
            sectionId: "automation",
            profiles: [],
            source: "core",
            factoryModule: "src/agents/tools/gateway-tool.ts",
            factoryName: "createGatewayTool",
        },
        {
            id: "nodes",
            label: "nodes",
            description: "Manage cluster nodes",
            sectionId: "nodes",
            profiles: [],
            source: "core",
            factoryModule: "src/agents/tools/nodes-tool.ts",
            factoryName: "createNodesTool",
        },
        {
            id: "agents_list",
            label: "agents_list",
            description: "List configured agents",
            sectionId: "agents",
            profiles: [],
            source: "core",
            factoryModule: "src/agents/tools/agents-list-tool.ts",
            factoryName: "createAgentsListTool",
        },
        {
            id: "image",
            label: "image",
            description: "Generate and process images",
            sectionId: "media",
            profiles: ["coding"],
            source: "core",
            factoryModule: "src/agents/tools/image-tool.ts",
            factoryName: "createImageTool",
        },
        {
            id: "tts",
            label: "tts",
            description: "Text-to-speech synthesis",
            sectionId: "media",
            profiles: [],
            source: "core",
            factoryModule: "src/agents/tools/tts-tool.ts",
            factoryName: "createTtsTool",
        },
    ];

// =============================================================================
// Discovery Options
// =============================================================================

export interface DiscoveryOptions {
    /**
     * Override the openclaw source root path (source fallback mode).
     * Only used when pre-built bundles are not available.
     * Must point at the openclaw **TypeScript source** directory (not a compiled bundle),
     * and the calling runtime must be capable of importing `.ts` files (vitest, tsx, ts-node).
     */
    openclawRoot?: string;
    /**
     * Filter which tool IDs to include. If undefined, all tools are included.
     * Supports "group:" prefixes (e.g., "group:fs", "group:web").
     */
    include?: string[];
    /**
     * Tool IDs to exclude from discovery.
     */
    exclude?: string[];
    /**
     * Called when tool modules cannot be loaded (missing openclaw source,
     * compiled JS environment without a TypeScript runtime, etc.).
     * If not provided, warnings are silently discarded.
     */
    onLoadWarning?: (message: string) => void;
}

// =============================================================================
// Tool Groups (mirrors openclaw's CORE_TOOL_GROUPS)
// =============================================================================

/**
 * Predefined tool groups — reimplemented from openclaw's tool-catalog.ts.
 * Original source: openclaw/src/agents/tool-catalog.ts (MIT license)
 */
const CORE_TOOL_GROUPS: Record<string, string[]> = {
    // Note: apply_patch and process exist in openclaw but require non-ToolContext
    // factory signatures; they are not yet wired into the catalog.
    "group:fs": ["read", "write", "edit"],
    "group:runtime": ["exec"],
    "group:web": ["web_search", "web_fetch"],
    "group:memory": ["memory_search", "memory_get"],
    "group:sessions": [
        "sessions_list",
        "sessions_history",
        "sessions_send",
        "sessions_spawn",
        "subagents",
        "session_status",
    ],
    "group:ui": ["browser", "canvas"],
    "group:messaging": ["message"],
    "group:automation": ["cron", "gateway"],
    "group:nodes": ["nodes"],
    "group:agents": ["agents_list"],
    "group:media": ["image", "tts"],
};

/**
 * Expand group references in a tool ID list.
 * "group:fs" → ["read", "write", "edit"]
 */
function expandGroups(ids: string[]): Set<string> {
    const result = new Set<string>();
    for (const id of ids) {
        if (id.startsWith("group:") && CORE_TOOL_GROUPS[id]) {
            for (const toolId of CORE_TOOL_GROUPS[id]) {
                result.add(toolId);
            }
        } else {
            result.add(id);
        }
    }
    return result;
}

// =============================================================================
// Discovery API
// =============================================================================

/**
 * Return the list of all core tool sections.
 */
export function getCoreSections(): ToolSection[] {
    return [...CORE_SECTIONS];
}

/**
 * Return the full core tool catalog metadata (without loading any implementations).
 */
export function getCoreToolCatalog(): ToolMeta[] {
    return CORE_TOOL_CATALOG.map(({ factoryModule, factoryName, ...meta }) => meta);
}

/**
 * Discover and register all core OpenClaw tools into a registry.
 *
 * **Catalog/metadata use only.** This function immediately registers a
 * null-returning stub factory for every matching catalog entry — no module
 * loading occurs and no async I/O is performed. Because every factory always
 * returns `null`, calling {@link ToolRegistry.resolveAll} on a registry
 * populated solely by this function will return an empty array (`[]`).
 *
 * Use this only for catalog or metadata use-cases: listing tool names,
 * descriptions, and sections without needing executable tools.
 * For tools that can actually execute, use {@link discoverCoreToolsAsync}
 * instead.
 *
 * @param registry - The registry to populate.
 * @param options - Discovery options (filters, paths). Set {@link DiscoveryOptions.onLoadWarning}
 *   to observe factory-load errors instead of having them silently discarded.
 * @see discoverCoreToolsAsync
 */
export function discoverCoreTools(
    registry: ToolRegistry,
    options?: DiscoveryOptions,
): void {
    const includeSet = options?.include ? expandGroups(options.include) : null;
    const excludeSet = options?.exclude ? expandGroups(options.exclude) : new Set<string>();

    // Register section labels so listBySection() returns human-readable names.
    for (const section of CORE_SECTIONS) {
        registry.registerSection(section);
    }

    for (const entry of CORE_TOOL_CATALOG) {
        // Apply include/exclude filters
        if (includeSet && !includeSet.has(entry.id)) continue;
        if (excludeSet.has(entry.id)) continue;

        const { factoryModule: _factoryModule, factoryName: _factoryName, ...meta } = entry;

        // Sync discovery only registers catalog metadata; factories always return null
        // because ESM dynamic import is async. Use discoverCoreToolsAsync() to get
        // executable tools.
        registry.registerFactory(() => null, meta);
    }
}

// =============================================================================
// Module cache (shared between sync stub and async source-fallback paths)
// =============================================================================

/**
 * Module cache populated by discoverFromSource for synchronous access inside
 * the bundled tool factories registered during async discovery.
 */
const moduleCache = new Map<string, Record<string, unknown>>();

/**
 * Async version of tool discovery that properly handles ESM dynamic imports.
 *
 * Loading strategy (in order of preference):
 * 1. **Bundled tools**: Loads from `dist/core-tools/` — pre-compiled standalone
 *    ESM bundles produced by the build step. Works in any Node 18+ environment.
 * 2. **Source fallback**: Loads from the openclaw submodule's `.ts` source files.
 *    Requires a TypeScript-capable runtime (vitest, tsx, ts-node).
 *
 * Tools whose modules cannot be loaded are still registered in the catalog
 * (metadata available) but their factories return `null` at call time.
 *
 * @param registry - The registry to populate.
 * @param options - Discovery options. Set {@link DiscoveryOptions.onLoadWarning}
 *   to observe factory-load errors instead of having them silently discarded.
 */
export async function discoverCoreToolsAsync(
    registry: ToolRegistry,
    options?: DiscoveryOptions,
): Promise<void> {
    const includeSet = options?.include ? expandGroups(options.include) : null;
    const excludeSet = options?.exclude
        ? expandGroups(options.exclude)
        : new Set<string>();

    // Register section labels so listBySection() returns human-readable names.
    for (const section of CORE_SECTIONS) {
        registry.registerSection(section);
    }

    // Try bundled tools first
    const manifest = resolveBundleManifest();

    if (manifest) {
        await discoverFromBundles(registry, manifest, includeSet, excludeSet, options);
    } else {
        await discoverFromSource(registry, includeSet, excludeSet, options);
    }
}

/**
 * Load tools from pre-built ESM bundles (preferred path).
 */
async function discoverFromBundles(
    registry: ToolRegistry,
    manifest: ResolvedManifest,
    includeSet: Set<string> | null,
    excludeSet: Set<string>,
    options?: DiscoveryOptions,
): Promise<void> {
    let loadedCount = 0;
    let failedCount = 0;

    for (const entry of CORE_TOOL_CATALOG) {
        if (includeSet && !includeSet.has(entry.id)) continue;
        if (excludeSet.has(entry.id)) continue;

        const { factoryModule, factoryName: catalogFactory, ...meta } = entry;
        const bundleInfo = manifest.entries[entry.id];

        if (!bundleInfo) {
            // Ghost registration: this tool has no entry in the bundle manifest.
            // The null-returning factory is still registered so the tool appears
            // in registry.list() / getCoreToolCatalog() for catalog enumeration,
            // but registry.resolveAll() will silently skip it (factory → null → []).
            registry.registerFactory(() => null, meta);
            failedCount++;
            continue;
        }

        // Pre-load the bundled module
        try {
            const bundleUrl = pathToFileURL(bundleInfo.bundlePath).href;
            const mod = (await import(bundleUrl)) as Record<string, unknown>;
            const factoryName = bundleInfo.factory;

            // Cache the module for synchronous access
            bundleModuleCache.set(entry.id, { mod, factoryName });
            loadedCount++;
        } catch (err) {
            failedCount++;
            options?.onLoadWarning?.(
                `Failed to load bundled tool "${entry.id}": ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        // Register a factory that uses the cached bundle
        registry.registerFactory(
            createBundledToolFactory(entry.id),
            meta,
        );
    }

    if (failedCount > 0) {
        options?.onLoadWarning?.(
            `${failedCount} of ${loadedCount + failedCount} bundled core tools could not be loaded.`,
        );
    }
}

/** Cache for pre-loaded bundle modules. */
const bundleModuleCache = new Map<
    string,
    { mod: Record<string, unknown>; factoryName: string }
>();

/**
 * Create a factory that loads a tool from the pre-built bundle cache.
 */
function createBundledToolFactory(
    toolId: string,
): (ctx: ToolContext) => Tool | Tool[] | null | undefined {
    return (ctx: ToolContext) => {
        const cached = bundleModuleCache.get(toolId);
        if (!cached) return null;

        const factory = cached.mod[cached.factoryName];
        if (typeof factory !== "function") return null;

        try {
            return factory(ctx) as Tool | Tool[] | null;
        } catch {
            return null;
        }
    };
}

/**
 * Load tools from openclaw TypeScript source (development fallback).
 */
async function discoverFromSource(
    registry: ToolRegistry,
    includeSet: Set<string> | null,
    excludeSet: Set<string>,
    options?: DiscoveryOptions,
): Promise<void> {
    const { root, exists: rootExists } = resolveOpenclawRoot(options?.openclawRoot);

    if (!rootExists) {
        options?.onLoadWarning?.(
            `No bundled tools found and openclaw source not found at "${root}". ` +
            `Core tool factories will be unavailable. ` +
            `Run "npm run build" to generate tool bundles, or provide ` +
            `DiscoveryOptions.openclawRoot pointing at the openclaw source tree.`,
        );
    }

    let loadedCount = 0;
    let failedCount = 0;

    for (const entry of CORE_TOOL_CATALOG) {
        if (includeSet && !includeSet.has(entry.id)) continue;
        if (excludeSet.has(entry.id)) continue;

        const { factoryModule, factoryName, ...meta } = entry;
        const modulePath = toolModulePath(root, factoryModule);

        // Pre-load the module. This only succeeds under a TypeScript runtime
        // (vitest/tsx/ts-node) that can dynamically import .ts files.
        try {
            const mod = (await import(modulePath)) as Record<string, unknown>;
            moduleCache.set(modulePath, mod);
            loadedCount++;
        } catch {
            failedCount++;
        }

        // Ghost registration: the factory is always registered regardless of
        // whether the module loaded above. If the import failed, moduleCache
        // will have no entry for this path and the factory always returns null,
        // so the tool appears in registry.list() / getCoreToolCatalog() but
        // registry.resolveAll() will silently skip it (factory → null → []).
        registry.registerFactory(
            (ctx: ToolContext) => {
                const mod = moduleCache.get(modulePath);
                if (!mod) return null;
                const factory = mod[factoryName];
                if (typeof factory !== "function") return null;
                try {
                    return factory(ctx) as Tool | Tool[] | null;
                } catch {
                    return null;
                }
            },
            meta,
        );
    }

    if (failedCount > 0 && rootExists) {
        options?.onLoadWarning?.(
            `${failedCount} of ${loadedCount + failedCount} core tool modules could not be loaded from "${root}". ` +
            `This is expected when running compiled JS without a TypeScript runtime. ` +
            `Run "npm run build" to generate pre-built tool bundles, or ` +
            `use tsx, ts-node, or vitest to load from source.`,
        );
    }
}
