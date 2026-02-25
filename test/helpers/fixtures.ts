/**
 * Static fixture data for tests.
 *
 * Import directly — no side effects, no file I/O.
 */

import type { Connector, ModelDescriptor, Tool, ToolContext } from "clawtools";

// =============================================================================
// Tool fixtures
// =============================================================================

/** Minimal working tool. Echoes its `message` param as text. */
export const echoTool: Tool = {
    name: "echo",
    label: "Echo",
    description: "Echoes the input back",
    parameters: {
        type: "object",
        properties: {
            message: { type: "string", description: "Message to echo" },
        },
        required: ["message"],
    },
    execute: async (_id, params) => ({
        content: [{ type: "text" as const, text: String(params.message ?? "") }],
        details: { echo: params.message },
    }),
};

/** Tool with all optional parameter types, for schema/registry tests. */
export const fullTool: Tool = {
    name: "full_tool",
    label: "Full Tool",
    description: "A tool exercising all field types",
    parameters: {
        type: "object",
        properties: {
            text: { type: "string" },
            count: { type: "number" },
            flag: { type: "boolean" },
            items: { type: "array", items: { type: "string" } },
        },
        required: ["text"],
    },
    ownerOnly: false,
    execute: async (_id, params) => ({
        content: [{ type: "text" as const, text: JSON.stringify(params) }],
    }),
};

/** Tool that always throws — for error-path tests. */
export const throwingTool: Tool = {
    name: "throwing_tool",
    description: "Always throws an error",
    parameters: { type: "object", properties: {} },
    execute: async () => {
        throw new Error("Tool intentionally threw");
    },
};

/** Tool factory that captures the context it was created with. */
export function contextAwareToolFactory(ctx: ToolContext): Tool {
    return {
        name: "context_tool",
        description: "Reports its creation context",
        parameters: { type: "object", properties: {} },
        execute: async () => ({
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify({ workspaceDir: ctx.workspaceDir, agentId: ctx.agentId }),
                },
            ],
        }),
    };
}

// =============================================================================
// Context fixtures
// =============================================================================

/** Base ToolContext for tests. */
export const baseContext: ToolContext = {
    workspaceDir: "/tmp/test-workspace",
    agentDir: "/tmp/test-agent",
    agentId: "test-agent",
    sessionKey: "test-session-key",
    messageChannel: "test",
    sandboxed: false,
};

// =============================================================================
// Connector / model fixtures
// =============================================================================

/** Build a ModelDescriptor pointing at a given mock server URL. */
export function mockModel(baseUrl: string): ModelDescriptor {
    return {
        id: "gpt-4o-mini",
        api: "openai-completions",
        provider: "mock",
        baseUrl,
        contextWindow: 8192,
        maxTokens: 1024,
    };
}

/**
 * Build a minimal Connector that yields a fixed two-event stream.
 * Override any field with `overrides`.
 */
export function makeMockConnector(overrides?: Partial<Connector>): Connector {
    return {
        id: "mock-connector",
        label: "Mock Connector",
        provider: "mock",
        api: "openai-completions",
        envVars: ["MOCK_API_KEY"],
        models: [],
        async *stream() {
            yield { type: "text_delta" as const, delta: "hello" };
            yield { type: "done" as const, stopReason: "stop" };
        },
        ...overrides,
    };
}
