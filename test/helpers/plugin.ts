/**
 * Helpers for loading test resource plugins.
 *
 * Points `loadPlugins` at `test/resources/plugins/` so tests don't need
 * to know the absolute path.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlugins } from "clawtools/plugins";
import type { LoadedPlugin } from "clawtools/plugins";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Absolute path to `test/resources/`. */
export const RESOURCES_DIR = resolve(__dirname, "../resources");

/** Absolute path to `test/resources/plugins/`. */
export const TEST_PLUGINS_DIR = resolve(RESOURCES_DIR, "plugins");

/**
 * Load all plugins found under `test/resources/plugins/`.
 */
export async function loadTestPlugins(opts?: {
    enabled?: string[];
    disabled?: string[];
}): Promise<LoadedPlugin[]> {
    return loadPlugins({
        searchPaths: [TEST_PLUGINS_DIR],
        enabledPlugins: opts?.enabled,
        disabledPlugins: opts?.disabled,
    });
}

/**
 * Load a single test resource plugin by its manifest ID.
 * Returns `undefined` if the plugin is not found or fails to load.
 */
export async function loadTestPlugin(id: string): Promise<LoadedPlugin | undefined> {
    const plugins = await loadPlugins({
        searchPaths: [TEST_PLUGINS_DIR],
        enabledPlugins: [id],
    });
    return plugins.find((p) => p.id === id);
}
