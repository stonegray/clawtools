/**
 * E2E: StreamEvent format — verify all event types round-trip correctly.
 *
 * Tests that every StreamEvent variant defined in types.ts is correctly
 * emitted and received through a connector, and that event structural
 * invariants hold across scenarios.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createClawtoolsSync } from "clawtools";
import type {
    StreamEvent,
    ModelDescriptor,
    StreamContext,
    Connector,
} from "clawtools";

// ---------------------------------------------------------------------------
// Helper: in-memory connector that yields pre-defined events
// ---------------------------------------------------------------------------

function createEventConnector(events: StreamEvent[]): Connector {
    return {
        id: "event-test-conn",
        label: "Event Test",
        provider: "event-test",
        api: "openai-completions",
        async *stream() {
            for (const event of events) {
                yield event;
            }
        },
    };
}

const MODEL: ModelDescriptor = {
    id: "test-model",
    api: "openai-completions",
    provider: "event-test",
};

const CTX: StreamContext = {
    messages: [{ role: "user", content: "test" }],
};

async function collectEvents(connector: Connector): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const event of connector.stream(MODEL, CTX, {})) {
        events.push(event);
    }
    return events;
}

// ---------------------------------------------------------------------------
// Individual event type verification
// ---------------------------------------------------------------------------

describe("StreamEvent type round-trip", () => {
    it("start event", async () => {
        const conn = createEventConnector([{ type: "start" }]);
        const events = await collectEvents(conn);
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ type: "start" });
    });

    it("text_delta event preserves delta string", async () => {
        const conn = createEventConnector([
            { type: "text_delta", delta: "Hello, world!" },
        ]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({ type: "text_delta", delta: "Hello, world!" });
    });

    it("text_end event preserves content string", async () => {
        const conn = createEventConnector([
            { type: "text_end", content: "Full response text" },
        ]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({ type: "text_end", content: "Full response text" });
    });

    it("thinking_delta event preserves delta", async () => {
        const conn = createEventConnector([
            { type: "thinking_delta", delta: "Let me think..." },
        ]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({ type: "thinking_delta", delta: "Let me think..." });
    });

    it("thinking_end event preserves content", async () => {
        const conn = createEventConnector([
            { type: "thinking_end", content: "I've concluded that..." },
        ]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({ type: "thinking_end", content: "I've concluded that..." });
    });

    it("toolcall_start event", async () => {
        const conn = createEventConnector([{ type: "toolcall_start" }]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({ type: "toolcall_start" });
    });

    it("toolcall_delta event preserves delta", async () => {
        const conn = createEventConnector([
            { type: "toolcall_delta", delta: '{"key":' },
        ]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({ type: "toolcall_delta", delta: '{"key":' });
    });

    it("toolcall_end event preserves toolCall structure", async () => {
        const toolCall = {
            id: "call_abc",
            name: "my_tool",
            arguments: { key: "value", num: 42 },
        };
        const conn = createEventConnector([{ type: "toolcall_end", toolCall }]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({ type: "toolcall_end", toolCall });
    });

    it("done event preserves stopReason and usage", async () => {
        const conn = createEventConnector([
            {
                type: "done",
                stopReason: "stop",
                usage: { inputTokens: 100, outputTokens: 50 },
            },
        ]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({
            type: "done",
            stopReason: "stop",
            usage: { inputTokens: 100, outputTokens: 50 },
        });
    });

    it("done event with toolUse stopReason", async () => {
        const conn = createEventConnector([
            { type: "done", stopReason: "toolUse" },
        ]);
        const events = await collectEvents(conn);
        expect(events[0]).toMatchObject({
            type: "done",
            stopReason: "toolUse",
        });
    });

    it("error event preserves error message", async () => {
        const conn = createEventConnector([
            { type: "error", error: "Rate limit exceeded" },
        ]);
        const events = await collectEvents(conn);
        expect(events[0]).toEqual({ type: "error", error: "Rate limit exceeded" });
    });
});

// ---------------------------------------------------------------------------
// Full conversation sequence
// ---------------------------------------------------------------------------

describe("full event sequence", () => {
    it("text conversation: start → deltas → text_end → done", async () => {
        const conn = createEventConnector([
            { type: "start" },
            { type: "text_delta", delta: "Hello " },
            { type: "text_delta", delta: "world!" },
            { type: "text_end", content: "Hello world!" },
            { type: "done", stopReason: "stop", usage: { inputTokens: 10, outputTokens: 5 } },
        ]);

        const events = await collectEvents(conn);
        expect(events).toHaveLength(5);
        expect(events.map((e) => e.type)).toEqual([
            "start",
            "text_delta",
            "text_delta",
            "text_end",
            "done",
        ]);

        // Verify deltas assemble to text_end content
        const deltas = events.filter((e) => e.type === "text_delta") as Array<{
            type: "text_delta";
            delta: string;
        }>;
        const assembled = deltas.map((d) => d.delta).join("");
        const textEnd = events.find((e) => e.type === "text_end") as {
            type: "text_end";
            content: string;
        };
        expect(assembled).toBe(textEnd.content);
    });

    it("tool call conversation: start → toolcall flow → done", async () => {
        const conn = createEventConnector([
            { type: "start" },
            { type: "toolcall_start" },
            { type: "toolcall_delta", delta: '{"msg":' },
            { type: "toolcall_delta", delta: '"hi"}' },
            {
                type: "toolcall_end",
                toolCall: { id: "call_1", name: "echo", arguments: { msg: "hi" } },
            },
            { type: "done", stopReason: "toolUse" },
        ]);

        const events = await collectEvents(conn);
        expect(events).toHaveLength(6);

        // toolcall_start before toolcall_end
        const startIdx = events.findIndex((e) => e.type === "toolcall_start");
        const endIdx = events.findIndex((e) => e.type === "toolcall_end");
        expect(startIdx).toBeLessThan(endIdx);

        // done is last
        expect(events[events.length - 1].type).toBe("done");
    });

    it("thinking + text conversation: thinking flow then text flow", async () => {
        const conn = createEventConnector([
            { type: "start" },
            { type: "thinking_delta", delta: "Let me" },
            { type: "thinking_delta", delta: " think..." },
            { type: "thinking_end", content: "Let me think..." },
            { type: "text_delta", delta: "The answer is 42" },
            { type: "text_end", content: "The answer is 42" },
            { type: "done", stopReason: "stop" },
        ]);

        const events = await collectEvents(conn);
        expect(events).toHaveLength(7);

        // thinking ends before text starts
        const thinkEndIdx = events.findIndex((e) => e.type === "thinking_end");
        const textDeltaIdx = events.findIndex((e) => e.type === "text_delta");
        expect(thinkEndIdx).toBeLessThan(textDeltaIdx);
    });

    it("error-only stream: single error event", async () => {
        const conn = createEventConnector([
            { type: "error", error: "Connection refused" },
        ]);

        const events = await collectEvents(conn);
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("error");
    });

    it("empty stream produces empty events array", async () => {
        const conn = createEventConnector([]);
        const events = await collectEvents(conn);
        expect(events).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Event registered via ConnectorRegistry
// ---------------------------------------------------------------------------

describe("events via ConnectorRegistry", () => {
    it("connector registered in registry streams events correctly", async () => {
        const ct = createClawtoolsSync({ skipCoreTools: true });

        ct.connectors.register(
            createEventConnector([
                { type: "start" },
                { type: "text_delta", delta: "registry test" },
                { type: "done", stopReason: "stop" },
            ]),
        );

        const conn = ct.connectors.get("event-test-conn")!;
        const events = await collectEvents(conn);
        expect(events.map((e) => e.type)).toEqual(["start", "text_delta", "done"]);
    });
});
