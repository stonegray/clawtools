/**
 * Plugin loader — loads OpenClaw-compatible plugins from the filesystem.
 *
 * This is a lightweight reimplementation of OpenClaw's plugin loading pipeline.
 * It reads `openclaw.plugin.json` manifests, loads entry point modules, and
 * calls the plugin's register function to collect tools and connectors.
 *
 * Unlike OpenClaw's loader, this does NOT use jiti (TypeScript-aware imports).
 * It expects plugins to be pre-compiled to JavaScript, or uses Node's native
 * TypeScript support (--experimental-strip-types in Node 22+).
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
    Connector,
    PluginApi,
    PluginDefinition,
    Tool,
    ToolFactory,
} from "../types.js";

// =============================================================================
// Plugin Manifest
// =============================================================================

/** Parsed openclaw.plugin.json manifest. */
export interface PluginManifest {
    id: string;
    name?: string;
    description?: string;
    version?: string;
    kind?: "memory";
    configSchema?: Record<string, unknown>;
    channels?: string[];
    providers?: string[];
    skills?: string[];
}

// =============================================================================
// Loaded Plugin
// =============================================================================

/** A fully loaded plugin with its collected registrations. */
export interface LoadedPlugin {
    id: string;
    name: string;
    description?: string;
    version?: string;
    source: string;
    tools: Tool[];
    toolFactories: Array<{ factory: ToolFactory; names?: string[]; optional?: boolean }>;
    connectors: Connector[];
}

// =============================================================================
// Loader Options
// =============================================================================

export interface PluginLoaderOptions {
    /**
     * Directories to scan for plugins.
     * Each directory should contain plugin subdirectories with `openclaw.plugin.json`.
     */
    searchPaths: string[];

    /**
     * Explicit plugin IDs to enable. If undefined, all discovered plugins are enabled.
     */
    enabledPlugins?: string[];

    /**
     * Plugin IDs to skip.
     */
    disabledPlugins?: string[];

    /**
     * Logger for diagnostic messages.
     */
    logger?: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error: (msg: string) => void;
    };
}

// =============================================================================
// Plugin Loader
// =============================================================================

/**
 * Discover and load plugins from the filesystem.
 *
 * Scans the provided search paths for directories containing
 * `openclaw.plugin.json` manifests, loads their entry points, and
 * calls the register function to collect tools and connectors.
 *
 * @param options - Loader configuration.
 * @returns Array of loaded plugins.
 */
