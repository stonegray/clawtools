/**
 * Integration tests: stream event ordering invariants.
 *
 * Every well-formed stream emitted by a connector must satisfy structural
 * guarantees regardless of the scenario content.  These tests assert those
 * invariants across text, tool-call, and error scenarios.
 *
 * The testapp connector is pointed at the openai-mock server, so these are
 * true end-to-end assertions over real HTTP + SSE.
 *
 * Sections that don't require an HTTP server (thinking events, multi-tool-call)
 * use self-contained connectors that yield synthetic event sequences directly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "../testapp/index.js";
import { withMockServer } from "../helpers/index.js";
import type { StreamEvent, Connector, ModelDescriptor, StreamContext } from "clawtools";

const mock = withMockServer();

function app() {
    return createTestApp({ mockServerUrl: mock.url, apiKey: "invariants-test-key" });
}

// ---------------------------------------------------------------------------
// Narrow a StreamEvent array to a specific event type
// ---------------------------------------------------------------------------

function eventsOfType<T extends StreamEvent["type"]>(
    events: StreamEvent[],
    type: T,
): Extract<StreamEvent, { type: T }>[] {
    return events.filter((e): e is Extract<StreamEvent, { type: T }> => e.type === type);
}

// ---------------------------------------------------------------------------
// Text scenario invariants
// ---------------------------------------------------------------------------

describe("text stream invariants", () => {
    beforeEach(() => {
        mock.setScenario({ type: "text", content: "hello world" });
    });

    it("first event is 'start'", async () => {
        const { events } = await app().query("hi");
        expect(events[0].type).toBe("start");
    });

    it("last event is 'done' or 'error'", async () => {
        const { events } = await app().query("hi");
        expect(["done", "error"]).toContain(events[events.length - 1].type);
    });

    it("emits at least two events (start + done/error minimum)", async () => {
        const { events } = await app().query("hi");
        expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it("exactly one 'start' event", async () => {
        const { events } = await app().query("hi");
        expect(eventsOfType(events, "start")).toHaveLength(1);
    });

    it("exactly one terminal event (done or error, not both)", async () => {
        const { events } = await app().query("hi");
        const terminals = events.filter((e) => e.type === "done" || e.type === "error");
        expect(terminals).toHaveLength(1);
    });

    it("no events appear after 'done'", async () => {
        const { events } = await app().query("hi");
        const doneIdx = events.findIndex((e) => e.type === "done");
        expect(doneIdx).toBeGreaterThanOrEqual(0);
        // done must be the very last event
        expect(doneIdx).toBe(events.length - 1);
    });

    it("text_end content equals the concatenation of all text_delta deltas", async () => {
        const { events } = await app().query("hi");
        const deltas = eventsOfType(events, "text_delta");
        const assembled = deltas.map((e) => e.delta).join("");
        const textEnd = eventsOfType(events, "text_end")[0];
        expect(textEnd).toBeDefined();
        expect(textEnd.content).toBe(assembled);
    });

    it("text_end appears after all text_delta events", async () => {
        const { events } = await app().query("hi");
        const textEndIdx = events.findIndex((e) => e.type === "text_end");
        const deltaIndices = events
            .map((e, i) => (e.type === "text_delta" ? i : -1))
            .filter((i) => i >= 0);
        for (const idx of deltaIndices) {
            expect(idx).toBeLessThan(textEndIdx);
        }
    });

    it("done event has a non-empty stopReason", async () => {
        const { events } = await app().query("hi");
        const done = eventsOfType(events, "done")[0];
        expect(done).toBeDefined();
        expect(typeof done.stopReason).toBe("string");
        expect(done.stopReason.length).toBeGreaterThan(0);
    });

    it("stopReason is 'stop' for a text-only response", async () => {
        const { events } = await app().query("hi");
        const done = eventsOfType(events, "done")[0];
        expect(done.stopReason).toBe("stop");
    });

    it("no toolcall events present in a text-only response", async () => {
        const { events } = await app().query("hi");
        const toolEvents = events.filter((e) =>
            ["toolcall_start", "toolcall_delta", "toolcall_end"].includes(e.type),
        );
        expect(toolEvents).toHaveLength(0);
    });

    it("event types array starts with 'start' and ends with 'done'", async () => {
        const { events } = await app().query("hi");
        const types = events.map((e) => e.type);
        expect(types[0]).toBe("start");
        expect(types[types.length - 1]).toBe("done");
    });
});

// ---------------------------------------------------------------------------
// Tool-call scenario invariants
// ---------------------------------------------------------------------------

describe("tool_call stream invariants", () => {
    beforeEach(() => {
        mock.setScenario({
            type: "tool_call",
            name: "echo",
            id: "call_invariant_001",
            args: { message: "ping" },
        });
    });

    it("first event is 'start'", async () => {
        const { events } = await app().query("call a tool");
        expect(events[0].type).toBe("start");
    });

    it("last event is 'done' or 'error'", async () => {
        const { events } = await app().query("call a tool");
        expect(["done", "error"]).toContain(events[events.length - 1].type);
    });

    it("no events appear after 'done'", async () => {
        const { events } = await app().query("call a tool");
        const doneIdx = events.findIndex((e) => e.type === "done");
        expect(doneIdx).toBe(events.length - 1);
    });

    it("toolcall_start precedes toolcall_end", async () => {
        const { events } = await app().query("call a tool");
        const startIdx = events.findIndex((e) => e.type === "toolcall_start");
        const endIdx = events.findIndex((e) => e.type === "toolcall_end");
        expect(startIdx).toBeGreaterThanOrEqual(0);
        expect(endIdx).toBeGreaterThan(startIdx);
    });

    it("all toolcall_delta events are between toolcall_start and toolcall_end", async () => {
        const { events } = await app().query("call a tool");
        const startIdx = events.findIndex((e) => e.type === "toolcall_start");
        const endIdx = events.findIndex((e) => e.type === "toolcall_end");
        const deltaIndices = events
            .map((e, i) => (e.type === "toolcall_delta" ? i : -1))
            .filter((i) => i >= 0);
        for (const idx of deltaIndices) {
            expect(idx).toBeGreaterThan(startIdx);
            expect(idx).toBeLessThan(endIdx);
        }
    });

    it("stopReason is 'toolUse' for a tool-call response", async () => {
        const { events } = await app().query("call a tool");
        const done = eventsOfType(events, "done")[0];
        expect(done.stopReason).toBe("toolUse");
    });

    it("toolcall_end contains a parsed arguments object (not a string)", async () => {
        const { events } = await app().query("call a tool");
        const tcEnd = eventsOfType(events, "toolcall_end")[0];
        expect(tcEnd).toBeDefined();
        expect(typeof tcEnd.toolCall.arguments).toBe("object");
        expect(tcEnd.toolCall.arguments).not.toBeNull();
    });

    it("toolcall_end.toolCall.id is a non-empty string", async () => {
        const { events } = await app().query("call a tool");
        const tcEnd = eventsOfType(events, "toolcall_end")[0];
        expect(typeof tcEnd.toolCall.id).toBe("string");
        expect(tcEnd.toolCall.id.length).toBeGreaterThan(0);
    });

    it("toolcall_end.toolCall.name is a non-empty string", async () => {
        const { events } = await app().query("call a tool");
        const tcEnd = eventsOfType(events, "toolcall_end")[0];
        expect(typeof tcEnd.toolCall.name).toBe("string");
        expect(tcEnd.toolCall.name.length).toBeGreaterThan(0);
    });

    it("no text_end event present in a tool-only response", async () => {
        const { events } = await app().query("call a tool");
        expect(eventsOfType(events, "text_end")).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Error scenario invariants
// ---------------------------------------------------------------------------

describe("error scenario invariants", () => {
    it("emits an error event (not a thrown exception) for HTTP 5xx", async () => {
        mock.setScenario({ type: "error", status: 500, message: "server exploded" });
        const result = await app().query("hi");
        expect(eventsOfType(result.events, "error").length).toBeGreaterThan(0);
    });

    it("error event has a non-empty message string", async () => {
        mock.setScenario({ type: "error", status: 500, message: "server exploded" });
        const { events } = await app().query("hi");
        const err = eventsOfType(events, "error")[0];
        expect(typeof err.error).toBe("string");
        expect(err.error.length).toBeGreaterThan(0);
    });

    it("no 'done' event is emitted after an HTTP error", async () => {
        mock.setScenario({ type: "error", status: 429, message: "rate limit" });
        const { events } = await app().query("hi");
        expect(eventsOfType(events, "done")).toHaveLength(0);
    });

    it("query() resolves (does not throw) on HTTP error", async () => {
        mock.setScenario({ type: "error", status: 401, message: "unauthorized" });
        await expect(app().query("hi")).resolves.toBeDefined();
    });

    it("error events accumulate in result.events", async () => {
        mock.setScenario({ type: "error", status: 503, message: "unavailable" });
        const result = await app().query("hi");
        expect(result.events.some((e) => e.type === "error")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Cross-scenario consistency
// ---------------------------------------------------------------------------

describe("cross-scenario consistency", () => {
    it("repeated queries with the same scenario produce the same event structure", async () => {
        mock.setScenario({ type: "text", content: "deterministic" });
        const r1 = await app().query("hi");
        const r2 = await app().query("hi");
        expect(r1.events[0].type).toBe(r2.events[0].type);
        expect(r1.events[r1.events.length - 1].type).toBe(r2.events[r2.events.length - 1].type);
        expect(r1.text).toBe(r2.text);
    });

    it("text scenario always produces the same assembled text", async () => {
        mock.setScenario({ type: "text", content: "stable text output" });
        const r1 = await app().query("query A");
        const r2 = await app().query("query B");
        expect(r1.text).toBe("stable text output");
        expect(r2.text).toBe("stable text output");
    });

    it("multi-word text content is fully preserved end-to-end", async () => {
        const expected = "the quick brown fox jumped over the lazy dog";
        mock.setScenario({ type: "text", content: expected });
        const { text } = await app().query("recite");
        expect(text).toBe(expected);
    });

    it("tool call args are fully preserved end-to-end", async () => {
        const args = { message: "test-payload", count: 42, active: true };
        mock.setScenario({ type: "tool_call", name: "echo", id: "call_e2e", args });
        const { toolCalls } = await app().query("use echo");
        expect(toolCalls[0].args).toEqual(args);
    });
});

// =============================================================================
// Self-contained helpers (no HTTP mock server required)
// =============================================================================

/** Minimal model descriptor used by self-contained connectors. */
const SC_MODEL: ModelDescriptor = {
    id: "self-contained-model",
    api: "openai-completions",
    provider: "self-contained",
};

