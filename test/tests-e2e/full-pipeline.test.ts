/**
 * E2E: Full pipeline — createClawtoolsAsync → register custom tool + connector
 * → query through mock server → execute tool → return result.
 *
 * This tests the complete "agent loop" pattern that a real consumer would use:
 *   1. Initialize clawtools with core tools
 *   2. Register a custom connector pointing at a mock server
 *   3. Send a prompt to the connector
 *   4. Receive a tool call from the LLM
 *   5. Execute the tool
 *   6. Verify the result
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
    createClawtools,
    createClawtoolsAsync,
    jsonResult,
    textResult,
    extractToolSchemas,
} from "clawtools";
import type {
    StreamEvent,
    ModelDescriptor,
    StreamContext,
    Tool,
} from "clawtools";
import { withMockServer } from "../helpers/index.js";
import { createTestApp } from "../testapp/index.js";

const mock = withMockServer();

// ---------------------------------------------------------------------------
// Full agent loop simulation
// ---------------------------------------------------------------------------

describe("full agent loop simulation", () => {
    it("query → tool call → execute tool → verify result", async () => {
        // Step 1: Create the testapp with custom tools
        const app = createTestApp({ mockServerUrl: mock.url, apiKey: "pipeline-key" });

        // Step 2: Mock server returns a tool call for "echo"
        mock.setScenario({
            type: "tool_call",
            name: "echo",
            id: "call_pipeline_001",
            args: { message: "pipeline test" },
        });

        // Step 3: Query the connector
        const result = await app.query("use echo to say pipeline test");

        // Step 4: Verify the tool call was received
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("echo");
        expect(result.toolCalls[0].args).toEqual({ message: "pipeline test" });

        // Step 5: Execute the tool (as an agent loop would)
        const echoTool = app.ct.tools.resolve("echo")!;
        const toolResult = await echoTool.execute(
            result.toolCalls[0].id,
            result.toolCalls[0].args,
        );

        // Step 6: Verify the tool result
        expect(toolResult.content).toHaveLength(1);
        const text = (toolResult.content[0] as { type: "text"; text: string }).text;
        const parsed = JSON.parse(text);
        expect(parsed.echo).toBe("pipeline test");
    });

    it("query → text response → no tool execution needed", async () => {
        const app = createTestApp({ mockServerUrl: mock.url, apiKey: "pipeline-key" });

        mock.setScenario({ type: "text", content: "Just a text response, no tools needed." });

        const result = await app.query("what's the weather?");

        expect(result.text).toBe("Just a text response, no tools needed.");
        expect(result.toolCalls).toHaveLength(0);
        expect(result.events[0].type).toBe("start");
        expect(result.events[result.events.length - 1].type).toBe("done");
    });

    it("query → error → graceful handling", async () => {
        const app = createTestApp({ mockServerUrl: mock.url, apiKey: "pipeline-key" });

        mock.setScenario({ type: "error", status: 503, message: "service unavailable" });

        const result = await app.query("hi");

        // Error should be in events, not thrown
        expect(result.events.some((e) => e.type === "error")).toBe(true);
        // No tool calls on error
        expect(result.toolCalls).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Multi-turn conversation simulation
// ---------------------------------------------------------------------------

describe("multi-turn conversation simulation", () => {
    it("two queries in sequence (text → tool call)", async () => {
        const app = createTestApp({ mockServerUrl: mock.url, apiKey: "multi-turn-key" });

        // Turn 1: text response
        mock.setScenario({ type: "text", content: "I understand. Let me use a tool." });
        const turn1 = await app.query("please help me");
        expect(turn1.text).toBe("I understand. Let me use a tool.");
        expect(turn1.toolCalls).toHaveLength(0);

        // Turn 2: tool call
        mock.setScenario({
            type: "tool_call",
            name: "echo",
            id: "call_turn2",
            args: { message: "tool invoked" },
        });
        const turn2 = await app.query("now use the echo tool");
        expect(turn2.toolCalls).toHaveLength(1);
        expect(turn2.toolCalls[0].name).toBe("echo");
    });
});

// ---------------------------------------------------------------------------
// Schema extraction in the pipeline context
// ---------------------------------------------------------------------------

describe("schema extraction in pipeline", () => {
    it("tools resolved from registry produce valid schemas for LLM", async () => {
        const ct = createClawtools({ skipCoreTools: true });

        ct.tools.register({
            name: "weather",
            description: "Get current weather",
            parameters: {
                type: "object",
                properties: {
                    city: { type: "string", description: "City name" },
                    units: {
                        type: "string",
                        enum: ["celsius", "fahrenheit"],
                        description: "Temperature units",
                    },
                },
                required: ["city"],
            },
            execute: async (_id, params) =>
                jsonResult({ city: params.city, temp: 22, units: params.units ?? "celsius" }),
        });

        ct.tools.register({
            name: "calc",
            description: "Calculator",
            parameters: {
                type: "object",
                properties: {
                    expression: { type: "string", description: "Math expression" },
                },
                required: ["expression"],
            },
            execute: async (_id, params) =>
                jsonResult({ result: eval(String(params.expression)) }),
        });

        const tools = ct.tools.resolveAll();
        const schemas = extractToolSchemas(tools);

        expect(schemas).toHaveLength(2);
        for (const schema of schemas) {
            expect(schema.name).toBeTruthy();
            expect(schema.description).toBeTruthy();
            expect(schema.input_schema).toBeDefined();
            expect((schema.input_schema as Record<string, unknown>).type).toBe("object");
        }

        // Schemas should be usable in a StreamContext
        const context: StreamContext = {
            messages: [{ role: "user", content: "What's the weather?" }],
            tools: schemas,
        };
        expect(context.tools).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// createClawtoolsAsync full integration
// ---------------------------------------------------------------------------

describe("createClawtoolsAsync integration", { timeout: 180_000 }, () => {
    it("loads core tools, adds custom connector, and streams through mock", async () => {
        const ct = await createClawtoolsAsync({ skipBuiltinConnectors: true });

        // Should have 23 core tools
        expect(ct.tools.size).toBe(23);

        // Register a mock connector
        ct.connectors.register({
            id: "mock-pipeline",
            label: "Mock Pipeline",
            provider: "mock-pipeline",
            api: "openai-completions",
            async *stream(_model, context, _options) {
                yield { type: "start" };
                yield { type: "text_delta", delta: "pipeline works!" };
                yield { type: "text_end", content: "pipeline works!" };
                yield { type: "done", stopReason: "stop" };
            },
        });

        const connector = ct.connectors.get("mock-pipeline")!;
        const events: StreamEvent[] = [];
        for await (const event of connector.stream(
            { id: "test", api: "openai-completions", provider: "mock-pipeline" },
            { messages: [{ role: "user", content: "test" }] },
            {},
        )) {
            events.push(event);
        }

        expect(events.map((e) => e.type)).toEqual([
            "start",
            "text_delta",
            "text_end",
            "done",
        ]);
    });

    it("core tools have valid schemas extractable for LLM use", async () => {
        const ct = await createClawtoolsAsync({ skipBuiltinConnectors: true });
        const tools = ct.tools.resolveAll({ workspaceDir: process.cwd() });
        const schemas = extractToolSchemas(tools);

        // At least 15 tools should produce schemas
        expect(schemas.length).toBeGreaterThanOrEqual(15);

        for (const schema of schemas) {
            expect(typeof schema.name).toBe("string");
            expect(schema.name.length).toBeGreaterThan(0);
            expect(typeof schema.description).toBe("string");
            expect(schema.input_schema).toBeDefined();
        }
    });
});

// ---------------------------------------------------------------------------
// Extension discovery in the pipeline
// ---------------------------------------------------------------------------

describe("extension discovery in pipeline", () => {
    it("createClawtools discovers openclaw extensions", () => {
        const ct = createClawtools({ skipCoreTools: true });
        // Extensions come from the openclaw submodule
        expect(Array.isArray(ct.extensions)).toBe(true);
        // The openclaw submodule has extensions/ with plugin manifests
        if (ct.extensions.length > 0) {
            for (const ext of ct.extensions) {
                expect(typeof ext.id).toBe("string");
                expect(typeof ext.name).toBe("string");
                expect(Array.isArray(ext.channels)).toBe(true);
                expect(Array.isArray(ext.providers)).toBe(true);
                expect(typeof ext.path).toBe("string");
            }
        }
    });
});

// ---------------------------------------------------------------------------
// AbortSignal propagation in the pipeline
// ---------------------------------------------------------------------------

describe("abort signal in pipeline", () => {
    it("pre-aborted signal causes query to reject", async () => {
        const app = createTestApp({ mockServerUrl: mock.url, apiKey: "abort-key" });
        mock.setScenario({ type: "text", content: "should not arrive" });

        const ac = new AbortController();
        ac.abort();

        await expect(app.query("hi", ac.signal)).rejects.toThrow();
    });

    it("mid-stream abort causes query to reject (hung scenario)", async () => {
        const app = createTestApp({ mockServerUrl: mock.url, apiKey: "abort-key" });
        mock.setScenario({ type: "hung" });

        const ac = new AbortController();
        setTimeout(() => ac.abort(), 100);

        await expect(app.query("long-running", ac.signal)).rejects.toThrow();
    }, 5_000);
});
