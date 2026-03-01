/**
 * Tool system — registry, discovery, and helpers for OpenClaw tools.
 *
 * @example
 * ```ts
 * import { ToolRegistry, discoverCoreTools, jsonResult } from "clawtools/tools";
 *
 * // Create a registry and populate with core tools
 * const registry = new ToolRegistry();
 * discoverCoreTools(registry);
 *
 * // List available tools
 * for (const meta of registry.list()) {
 *   console.log(`${meta.id}: ${meta.description}`);
 * }
 *
 * // Register a custom tool
 * registry.register({
 *   name: "greet",
 *   description: "Say hello",
 *   parameters: { type: "object", properties: { name: { type: "string" } } },
 *   execute: async (id, params) => jsonResult({ greeting: `Hello, ${params.name}!` }),
 * });
 *
 * // Resolve all tools for a context
 * const tools = registry.resolveAll({ workspaceDir: "/my/project" });
 * ```
 *
 * @module
 */

export { ToolRegistry } from "./registry.js";
export {
    discoverCoreTools,
    discoverCoreToolsAsync,
    getCoreToolCatalog,
    getCoreSections,
    type DiscoveryOptions,
} from "./discovery.js";
export {
    jsonResult,
    textResult,
    errorResult,
    imageResult,
} from "./helpers.js";
export {
    readStringParam,
    readNumberParam,
    readBooleanParam,
    readStringArrayParam,
    assertRequiredParams,
    ToolInputError,
    ToolAuthorizationError,
    type StringParamOptions,
    type NumberParamOptions,
    type BooleanParamOptions,
} from "./params.js";
export {
    extractToolSchema,
    extractToolSchemas,
    normalizeSchema,
    cleanSchemaForGemini,
} from "./schema.js";
export { createNodeBridge } from "./node-bridge.js";
