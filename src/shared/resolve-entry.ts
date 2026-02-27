/**
 * Shared entry-point resolution for plugin directories and openclaw extensions.
 *
 * Both the plugin loader and the extension discovery module need to resolve
 * the JavaScript/TypeScript entry point for a directory-based plugin.
 * This module provides a single canonical implementation.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve the entry-point file for a plugin or extension directory.
 *
 * Resolution order:
 * 1. `package.json` → `openclaw.extensions[0]` (openclaw-specific manifest field)
 * 2. Conventional candidates: `index.ts`, `index.js`, `index.mts`, `index.mjs`,
 *    `src/index.ts`, `src/index.js`
 *
 * @param dir - Absolute path to the plugin/extension directory.
 * @returns Absolute path to the entry-point file, or `null` if none is found.
 */
export function resolvePluginEntry(dir: string): string | null {
    // 1. Check package.json for the openclaw.extensions field
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            const extensions = pkg?.openclaw?.extensions;
            if (Array.isArray(extensions) && extensions.length > 0) {
                const resolved = join(dir, extensions[0] as string);
                if (existsSync(resolved)) return resolved;
            }
        } catch {
            // Ignore parse errors — fall through to candidates
        }
    }

    // 2. Conventional candidates
    const candidates = [
        "index.ts",
        "index.js",
        "index.mts",
        "index.mjs",
        "src/index.ts",
        "src/index.js",
    ];

    for (const candidate of candidates) {
        const fullPath = join(dir, candidate);
        if (existsSync(fullPath)) return fullPath;
    }

    return null;
}
