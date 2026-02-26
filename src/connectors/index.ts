/**
 * Connector system — registry, discovery, and auth for LLM provider connectors.
 *
 * @example
 * ```ts
 * import { ConnectorRegistry, resolveAuth, discoverExtensions } from "clawtools/connectors";
 *
 * // Create a connector registry
 * const registry = new ConnectorRegistry();
 *
 * // List discovered openclaw extensions
 * const extensions = discoverExtensions();
 * for (const ext of extensions) {
 *   console.log(`${ext.id}: channels=${ext.channels.join(",")}`);
 * }
 *
 * // Resolve auth for a provider
 * const auth = resolveAuth("anthropic");
 * if (auth?.apiKey) {
 *   console.log(`Authenticated via ${auth.source}`);
 * }
 * ```
 *
 * @module
 */

export { ConnectorRegistry, resolveAuth, type AuthResolver } from "./registry.js";
export {
    discoverExtensions,
    discoverBuiltinConnectorsAsync,
    getExtensionPath,
    listChannelExtensions,
    listProviderExtensions,
    type ExtensionInfo,
} from "./discovery.js";
