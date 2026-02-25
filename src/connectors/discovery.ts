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
import type { PluginManifest } from "../plugins/loader.js";

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
                const entryPoint = resolveExtensionEntry(extDir);

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
// Internal
// =============================================================================

function resolveExtensionEntry(extDir: string): string | null {
    // Check package.json for openclaw.extensions
    const pkgPath = join(extDir, "package.json");
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            const extensions = pkg?.openclaw?.extensions;
            if (Array.isArray(extensions) && extensions.length > 0) {
                const resolved = join(extDir, extensions[0]);
                if (existsSync(resolved)) return resolved;
            }
        } catch {
            // Ignore
        }
    }

    const candidates = [
        "index.ts",
        "index.js",
        "src/index.ts",
        "src/index.js",
    ];

    for (const candidate of candidates) {
        const fullPath = join(extDir, candidate);
        if (existsSync(fullPath)) return fullPath;
    }

    return null;
}
