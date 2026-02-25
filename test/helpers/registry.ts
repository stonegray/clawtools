/**
 * Registry factories for tests.
 *
 * Use `fixtureToolRegistry()` in unit tests (no openclaw deps).
 * Use `coreToolRegistry()` only in integration tests — it's slow.
 */

import { ToolRegistry } from "clawtools/tools";
import { ConnectorRegistry } from "clawtools/connectors";
import type { Connector } from "clawtools";
import { echoTool, fullTool, makeMockConnector } from "./fixtures.js";

// =============================================================================
// Tool registries
// =============================================================================

/** Empty registry — use when you want to register tools manually. */
export function emptyToolRegistry(): ToolRegistry {
    return new ToolRegistry();
}

/**
 * Registry pre-populated with fixture tools only (no openclaw module deps).
 * Fast — use in unit tests.
 */
export function fixtureToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    registry.register(fullTool);
    return registry;
}

/**
 * Registry with core openclaw tools loaded via `discoverCoreToolsAsync`.
 * Slow — only use in integration tests that exercise real tools.
 */
export async function coreToolRegistry(): Promise<ToolRegistry> {
    const { discoverCoreToolsAsync } = await import("clawtools/tools");
    const registry = new ToolRegistry();
    await discoverCoreToolsAsync(registry);
    return registry;
}

// =============================================================================
// Connector registries
// =============================================================================

/** Empty registry — use when you want to register connectors manually. */
export function emptyConnectorRegistry(): ConnectorRegistry {
    return new ConnectorRegistry();
}

/** Registry with a single mock connector registered. */
export function mockConnectorRegistry(overrides?: Partial<Connector>): ConnectorRegistry {
    const registry = new ConnectorRegistry();
    registry.register(makeMockConnector(overrides));
    return registry;
}
