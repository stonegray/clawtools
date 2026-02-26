/**
 * Integration tests: stream event ordering invariants.
 *
 * Every well-formed stream emitted by a connector must satisfy structural
 * guarantees regardless of the scenario content.  These tests assert those
 * invariants across text, tool-call, and error scenarios.
 *
 * The testapp connector is pointed at the openai-mock server, so these are
 * true end-to-end assertions over real HTTP + SSE.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "../testapp/index.js";
import { withMockServer } from "../helpers/index.js";
import type { StreamEvent } from "clawtools";

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
