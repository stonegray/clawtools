/**
 * Connector Registry — central catalog for LLM provider connectors.
 *
 * Connectors are adapters for specific LLM API transport protocols. The registry
 * supports both direct connector registration and provider-config-based
 * resolution.
 *
 * @module
 */

import type {
    Api,
    Connector,
    ModelDescriptor,
    ProviderConfig,
    ResolvedAuth,
} from "../types.js";

// =============================================================================
// Connector Registry
// =============================================================================

/**
 * Central registry for LLM provider connectors.
 *
 * @example
 * ```ts
 * import { ConnectorRegistry } from "clawtools/connectors";
 *
 * const registry = new ConnectorRegistry();
 *
 * // Register a custom connector
 * registry.register({
 *   id: "my-llm",
 *   label: "My LLM",
 *   provider: "custom",
 *   api: "openai-completions",
 *   envVars: ["MY_LLM_API_KEY"],
 *   async *stream(model, context, options) {
 *     yield { type: "text_delta", delta: "Hello from my connector!" };
 *     yield { type: "done", stopReason: "stop" };
 *   },
 * });
 *
 * // Lookup by provider
 * const connector = registry.getByProvider("custom");
 * ```
 */
export class ConnectorRegistry {
    private connectors = new Map<string, Connector>();
    private providerIndex = new Map<string, string>();
    private apiIndex = new Map<string, string[]>();

    // ---------------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------------

    /**
     * Register a connector.
     *
     * The connector's `id` is the primary key — registering a second connector
     * with the same `id` silently replaces the first.
     *
     * **Provider index (last-write-wins):** `connector.provider` is also indexed
     * for {@link getByProvider} lookups. If two connectors share the same
     * `provider` string (e.g., both declare `provider: "openai"`), the second
     * call to `register()` wins: `getByProvider("openai")` will return the
     * most-recently-registered connector. The earlier connector remains
     * accessible via its `id` through {@link get}.
     *
     * @param connector - The connector to register.
     */
    register(connector: Connector): void {
        // Clean up stale index entries if overwriting an existing connector
        const existing = this.connectors.get(connector.id);
        if (existing) {
            // Remove stale providerIndex entry for the old provider name
            if (this.providerIndex.get(existing.provider) === connector.id) {
                this.providerIndex.delete(existing.provider);
            }
            // Remove stale apiIndex entry for the old api transport
            const oldApiList = this.apiIndex.get(existing.api);
            if (oldApiList) {
                const filtered = oldApiList.filter((x) => x !== connector.id);
                if (filtered.length > 0) {
                    this.apiIndex.set(existing.api, filtered);
                } else {
                    this.apiIndex.delete(existing.api);
                }
            }
        }

        this.connectors.set(connector.id, connector);
        this.providerIndex.set(connector.provider, connector.id);

        // Index by API transport
        const apiList = this.apiIndex.get(connector.api) ?? [];
        if (!apiList.includes(connector.id)) {
            apiList.push(connector.id);
        }
        this.apiIndex.set(connector.api, apiList);
    }

    // ---------------------------------------------------------------------------
    // Lookup
    // ---------------------------------------------------------------------------

    /**
     * Get a connector by its unique ID.
     */
    get(id: string): Connector | undefined {
        return this.connectors.get(id);
    }

    /**
     * Get a connector by provider name (e.g., "anthropic", "openai").
     */
    getByProvider(provider: string): Connector | undefined {
        const id = this.providerIndex.get(provider);
        return id ? this.connectors.get(id) : undefined;
    }

    /**
     * Get all connectors for a given API transport.
     */
    getByApi(api: Api): Connector[] {
        const ids = this.apiIndex.get(api) ?? [];
        return ids.map((id) => this.connectors.get(id)!).filter(Boolean);
    }

    /**
     * List all registered connectors.
     */
    list(): Connector[] {
        return Array.from(this.connectors.values());
    }

    /**
     * List all registered provider names.
     */
    listProviders(): string[] {
        return Array.from(this.providerIndex.keys());
    }

    /**
     * Check whether a connector with the given ID is registered.
     */
    has(id: string): boolean {
        return this.connectors.has(id);
    }

    /**
     * Remove a connector from the registry.
     */
    unregister(id: string): boolean {
        const connector = this.connectors.get(id);
        if (!connector) return false;

        this.connectors.delete(id);
        if (this.providerIndex.get(connector.provider) === id) {
            this.providerIndex.delete(connector.provider);
        }
        const apiList = this.apiIndex.get(connector.api);
        if (apiList) {
            const filtered = apiList.filter((x) => x !== id);
            if (filtered.length > 0) {
                this.apiIndex.set(connector.api, filtered);
            } else {
                this.apiIndex.delete(connector.api);
            }
        }

        return true;
    }

    /**
     * Remove all registered connectors.
     */
    clear(): void {
        this.connectors.clear();
        this.providerIndex.clear();
        this.apiIndex.clear();
    }

    /**
     * The number of registered connectors.
     */
    get size(): number {
        return this.connectors.size;
    }
}

// =============================================================================
// Auth Resolver
// =============================================================================

/** Callback for resolving authentication for a provider. */
export type AuthResolver = (provider: string) => ResolvedAuth | undefined;

/**
 * Resolves authentication credentials for connectors.
 *
 * Checks environment variables and explicit configuration to find
 * API keys for a given provider.
 *
 * @param provider - Provider name to resolve auth for.
 * @param envVars - Environment variable names to check.
 * @param explicitKey - An explicitly provided API key (highest priority).
 * @returns Resolved authentication, or undefined if no credentials found.
 */
export function resolveAuth(
    provider: string,
    envVars?: string[],
    explicitKey?: string,
): ResolvedAuth | undefined {
    // Explicit key takes highest priority
    if (explicitKey) {
        return { apiKey: explicitKey, mode: "api-key", source: "explicit" };
    }

    // Try environment variables
    if (envVars) {
        for (const envVar of envVars) {
            const value = process.env[envVar];
            if (value) {
                return {
                    apiKey: value,
                    mode: "api-key",
                    source: `env:${envVar}`,
                };
            }
        }
    }

    // Common convention: <PROVIDER>_API_KEY
    const conventionalVar = `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
    const conventionalValue = process.env[conventionalVar];
    if (conventionalValue) {
        return {
            apiKey: conventionalValue,
            mode: "api-key",
            source: `env:${conventionalVar}`,
        };
    }

    return undefined;
}