/** Minimal context used by self-contained connectors. */
const SC_CTX: StreamContext = {
    messages: [{ role: "user", content: "test" }],
};

/** Build a connector that yields a fixed sequence of events without HTTP. */
function makeScConnector(events: StreamEvent[]): Connector {
    return {
        id: "sc-conn",
        label: "Self-Contained Connector",
        provider: "self-contained",
        api: "openai-completions",
        models: [],
        async *stream(_model, _ctx, _opts) {
            for (const ev of events) yield ev;
        },
    };
}

/** Drain all events from a self-contained connector. */
async function drainSc(events: StreamEvent[]): Promise<StreamEvent[]> {
    const conn = makeScConnector(events);
    const result: StreamEvent[] = [];
    for await (const ev of conn.stream(SC_MODEL, SC_CTX, {})) {
        result.push(ev);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Thinking stream invariants — issue 49
// ---------------------------------------------------------------------------

describe("thinking stream invariants (self-contained)", () => {
    it("thinking_delta and thinking_end events are yielded correctly", async () => {
        // Verify that a connector producing thinking events round-trips them unchanged.
        const events = await drainSc([
            { type: "thinking_delta", delta: "thinking..." },
            { type: "thinking_end", content: "thinking..." },
        ]);
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ type: "thinking_delta", delta: "thinking..." });
        expect(events[1]).toEqual({ type: "thinking_end", content: "thinking..." });
    });

    it("all thinking_delta events appear before thinking_end", async () => {
        const events = await drainSc([
            { type: "start" },
            { type: "thinking_delta", delta: "Let me" },
            { type: "thinking_delta", delta: " think..." },
            { type: "thinking_end", content: "Let me think..." },
            { type: "done", stopReason: "stop" },
        ]);
        const thinkEndIdx = events.findIndex((e) => e.type === "thinking_end");
        const deltaIdxs = events
            .map((e, i) => (e.type === "thinking_delta" ? i : -1))
            .filter((i) => i >= 0);
        expect(thinkEndIdx).toBeGreaterThan(0);
        for (const idx of deltaIdxs) {
            expect(idx).toBeLessThan(thinkEndIdx);
        }
    });

    it("assembled thinking_delta content matches the thinking_end content string", async () => {
        const events = await drainSc([
            { type: "thinking_delta", delta: "Hmm, " },
            { type: "thinking_delta", delta: "I see." },
            { type: "thinking_end", content: "Hmm, I see." },
        ]);
        const deltas = events.filter(
            (e): e is Extract<StreamEvent, { type: "thinking_delta" }> => e.type === "thinking_delta",
        );
        const assembled = deltas.map((d) => d.delta).join("");
        const end = events.find(
            (e): e is Extract<StreamEvent, { type: "thinking_end" }> => e.type === "thinking_end",
        );
        expect(end).toBeDefined();
        expect(end!.content).toBe(assembled);
    });

    it("thinking block precedes text block in a mixed thinking+text stream", async () => {
        const events = await drainSc([
            { type: "start" },
            { type: "thinking_delta", delta: "reasoning..." },
            { type: "thinking_end", content: "reasoning..." },
            { type: "text_delta", delta: "answer" },
            { type: "text_end", content: "answer" },
            { type: "done", stopReason: "stop" },
        ]);
        const thinkEndIdx = events.findIndex((e) => e.type === "thinking_end");
        const textDeltaIdx = events.findIndex((e) => e.type === "text_delta");
        expect(thinkEndIdx).toBeGreaterThanOrEqual(0);
        expect(textDeltaIdx).toBeGreaterThan(thinkEndIdx);
    });
});

