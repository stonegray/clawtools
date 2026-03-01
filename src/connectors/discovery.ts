/**
 * OpenClaw Extension Discovery — scans the openclaw submodule's extensions/
 * directory for channel plugins and provider connectors.
 *
 * Extensions in OpenClaw are full plugin packages that provide channels
 * (Telegram, Discord, Slack, etc.) and providers (Copilot proxy, etc.).
 * This module discovers them and returns their metadata without loading them.
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Connector } from "../types.js";
import type { PluginManifest } from "../plugins/loader.js";
import { resolvePluginEntry } from "../shared/resolve-entry.js";

// =============================================================================
// Extension Metadata
// =============================================================================

/** Metadata about a discovered openclaw extension. */
export interface ExtensionInfo {
    /** Plugin ID from the manifest. */
    id: string;
    /** Human-readable name. */
    name: string;
    /** Description from the manifest. */
    description?: string;
    /** Channel IDs provided by this extension. */
    channels: string[];
    /** Provider IDs provided by this extension. */
    providers: string[];
    /** Absolute path to the extension directory. */
    path: string;
    /** Absolute path to the entry point file. */
    entryPoint?: string;
}

// =============================================================================
// Default path
// =============================================================================

const OPENCLAW_EXTENSIONS = resolve(
    new URL(".", import.meta.url).pathname,
    "../../openclaw/extensions",
);

// =============================================================================
// Discovery
// =============================================================================

/**
 * Discover all extensions in the openclaw submodule.
 *
 * Scans `openclaw/extensions/` for directories with `openclaw.plugin.json`
 * manifests and returns their metadata.
 *
 * @param extensionsDir - Override the extensions directory path.
 * @returns Array of discovered extension metadata.
 */
export function discoverExtensions(
    extensionsDir?: string,
): ExtensionInfo[] {
    const dir = extensionsDir ?? OPENCLAW_EXTENSIONS;
    if (!existsSync(dir)) return [];

    const results: ExtensionInfo[] = [];

    try {
        const entries = readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const extDir = join(dir, entry.name);
            const manifestPath = join(extDir, "openclaw.plugin.json");

            if (!existsSync(manifestPath)) continue;

            try {
                const raw = readFileSync(manifestPath, "utf-8");
                const manifest = JSON.parse(raw) as PluginManifest;

                if (!manifest.id) continue;

                // Try to find the entry point
                const entryPoint = resolvePluginEntry(extDir);

                results.push({
                    id: manifest.id,
                    name: manifest.name ?? entry.name,
                    description: manifest.description,
                    channels: manifest.channels ?? [],
                    providers: manifest.providers ?? [],
                    path: extDir,
                    entryPoint: entryPoint ?? undefined,
                });
            } catch {
                // Skip extensions with invalid manifests
            }
        }
    } catch {
        // Extensions directory not readable
    }

    return results;
}

/**
 * Get the path to a specific extension by its plugin ID.
 *
 * @param extensionId - The plugin ID to look for.
 * @param extensionsDir - Override the extensions directory path.
 * @returns The absolute path to the extension directory, or undefined.
 */
export function getExtensionPath(
    extensionId: string,
    extensionsDir?: string,
): string | undefined {
    const extensions = discoverExtensions(extensionsDir);
    return extensions.find((ext) => ext.id === extensionId)?.path;
}

/**
 * List all available channel extension IDs.
 */
export function listChannelExtensions(
    extensionsDir?: string,
): string[] {
    return discoverExtensions(extensionsDir)
        .filter((ext) => ext.channels.length > 0)
        .map((ext) => ext.id);
}

/**
 * List all available provider extension IDs.
 */
export function listProviderExtensions(
    extensionsDir?: string,
): string[] {
    return discoverExtensions(extensionsDir)
        .filter((ext) => ext.providers.length > 0)
        .map((ext) => ext.id);
}

// =============================================================================
// Built-in connector discovery
// =============================================================================

/**
 * Resolve the path to the pre-built connector bundle.
 *
 * At runtime this file lives at `dist/connectors/discovery.js`, so the
 * connector bundle is at `../core-connectors/builtins.js`.
 */
function resolveConnectorBundle(): string {
    // From dist/connectors/discovery.js → ../core-connectors/builtins.js
    const distDir = resolve(new URL(".", import.meta.url).pathname, "..");
    return join(distDir, "core-connectors", "builtins.js");
}

// Module-level cache — populated on first call to discoverBuiltinConnectors().
let _builtinConnectorsCache: Promise<Connector[]> | undefined;

/**
 * Discover and return all built-in LLM connectors.
 *
 * Built-in connectors are backed by `@mariozechner/pi-ai` provider
 * implementations, bundled at build time into `dist/core-connectors/builtins.js`.
 * One connector is returned per pi-ai provider (anthropic, openai, google, …).
 *
 * ## Loading strategy
 *
 * 1. **Bundled** (preferred): Loads `dist/core-connectors/builtins.js` — a
 *    self-contained ESM bundle compiled from `src/connectors/pi-ai-bridge.ts`.
 *    Works in any Node 18+ environment; requires `npm run build` to have run.
 * 2. **Source fallback** (development / vitest): If the bundle is absent, falls
 *    back to importing `src/connectors/pi-ai-bridge.ts` directly. Requires a
 *    TypeScript-capable runtime (vitest, tsx, ts-node).
 *
 * ## Caching
 *
 * The result is memoised after the first successful call. Calling this
 * function multiple times is safe and cheap — subsequent calls return the
 * same array instance without repeating the dynamic import or filesystem
 * check. The cache is module-level, so it persists for the lifetime of the
 * process.
 *
 * @returns Array of fully executable `Connector` objects, or an empty array if
 *          the connector bundle is not available.
 */
export function discoverBuiltinConnectors(): Promise<Connector[]> {
    if (_builtinConnectorsCache !== undefined) {
        return _builtinConnectorsCache;
    }
    _builtinConnectorsCache = _loadBuiltinConnectors();
    return _builtinConnectorsCache;
}

/** Internal implementation — call discoverBuiltinConnectors() externally. */
async function _loadBuiltinConnectors(): Promise<Connector[]> {
    // Try bundled output first
    const bundlePath = resolveConnectorBundle();
    if (existsSync(bundlePath)) {
        try {
            const { pathToFileURL } = await import("node:url");
            const mod = await import(pathToFileURL(bundlePath).href) as {
                getBuiltinConnectors?: () => Connector[];
            };
            if (typeof mod.getBuiltinConnectors === "function") {
                return mod.getBuiltinConnectors();
            }
        } catch {
            // Bundle failed to load — fall through to source fallback
        }
    }

    // Source fallback: import from the TypeScript source (dev / vitest)
    try {
        // Resolve relative to this *source* file (src/connectors/discovery.ts)
        // The import below is a string literal so bundlers/tsc don't follow it.
        const srcPath = new URL("./pi-ai-bridge.js", import.meta.url).href;
        const mod = await import(srcPath) as {
            getBuiltinConnectors?: () => Connector[];
        };
        if (typeof mod.getBuiltinConnectors === "function") {
            return mod.getBuiltinConnectors();
        }
    } catch {
        // Source not available — return empty
    }

    return [];
}

/**
 * @deprecated Use {@link discoverBuiltinConnectors} instead.
 * Renamed to drop the `Async` suffix per the async-by-default naming convention.
 */
export async function discoverBuiltinConnectorsAsync(): Promise<Connector[]> {
    return discoverBuiltinConnectors();
}
