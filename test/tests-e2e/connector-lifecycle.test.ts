/**
 * E2E: Connector lifecycle — register → stream → collect events → verify.
 *
 * Tests the connector system end-to-end using the mock OpenAI server.
 * Covers registration, auth resolution, streaming, event ordering,
 * and error handling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
    createClawtoolsSync,
    ConnectorRegistry,
    resolveAuth,
} from "clawtools";
import type { Connector, ModelDescriptor, StreamContext, StreamEvent } from "clawtools";
import { withMockServer } from "../helpers/index.js";
import { createTestApp } from "../testapp/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mock = withMockServer();

/** Drain an async iterable into an array. */
async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const arr: T[] = [];
    for await (const item of iter) arr.push(item);
    return arr;
}

// ---------------------------------------------------------------------------
// Custom connector registration + streaming
// ---------------------------------------------------------------------------

describe("custom connector lifecycle", () => {
    it("registers a connector and streams a text response", async () => {
        const ct = createClawtoolsSync({ skipCoreTools: true });

        ct.connectors.register({
            id: "echo-conn",
            label: "Echo Connector",
            provider: "echo",
            api: "openai-completions",
            models: [],
            async *stream(_model, context, _options) {
                yield { type: "start" };
                const lastMsg = context.messages[context.messages.length - 1];
                const text = typeof lastMsg?.content === "string" ? lastMsg.content : "echo";
                yield { type: "text_delta", delta: text };
                yield { type: "text_end", content: text };
                yield { type: "done", stopReason: "stop" };
            },
        });

        const connector = ct.connectors.get("echo-conn")!;
        expect(connector).toBeDefined();

        const model: ModelDescriptor = {
            id: "echo-model",
            api: "openai-completions",
            provider: "echo",
        };

        const context: StreamContext = {
            messages: [{ role: "user", content: "test message" }],
        };

        const events = await drain(connector.stream(model, context, {}));

        expect(events[0].type).toBe("start");
        expect(events.find((e) => e.type === "text_delta")).toMatchObject({
            type: "text_delta",
            delta: "test message",
        });
        expect(events.find((e) => e.type === "done")).toMatchObject({
            type: "done",
            stopReason: "stop",
        });
    });

    it("lookup by provider and api transport", () => {
        const ct = createClawtoolsSync({ skipCoreTools: true });

        ct.connectors.register({
            id: "test-anthropic",
            label: "Test Anthropic",
            provider: "anthropic",
            api: "anthropic-messages",
            models: [],
            async *stream() {
                yield { type: "done", stopReason: "stop" };
            },
        });

        ct.connectors.register({
            id: "test-openai",
            label: "Test OpenAI",
            provider: "openai",
            api: "openai-completions",
            models: [],
            async *stream() {
                yield { type: "done", stopReason: "stop" };
            },
        });

        expect(ct.connectors.getByProvider("anthropic")?.id).toBe("test-anthropic");
        expect(ct.connectors.getByProvider("openai")?.id).toBe("test-openai");
        expect(ct.connectors.getByApi("anthropic-messages")).toHaveLength(1);
        expect(ct.connectors.getByApi("openai-completions")).toHaveLength(1);
        expect(ct.connectors.listProviders()).toContain("anthropic");
        expect(ct.connectors.listProviders()).toContain("openai");
    });
});

// ---------------------------------------------------------------------------
// Auth resolution e2e
// ---------------------------------------------------------------------------