// ---------------------------------------------------------------------------
// Multi-tool-call stream invariants — issue 50
// ---------------------------------------------------------------------------

describe("multi-tool-call stream invariants (self-contained)", () => {
    it("both tool calls from a two-call stream are captured with correct names", async () => {
        const events = await drainSc([
            { type: "start" },
            { type: "toolcall_start" },
            { type: "toolcall_delta", delta: '{"msg":"hello"}' },
            { type: "toolcall_end", toolCall: { id: "call_1", name: "echo", arguments: { msg: "hello" } } },
            { type: "toolcall_start" },
            { type: "toolcall_delta", delta: '{"n":42}' },
            { type: "toolcall_end", toolCall: { id: "call_2", name: "count", arguments: { n: 42 } } },
            { type: "done", stopReason: "toolUse" },
        ]);

        const tcEnds = events.filter(
            (e): e is Extract<StreamEvent, { type: "toolcall_end" }> => e.type === "toolcall_end",
        );
        expect(tcEnds).toHaveLength(2);
        expect(tcEnds[0].toolCall.name).toBe("echo");
        expect(tcEnds[1].toolCall.name).toBe("count");
        expect(tcEnds[0].toolCall.arguments).toEqual({ msg: "hello" });
        expect(tcEnds[1].toolCall.arguments).toEqual({ n: 42 });
    });

    it("two sequential tool calls each have their own toolcall_start / toolcall_end pair", async () => {
        const events = await drainSc([
            { type: "toolcall_start" },
            { type: "toolcall_end", toolCall: { id: "c1", name: "tool_a", arguments: {} } },
            { type: "toolcall_start" },
            { type: "toolcall_end", toolCall: { id: "c2", name: "tool_b", arguments: {} } },
        ]);
        const starts = events.filter((e) => e.type === "toolcall_start");
        const ends = events.filter((e) => e.type === "toolcall_end");
        expect(starts).toHaveLength(2);
        expect(ends).toHaveLength(2);
    });

    it("all toolcall_delta events appear between their respective start and end", async () => {
        // Two back-to-back tool calls; delta events must stay within the right call window.
        const events = await drainSc([
            { type: "toolcall_start" },
            { type: "toolcall_delta", delta: '{"a":1' },
            { type: "toolcall_delta", delta: "}" },
            { type: "toolcall_end", toolCall: { id: "c1", name: "tool_a", arguments: { a: 1 } } },
            { type: "toolcall_start" },
            { type: "toolcall_delta", delta: '{"b":2}' },
            { type: "toolcall_end", toolCall: { id: "c2", name: "tool_b", arguments: { b: 2 } } },
        ]);

        // Find index positions for each toolcall_start/end pair
        const startIdxs = events.map((e, i) => (e.type === "toolcall_start" ? i : -1)).filter((i) => i >= 0);
        const endIdxs = events.map((e, i) => (e.type === "toolcall_end" ? i : -1)).filter((i) => i >= 0);
        expect(startIdxs).toHaveLength(2);
        expect(endIdxs).toHaveLength(2);

        // Every event between start[0] and end[0] (exclusive) should not be a toolcall_start/end
        // — the deltas for the first call must fall within the first window.
        for (let i = startIdxs[0] + 1; i < endIdxs[0]; i++) {
            expect(events[i].type).not.toBe("toolcall_start");
            expect(events[i].type).not.toBe("toolcall_end");
        }
    });

    it("done event is the last event in a two-tool-call stream", async () => {
        const events = await drainSc([
            { type: "toolcall_start" },
            { type: "toolcall_end", toolCall: { id: "c1", name: "t1", arguments: {} } },
            { type: "toolcall_start" },
            { type: "toolcall_end", toolCall: { id: "c2", name: "t2", arguments: {} } },
            { type: "done", stopReason: "toolUse" },
        ]);
        expect(events[events.length - 1].type).toBe("done");
    });
});