export async function loadPlugins(
    options: PluginLoaderOptions,
): Promise<LoadedPlugin[]> {
    const { searchPaths, enabledPlugins, disabledPlugins, logger } = options;
    const disabledSet = new Set(disabledPlugins ?? []);
    const enabledSet = enabledPlugins ? new Set(enabledPlugins) : null;
    const loaded: LoadedPlugin[] = [];

    for (const searchPath of searchPaths) {
        const absPath = resolve(searchPath);
        if (!existsSync(absPath)) continue;

        const candidates = discoverPluginCandidates(absPath);

        for (const candidate of candidates) {
            try {
                const manifest = readManifest(candidate);
                if (!manifest) continue;

                // Check enable/disable
                if (disabledSet.has(manifest.id)) {
                    logger?.info(`Plugin "${manifest.id}" is disabled, skipping.`);
                    continue;
                }
                if (enabledSet && !enabledSet.has(manifest.id)) {
                    continue;
                }

                const plugin = await loadSinglePlugin(candidate, manifest);
                if (plugin) {
                    loaded.push(plugin);
                    logger?.info(`Loaded plugin: ${plugin.id} (${plugin.tools.length} tools, ${plugin.connectors.length} connectors)`);
                }
            } catch (err) {
                logger?.error(
                    `Failed to load plugin from ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
    }

    return loaded;
}

// =============================================================================
// Internal: Discovery
// =============================================================================

function discoverPluginCandidates(searchDir: string): string[] {
    const candidates: string[] = [];

    try {
        const entries = readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const pluginDir = join(searchDir, entry.name);
            const manifestPath = join(pluginDir, "openclaw.plugin.json");
            if (existsSync(manifestPath)) {
                candidates.push(pluginDir);
            }
        }
    } catch {
        // Search path doesn't exist or isn't readable
    }

    return candidates;
}

function readManifest(pluginDir: string): PluginManifest | null {
    const manifestPath = join(pluginDir, "openclaw.plugin.json");
    try {
        const raw = readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as PluginManifest;
        if (!manifest.id) return null;
        return manifest;
    } catch {
        return null;
    }
}

// =============================================================================
// Internal: Loading
// =============================================================================

async function loadSinglePlugin(
    pluginDir: string,
    manifest: PluginManifest,
): Promise<LoadedPlugin | null> {
    // Resolve entry point
    const entryPath = resolveEntryPoint(pluginDir);
    if (!entryPath) return null;

    // Load module
    const mod = await import(entryPath);

    // Resolve the export
    const resolved = mod.default ?? mod;
    const registerFn = resolveRegisterFunction(resolved);
    if (!registerFn) return null;

    // Build registration API and collect registrations
    const tools: Tool[] = [];
    const toolFactories: Array<{
        factory: ToolFactory;
        names?: string[];
        optional?: boolean;
    }> = [];
    const connectors: Connector[] = [];

    const api: PluginApi = {
        id: manifest.id,
        name: manifest.name ?? manifest.id,

        // =========================================================================
        // Active registrations — collected and returned to the caller
        // =========================================================================

        registerTool(toolOrFactory, opts) {
            if (typeof toolOrFactory === "function") {
                toolFactories.push({
                    factory: toolOrFactory as ToolFactory,
                    names: opts?.names ?? (opts?.name ? [opts.name] : undefined),
                    optional: opts?.optional,
                });
            } else {
                tools.push(toolOrFactory as Tool);
            }
        },

        registerConnector(connector) {
            connectors.push(connector);
        },

        // =========================================================================
        // No-op stubs — accept calls silently for OpenClaw compatibility
        // =========================================================================

        registerHook() { /* no-op */ },
        registerHttpHandler() { /* no-op */ },
        registerHttpRoute() { /* no-op */ },
        registerChannel() { /* no-op */ },
        registerGatewayMethod() { /* no-op */ },
        registerCli() { /* no-op */ },
        registerService() { /* no-op */ },
        registerProvider() { /* no-op */ },
        registerCommand() { /* no-op */ },
        resolvePath(input: string) { return input; },
        on() { /* no-op */ },
    };

    await registerFn(api);

    return {
        id: manifest.id,
        name: manifest.name ?? manifest.id,
        description: manifest.description,
        version: manifest.version,
        source: entryPath,
        tools,
        toolFactories,
        connectors,
    };
}

function resolveEntryPoint(pluginDir: string): string | null {
    // Check package.json for openclaw.extensions field
    const pkgPath = join(pluginDir, "package.json");
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            const extensions = pkg?.openclaw?.extensions;
            if (Array.isArray(extensions) && extensions.length > 0) {
                const resolved = join(pluginDir, extensions[0]);
                if (existsSync(resolved)) return resolved;
            }
        } catch {
            // Ignore parse errors
        }
    }

    // Try conventional entry points
    const candidates = [
        "index.ts",
        "index.js",
        "src/index.ts",
        "src/index.js",
        "index.mts",
        "index.mjs",
    ];

    for (const candidate of candidates) {
        const fullPath = join(pluginDir, candidate);
        if (existsSync(fullPath)) return fullPath;
    }

    return null;
}

function resolveRegisterFunction(
    mod: unknown,
): ((api: PluginApi) => void | Promise<void>) | null {
    if (typeof mod === "function") {
        return mod as (api: PluginApi) => void | Promise<void>;
    }

    if (mod && typeof mod === "object") {
        const obj = mod as Record<string, unknown>;
        if (typeof obj.register === "function") {
            return obj.register as (api: PluginApi) => void | Promise<void>;
        }
        if (typeof obj.activate === "function") {
            return obj.activate as (api: PluginApi) => void | Promise<void>;
        }
    }

    return null;
}
