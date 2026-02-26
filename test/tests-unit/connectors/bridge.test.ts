/**
 * Unit tests: pi-ai bridge — connector shape and event mapping.
 *
 * `adaptEvents`, `toDescriptor`, `toModel`, and `toContext` are private, so
 * they are exercised through the public `getBuiltinConnectors()` factory.
 *
 * @mariozechner/pi-ai is fully mocked so no real network calls are made.
 * A single `mockStream` spy is wired into the mock factory via `vi.hoisted`
 * so it can be configured inside individual tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted spy — must exist before vi.mock() runs
// ---------------------------------------------------------------------------

const { mockStream } = vi.hoisted(() => ({
    mockStream: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @mariozechner/pi-ai
// ---------------------------------------------------------------------------

vi.mock("@mariozechner/pi-ai", () => {
    const MOCK_MODEL = {
        id: "mock-model",
        name: "Mock Model",
        api: "openai-completions",
        provider: "mock-provider",
        baseUrl: "https://api.mock.example.com",
        reasoning: false,
        input: ["text"],
        cost: { input: 1.0, output: 2.0, cacheRead: 0.1, cacheWrite: 0.2 },
        contextWindow: 128_000,
        maxTokens: 8_192,
        headers: undefined,
        compat: { tools: true },
    };
    return {
        getProviders: () => ["mock-provider"],
        getModels: () => [MOCK_MODEL],
        stream: mockStream,
    };
});

// ---------------------------------------------------------------------------
// Imports (after vi.mock so they receive the mocked module)
// ---------------------------------------------------------------------------

import { getBuiltinConnectors } from "../../../src/connectors/pi-ai-bridge.js";
import type { ModelDescriptor, StreamContext, StreamEvent } from "clawtools";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Drain an async iterable into an array. */
async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const arr: T[] = [];
    for await (const item of iter) arr.push(item);
    return arr;
}

/** Return an async generator that yields the given values. */
async function* makeEvents<T>(events: T[]): AsyncIterable<T> {
    for (const ev of events) yield ev;
}

/** Minimal model descriptor that exists in the mock catalog. */
const BASE_MODEL: ModelDescriptor = {
    id: "mock-model",
    api: "openai-completions",
    provider: "mock-provider",
    baseUrl: "https://api.mock.example.com",
    contextWindow: 128_000,
    maxTokens: 8_192,
};

/** Minimal stream context. */
const BASE_CTX: StreamContext = {
    messages: [{ role: "user", content: "hello" }],
};

// ---------------------------------------------------------------------------
// getBuiltinConnectors — shape tests (no streaming needed)
// ---------------------------------------------------------------------------

