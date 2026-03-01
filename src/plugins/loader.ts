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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
    Connector,
    PluginApi,
    Tool,
    ToolFactory,
} from "../types.js";
import { resolvePluginEntry } from "../shared/resolve-entry.js";

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
    const entryPath = resolvePluginEntry(pluginDir);
    if (!entryPath) return null;

    // Load module
    const mod = await import(entryPath);

    // Prefer the default export; fall back to the module namespace so that
    // `export function register(api) {}` (named export, no default) also works.
    // See resolveRegisterFunction for the full resolution order.
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
                    factory: toolOrFactory,
                    names: opts?.names ?? (opts?.name ? [opts.name] : undefined),
                    optional: opts?.optional,
                });
            } else {
                tools.push(toolOrFactory);
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

/**
 * Resolve the register/activate function from a loaded plugin module.
 *
 * Resolution order (applied to `mod.default ?? mod`):
 * 1. If the resolved value **is a function** — used directly as the register fn.
 * 2. If the resolved value is an **object with a `register` method** — that
 *    method is called.
 * 3. If the resolved value is an **object with an `activate` method** — that
 *    method is called.
 *
 * Because the default export is checked before named exports, a `default`
 * export always takes precedence. A bare named `plugin` export
 * (e.g. `export const plugin = { register: fn }`) is **not** recognised —
 * plugins must use one of the patterns above.
 */
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
