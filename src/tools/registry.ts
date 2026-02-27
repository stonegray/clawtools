/**
 * Tool Registry — central catalog for discovering and accessing tools.
 *
 * The registry supports two kinds of tool sources:
 *   1. **Direct tools** — fully instantiated Tool objects.
 *   2. **Tool factories** — functions that create tools on demand given a context.
 *
 * This design mirrors OpenClaw's plugin tool registration pattern while being
 * completely standalone. Tools from the openclaw submodule are loaded by the
 * discovery layer and registered here.
 *
 * @module
 */

import type {
    Tool,
    ToolContext,
    ToolFactory,
    ToolMeta,
    ToolProfile,
    ToolSection,
} from "../types.js";

// =============================================================================
// Registry Entry (internal)
// =============================================================================

interface ToolRegistryEntry {
    meta: ToolMeta;
    /** Either a direct tool or a factory. Factories are resolved lazily. */
    source: Tool | ToolFactory;
}

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Central registry for tool discovery and resolution.
 *
 * @example
 * ```ts
 * import { ToolRegistry } from "clawtools/tools";
 *
 * const registry = new ToolRegistry();
 *
 * // Register a tool directly
 * registry.register({
 *   name: "my_tool",
 *   description: "Does something useful",
 *   parameters: { type: "object", properties: { input: { type: "string" } } },
 *   execute: async (id, params) => ({
 *     content: [{ type: "text", text: `Got: ${params.input}` }],
 *   }),
 * });
 *
 * // Retrieve all tools for a given context
 * const tools = registry.resolveAll({ workspaceDir: "/my/project" });
 * ```
 */
export class ToolRegistry {
    private entries = new Map<string, ToolRegistryEntry>();
    private sections = new Map<string, string>(); // sectionId → label

    // ---------------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------------

    /**
     * Register a section label. Called by the discovery layer so that
     * `listBySection()` can return human-readable labels for core sections.
     *
     * @param section - The section to register.
     */
    registerSection(section: ToolSection): void {
        this.sections.set(section.id, section.label);
    }

    /**
     * Register a fully-instantiated tool.
     *
     * @param tool - The tool to register.
     * @param meta - Optional metadata overrides. If omitted, metadata is derived
     *               from the tool itself with sensible defaults.
     */
    register(tool: Tool, meta?: Partial<ToolMeta>): void {
        const id = meta?.id ?? tool.name;
        this.entries.set(id, {
            meta: {
                id,
                label: meta?.label ?? tool.label ?? tool.name,
                description: meta?.description ?? tool.description,
                sectionId: meta?.sectionId ?? "custom",
                profiles: meta?.profiles ?? ["full"],
                source: meta?.source ?? "core",
                pluginId: meta?.pluginId,
                includeInOpenClawGroup: meta?.includeInOpenClawGroup,
            },
            source: tool,
        });
    }

    /**
     * Register a tool factory that will be called when tools are resolved.
     *
     * Factories allow deferred tool creation — the factory receives a
     * {@link ToolContext} and may return one or more tools, or null to skip.
     *
     * @param factory - Function that produces tool(s) from a context.
     * @param meta - Metadata for catalog listing. `id` is required.
     */
    registerFactory(
        factory: ToolFactory,
        meta: ToolMeta,
    ): void {
        this.entries.set(meta.id, {
            meta,
            source: factory,
        });
    }

    // ---------------------------------------------------------------------------
    // Resolution
    // ---------------------------------------------------------------------------

    /**
     * Resolve all registered tools for a given context.
     *
     * Direct tools are returned as-is. Factories are invoked with the provided
     * context and their results are included.
     *
     * @param ctx - The context to pass to tool factories.
     * @param onError - Optional callback invoked when a factory throws. Receives
     *   the tool metadata and the thrown error. If omitted, errors are silently
     *   discarded (same behaviour as before).
     * @returns An array of resolved tools.
     */
    resolveAll(ctx?: ToolContext, onError?: (meta: ToolMeta, err: unknown) => void): Tool[] {
        const tools: Tool[] = [];
        for (const entry of this.entries.values()) {
            const resolved = this.resolveEntry(entry, ctx, onError);
            if (resolved) {
                tools.push(...resolved);
            }
        }
        return tools;
    }