describe("auth resolution e2e", () => {
    it("resolves auth from an explicit key", () => {
        const auth = resolveAuth("openai", ["OPENAI_API_KEY"], "sk-test-123");
        expect(auth).toBeDefined();
        expect(auth!.apiKey).toBe("sk-test-123");
        expect(auth!.mode).toBe("api-key");
        expect(auth!.source).toBe("explicit");
    });

    it("resolves auth from an env var", () => {
        process.env._E2E_TEST_KEY = "env-key-456";
        try {
            const auth = resolveAuth("test", ["_E2E_TEST_KEY"]);
            expect(auth).toBeDefined();
            expect(auth!.apiKey).toBe("env-key-456");
            expect(auth!.source).toBe("env:_E2E_TEST_KEY");
        } finally {
            delete process.env._E2E_TEST_KEY;
        }
    });

    it("returns undefined when no auth is available", () => {
        const auth = resolveAuth("nonexistent-provider-xyz");
        expect(auth).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Connector streaming through mock server (real HTTP)
// ---------------------------------------------------------------------------

describe("connector streaming via mock server", () => {
    function app() {
        return createTestApp({ mockServerUrl: mock.url, apiKey: "e2e-test-key" });
    }

    it("text streaming: receives start → text_delta(s) → text_end → done", async () => {
        mock.setScenario({ type: "text", content: "Hello from e2e test!" });
        const result = await app().query("hi");

        const types = result.events.map((e) => e.type);
        expect(types[0]).toBe("start");
        expect(types).toContain("text_delta");
        expect(types).toContain("text_end");
        expect(types[types.length - 1]).toBe("done");
        expect(result.text).toBe("Hello from e2e test!");
    });

    it("tool call streaming: receives toolcall events with correct args", async () => {
        mock.setScenario({
            type: "tool_call",
            name: "echo",
            id: "call_e2e_001",
            args: { message: "ping from e2e" },
        });

        const result = await app().query("use echo");
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("echo");
        expect(result.toolCalls[0].id).toBe("call_e2e_001");
        expect(result.toolCalls[0].args).toEqual({ message: "ping from e2e" });
    });

    it("error response: emits error event without throwing", async () => {
        mock.setScenario({ type: "error", status: 500, message: "server error" });
        const result = await app().query("hi");
        expect(result.events.some((e) => e.type === "error")).toBe(true);
    });

    it("multi-scenario: switching scenarios between queries works", async () => {
        mock.setScenario({ type: "text", content: "first" });
        const r1 = await app().query("q1");
        expect(r1.text).toBe("first");

        mock.setScenario({ type: "text", content: "second" });
        const r2 = await app().query("q2");
        expect(r2.text).toBe("second");
    });

    it("sends tools in the request body", async () => {
        mock.setScenario({ type: "text", content: "ok" });
        mock.clearRequests();
        await app().query("what tools?");
        const req = mock.lastRequest()!;
        expect(Array.isArray(req.body?.tools)).toBe(true);
        expect((req.body!.tools as unknown[]).length).toBeGreaterThan(0);
    });

    it("sends Authorization header with Bearer token", async () => {
        mock.setScenario({ type: "text", content: "ok" });
        mock.clearRequests();
        await app().query("hi");
        const req = mock.lastRequest()!;
        expect(req.headers["authorization"]).toBe("Bearer e2e-test-key");
    });
});

// ---------------------------------------------------------------------------
// Connector with tool calls: verify tool invocation works e2e
// ---------------------------------------------------------------------------

describe("connector + tool execution e2e", () => {
    it("stream a tool call, then execute the tool, verify result", async () => {
        const ct = createClawtoolsSync({ skipCoreTools: true });

        // Register a custom tool
        let toolExecuted = false;
        ct.tools.register({
            name: "reverse",
            description: "Reverses a string",
            parameters: {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
            },
            execute: async (_id, params) => {
                toolExecuted = true;
                const reversed = String(params.input).split("").reverse().join("");
                return { content: [{ type: "text", text: reversed }] };
            },
        });

        // Simulate a tool call coming from the connector
        mock.setScenario({
            type: "tool_call",
            name: "reverse",
            id: "call_reverse_001",
            args: { input: "hello" },
        });

        const testApp = createTestApp({ mockServerUrl: mock.url, apiKey: "tool-exec-key" });
        // Override the testapp's tools with our custom one
        const result = await testApp.query("reverse hello");

        // The mock server returned a tool call
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("reverse");

        // Now execute the tool with the returned args (this is what an agent loop does)
        const tool = ct.tools.resolve("reverse")!;
        const toolResult = await tool.execute(
            result.toolCalls[0].id,
            result.toolCalls[0].args,
        );

        expect(toolExecuted).toBe(true);
        expect(toolResult.content[0]).toMatchObject({ type: "text", text: "olleh" });
    });
});
