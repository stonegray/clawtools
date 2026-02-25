/**
 * Plugin system — loading OpenClaw-compatible plugins from the filesystem.
 *
 * @example
 * ```ts
 * import { loadPlugins } from "clawtools/plugins";
 *
 * const plugins = await loadPlugins({
 *   searchPaths: ["./my-plugins", "~/.openclaw/extensions"],
 *   logger: console,
 * });
 *
 * for (const plugin of plugins) {
 *   console.log(`${plugin.id}: ${plugin.tools.length} tools`);
 * }
 * ```
 *
 * @module
 */

export {
    loadPlugins,
    type LoadedPlugin,
    type PluginLoaderOptions,
    type PluginManifest,
} from "./loader.js";