describe("getBuiltinConnectors", () => {
    it("returns an array", () => {
        expect(Array.isArray(getBuiltinConnectors())).toBe(true);
    });

    it("returns at least one connector", () => {
        expect(getBuiltinConnectors().length).toBeGreaterThan(0);
    });

    it("each connector has id, label, provider, api, and stream function", () => {
        for (const c of getBuiltinConnectors()) {
            expect(typeof c.id).toBe("string");
            expect(typeof c.label).toBe("string");
            expect(typeof c.provider).toBe("string");
            expect(typeof c.api).toBe("string");
            expect(typeof c.stream).toBe("function");
        }
    });

    it("connector id follows the builtin/<provider> pattern", () => {
        for (const c of getBuiltinConnectors()) {
            expect(c.id).toMatch(/^builtin\//);
            expect(c.id).toBe(`builtin/${c.provider}`);
        }
    });

    it("connector label is title-cased from the provider name", () => {
        const [c] = getBuiltinConnectors();
        // "mock-provider" → "Mock Provider"
        expect(c.label).toBe("Mock Provider");
    });

    it("models array is non-empty", () => {
        const [c] = getBuiltinConnectors();
        expect(Array.isArray(c.models)).toBe(true);
        expect(c.models!.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// toDescriptor — via connector.models
// ---------------------------------------------------------------------------

describe("toDescriptor (reflected through connector.models)", () => {
    const model = () => getBuiltinConnectors()[0].models![0];

    it("preserves id", () => expect(model().id).toBe("mock-model"));
    it("preserves api", () => expect(model().api).toBe("openai-completions"));
    it("preserves provider", () => expect(model().provider).toBe("mock-provider"));
    it("preserves baseUrl", () => expect(model().baseUrl).toBe("https://api.mock.example.com"));
    it("preserves reasoning flag", () => expect(model().reasoning).toBe(false));
    it("preserves input modalities", () => expect(model().input).toEqual(["text"]));
    it("preserves contextWindow", () => expect(model().contextWindow).toBe(128_000));
    it("preserves maxTokens", () => expect(model().maxTokens).toBe(8_192));
    it("preserves cost structure", () => {
        const cost = model().cost!;
        expect(cost.input).toBe(1.0);
        expect(cost.output).toBe(2.0);
        expect(cost.cacheRead).toBe(0.1);
        expect(cost.cacheWrite).toBe(0.2);
    });
    it("preserves compat flags", () => expect(model().compat).toEqual({ tools: true }));
});

// ---------------------------------------------------------------------------
// adaptEvents — via connector.stream with a mocked piStream
// ---------------------------------------------------------------------------

describe("adaptEvents (via connector.stream)", () => {
    let connector: ReturnType<typeof getBuiltinConnectors>[0];

    beforeEach(() => {
        connector = getBuiltinConnectors()[0];
        mockStream.mockClear();
    });

    /** Call stream with a list of synthetic pi-ai events and collect the output. */
    async function stream(piEvents: unknown[]): Promise<StreamEvent[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockStream.mockReturnValueOnce(makeEvents(piEvents) as any);
        return drain(connector.stream(BASE_MODEL, BASE_CTX, {}));
    }

    it("maps 'start' → { type: 'start' }", async () => {
        expect(await stream([{ type: "start" }])).toContainEqual({ type: "start" });
    });

    it("maps 'text_delta' → { type: 'text_delta', delta }", async () => {
        expect(await stream([{ type: "text_delta", delta: "hello" }])).toContainEqual({
            type: "text_delta",
            delta: "hello",
        });
    });

    it("maps 'text_end' → { type: 'text_end', content }", async () => {
        expect(await stream([{ type: "text_end", content: "full text" }])).toContainEqual({
            type: "text_end",
            content: "full text",
        });
    });

    it("maps 'thinking_delta' → { type: 'thinking_delta', delta }", async () => {
        expect(await stream([{ type: "thinking_delta", delta: "hmm..." }])).toContainEqual({
            type: "thinking_delta",
            delta: "hmm...",
        });
    });

    it("maps 'thinking_end' → { type: 'thinking_end', content }", async () => {
        expect(await stream([{ type: "thinking_end", content: "I think so" }])).toContainEqual({
            type: "thinking_end",
            content: "I think so",
        });
    });

    it("maps 'toolcall_start' → { type: 'toolcall_start' }", async () => {
        expect(await stream([{ type: "toolcall_start" }])).toContainEqual({ type: "toolcall_start" });
    });

    it("maps 'toolcall_delta' → { type: 'toolcall_delta', delta }", async () => {
        expect(await stream([{ type: "toolcall_delta", delta: '{"k":' }])).toContainEqual({
            type: "toolcall_delta",
            delta: '{"k":',
        });
    });

    it("maps 'toolcall_end' → structured toolCall object", async () => {
        const result = await stream([
            {
                type: "toolcall_end",
                toolCall: { id: "call_xyz", name: "my_tool", arguments: { key: "value" } },
            },
        ]);
        expect(result).toContainEqual({
            type: "toolcall_end",
            toolCall: { id: "call_xyz", name: "my_tool", arguments: { key: "value" } },
        });
    });

    it("maps 'done' → done event with stopReason and usage", async () => {
        const result = await stream([
            {
                type: "done",
                reason: "stop",
                message: { usage: { input: 10, output: 5 } },
            },
        ]);
        expect(result).toContainEqual({
            type: "done",
            stopReason: "stop",
            usage: { inputTokens: 10, outputTokens: 5 },
        });
    });

    it("maps 'error' → error event using errorMessage string", async () => {
        const result = await stream([
            { type: "error", reason: "rate_limit", error: { errorMessage: "rate limited" } },
        ]);
        expect(result).toContainEqual({ type: "error", error: "rate limited" });
    });

    it("error falls back to reason string when errorMessage is absent", async () => {
        const result = await stream([{ type: "error", reason: "timeout", error: {} }]);
        const errEvent = result.find((e) => e.type === "error") as { type: "error"; error: string } | undefined;
        expect(errEvent).toBeDefined();
        expect(errEvent!.error).toMatch(/timeout/i);
    });

    it("suppresses 'text_start' (no-content marker)", async () => {
        expect(await stream([{ type: "text_start" }])).toHaveLength(0);
    });

    it("suppresses 'thinking_start' (no-content marker)", async () => {
        expect(await stream([{ type: "thinking_start" }])).toHaveLength(0);
    });

    it("suppresses unknown future event types (default case)", async () => {
        expect(await stream([{ type: "some_future_event_type_xyz" }])).toHaveLength(0);
    });

    it("preserves ordering across a mixed sequence", async () => {
        const result = await stream([
            { type: "start" },
            { type: "text_delta", delta: "hi" },
            { type: "text_end", content: "hi" },
            { type: "done", reason: "stop", message: { usage: { input: 1, output: 1 } } },
        ]);
        const types = result.map((e) => e.type);
        expect(types).toEqual(["start", "text_delta", "text_end", "done"]);
    });

    it("an empty pi-ai stream produces an empty clawtools stream", async () => {
        expect(await stream([])).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// toContext — inspect the context argument passed to piStream
// ---------------------------------------------------------------------------

describe("toContext (via piStream call inspection)", () => {
    let connector: ReturnType<typeof getBuiltinConnectors>[0];

    beforeEach(() => {
        connector = getBuiltinConnectors()[0];
        mockStream.mockClear();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockStream.mockReturnValue(makeEvents([]) as any);
    });

    /** Invoke the connector stream and return the context arg passed to piStream. */
    async function getCalledCtx(ctx: StreamContext): Promise<Record<string, unknown>> {
        await drain(connector.stream(BASE_MODEL, ctx, {}));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (mockStream.mock.calls[0] as any)[1] as Record<string, unknown>;
    }

    it("passes systemPrompt through unchanged", async () => {
        const ctx = await getCalledCtx({ systemPrompt: "You are helpful.", messages: [] });
        expect(ctx.systemPrompt).toBe("You are helpful.");
    });

    it("passes messages array unchanged", async () => {
        const messages = [{ role: "user", content: "hi" }];
        const ctx = await getCalledCtx({ messages });
        expect(ctx.messages).toEqual(messages);
    });

    it("renames input_schema → parameters in tool definitions", async () => {
        const ctx = await getCalledCtx({
            messages: [],
            tools: [{ name: "t", description: "does stuff", input_schema: { type: "object" } }],
        });
        const tools = ctx.tools as Array<Record<string, unknown>>;
        expect(tools[0]).toHaveProperty("parameters", { type: "object" });
        expect(tools[0]).not.toHaveProperty("input_schema");
    });

    it("preserves tool name and description through the rename", async () => {
        const ctx = await getCalledCtx({
            messages: [],
            tools: [{ name: "my_tool", description: "my desc", input_schema: {} }],
        });
        const tools = ctx.tools as Array<Record<string, unknown>>;
        expect(tools[0].name).toBe("my_tool");
        expect(tools[0].description).toBe("my desc");
    });

    it("omits tools key when no tools are provided", async () => {
        const ctx = await getCalledCtx({ messages: [] });
        expect(ctx.tools).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// toModel fallback — when model ID is not in the catalog map
// ---------------------------------------------------------------------------

describe("toModel fallback", () => {
    let connector: ReturnType<typeof getBuiltinConnectors>[0];

    beforeEach(() => {
        connector = getBuiltinConnectors()[0];
        mockStream.mockClear();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockStream.mockReturnValue(makeEvents([]) as any);
    });

    it("reconstructs model from descriptor when ID is not in the catalog", async () => {
        const unknown: ModelDescriptor = {
            id: "custom-model-not-in-catalog",
            api: "anthropic-messages",
            provider: "mock-provider",
            baseUrl: "https://custom.example.com",
            contextWindow: 50_000,
            maxTokens: 2_048,
        };
        await drain(connector.stream(unknown, BASE_CTX, {}));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const calledModel = (mockStream.mock.calls[0] as any)[0] as Record<string, unknown>;
        expect(calledModel.id).toBe("custom-model-not-in-catalog");
        expect(calledModel.baseUrl).toBe("https://custom.example.com");
        expect(calledModel.contextWindow).toBe(50_000);
    });

    it("applies toModel defaults for optional fields", async () => {
        const minimal: ModelDescriptor = {
            id: "bare-minimum",
            api: "openai-completions",
            provider: "mock-provider",
        };
        await drain(connector.stream(minimal, BASE_CTX, {}));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const calledModel = (mockStream.mock.calls[0] as any)[0] as Record<string, unknown>;
        // toModel fills in defaults
        expect(calledModel.reasoning).toBe(false);
        expect(calledModel.contextWindow).toBeGreaterThan(0);
        expect(calledModel.maxTokens).toBeGreaterThan(0);
        expect(calledModel.cost).toBeDefined();
    });
});