    /**
     * Resolve tools filtered by a tool profile.
     *
     * @param profile - The profile to filter by ("minimal", "coding", "messaging", "full").
     * @param ctx - The context to pass to tool factories.
     * @param onError - Optional callback invoked when a factory throws.
     * @returns An array of resolved tools matching the profile.
     */
    resolveByProfile(profile: ToolProfile, ctx?: ToolContext, onError?: (meta: ToolMeta, err: unknown) => void): Tool[] {
        const tools: Tool[] = [];
        for (const entry of this.entries.values()) {
            if (
                profile === "full" ||
                entry.meta.profiles.includes(profile)
            ) {
                const resolved = this.resolveEntry(entry, ctx, onError);
                if (resolved) {
                    tools.push(...resolved);
                }
            }
        }
        return tools;
    }

    /**
     * Resolve a single tool by name.
     *
     * @param name - The tool's canonical name.
     * @param ctx - The context to pass to tool factories.
     * @param onError - Optional callback invoked when the factory throws.
     * @returns The resolved tool, or undefined if not found.
     */
    resolve(name: string, ctx?: ToolContext, onError?: (meta: ToolMeta, err: unknown) => void): Tool | undefined {
        const entry = this.entries.get(name);
        if (!entry) return undefined;
        const resolved = this.resolveEntry(entry, ctx, onError);
        return resolved?.[0];
    }

    // ---------------------------------------------------------------------------
    // Catalog Queries
    // ---------------------------------------------------------------------------

    /**
     * List metadata for all registered tools (without resolving factories).
     *
     * @returns An array of tool metadata entries.
     */
    list(): ToolMeta[] {
        return Array.from(this.entries.values(), (e) => e.meta);
    }

    /**
     * List metadata grouped by section.
     *
     * @returns An array of sections, each containing their tools' metadata.
     */
    listBySection(): Array<ToolSection & { tools: ToolMeta[] }> {
        const sectionMap = new Map<string, ToolMeta[]>();

        for (const entry of this.entries.values()) {
            const sId = entry.meta.sectionId;
            if (!sectionMap.has(sId)) {
                sectionMap.set(sId, []);
            }
            sectionMap.get(sId)!.push(entry.meta);
        }

        return Array.from(sectionMap.entries(), ([id, tools]) => ({
            id,
            label: this.sections.get(id) ?? id, // fall back to raw ID for unknown sections
            tools,
        }));
    }

    /**
     * Check whether a tool with the given name is registered.
     */
    has(name: string): boolean {
        return this.entries.has(name);
    }

    /**
     * Remove a tool from the registry.
     */
    unregister(name: string): boolean {
        return this.entries.delete(name);
    }

    /**
     * Remove all registered tools.
     */
    clear(): void {
        this.entries.clear();
    }

    /**
     * The number of registered tools.
     */
    get size(): number {
        return this.entries.size;
    }

    // ---------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------

    private resolveEntry(
        entry: ToolRegistryEntry,
        ctx?: ToolContext,
        onError?: (meta: ToolMeta, err: unknown) => void,
    ): Tool[] | null {
        const { source } = entry;

        // Direct tool
        if (typeof source !== "function") {
            return [source];
        }

        // Factory — invoke with the provided context.
        // Errors are reported via onError if provided; otherwise silently skipped
        // so the rest of the registry is unaffected.
        try {
            const result = source(ctx ?? {});
            if (!result) return null;
            return Array.isArray(result) ? result : [result];
        } catch (err) {
            onError?.(entry.meta, err);
            return null;
        }
    }
}
