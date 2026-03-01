import { describe, it, expect } from "vitest";
import type { StreamEvent } from "clawtools";

// =============================================================================
// §5 — toolcall_start / toolcall_delta optional `id` field
// =============================================================================

/**
 * Helper: collect all events from an async iterable connector stream.
 */
async function collectEvents(
    gen: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const ev of gen) {
        events.push(ev);
    }
    return events;
}

// Synthetic stream that emits toolcall events with an id present
async function* withIdStream(): AsyncIterable<StreamEvent> {
    yield { type: "start" };
    yield { type: "toolcall_start", id: "call_abc123" };
    yield { type: "toolcall_delta", delta: '{"x":', id: "call_abc123" };
    yield { type: "toolcall_delta", delta: "1}", id: "call_abc123" };
    yield { type: "toolcall_end", toolCall: { id: "call_abc123", name: "my_tool", arguments: { x: 1 } } };
    yield { type: "done", stopReason: "toolUse" };
}

// Synthetic stream that emits toolcall events WITHOUT an id on start/delta
async function* withoutIdStream(): AsyncIterable<StreamEvent> {
    yield { type: "start" };
    yield { type: "toolcall_start" };
    yield { type: "toolcall_delta", delta: '{"y":2}' };
    yield { type: "toolcall_end", toolCall: { id: "call_xyz999", name: "other_tool", arguments: { y: 2 } } };
    yield { type: "done", stopReason: "toolUse" };
}

// Synthetic stream with two parallel tool calls
async function* parallelToolStream(): AsyncIterable<StreamEvent> {
    yield { type: "start" };
    yield { type: "toolcall_start", id: "call_1" };
    yield { type: "toolcall_delta", delta: '{"a":', id: "call_1" };
    yield { type: "toolcall_start", id: "call_2" };
    yield { type: "toolcall_delta", delta: '{"b":', id: "call_2" };
    yield { type: "toolcall_delta", delta: "1}", id: "call_1" };
    yield { type: "toolcall_delta", delta: "2}", id: "call_2" };
    yield { type: "toolcall_end", toolCall: { id: "call_1", name: "tool_a", arguments: { a: 1 } } };
    yield { type: "toolcall_end", toolCall: { id: "call_2", name: "tool_b", arguments: { b: 2 } } };
    yield { type: "done", stopReason: "toolUse" };
}

describe("toolcall_start optional id (§5)", () => {
    it("accepts toolcall_start with an id", async () => {
        const events = await collectEvents(withIdStream());
        const start = events.find((e) => e.type === "toolcall_start");
        expect(start).toBeDefined();
        expect(start!.type).toBe("toolcall_start");
        if (start!.type === "toolcall_start") {
            expect(start!.id).toBe("call_abc123");
        }
    });

    it("accepts toolcall_start without an id", async () => {
        const events = await collectEvents(withoutIdStream());
        const start = events.find((e) => e.type === "toolcall_start");
        expect(start).toBeDefined();
        expect(start!.type).toBe("toolcall_start");
        if (start!.type === "toolcall_start") {
            expect(start!.id).toBeUndefined();
        }
    });

    it("toolcall_end always has a fully-resolved id", async () => {
        const events = await collectEvents(withoutIdStream());
        const end = events.find((e) => e.type === "toolcall_end");
        expect(end).toBeDefined();
        if (end!.type === "toolcall_end") {
            expect(end!.toolCall.id).toBe("call_xyz999");
        }
    });
});

describe("toolcall_delta optional id (§5)", () => {
    it("propagates id on deltas when present", async () => {
        const events = await collectEvents(withIdStream());
        const deltas = events.filter((e) => e.type === "toolcall_delta");
        expect(deltas.length).toBe(2);
        for (const delta of deltas) {
            if (delta.type === "toolcall_delta") {
                expect(delta.id).toBe("call_abc123");
            }
        }
    });

    it("id is absent on deltas when not provided", async () => {
        const events = await collectEvents(withoutIdStream());
        const deltas = events.filter((e) => e.type === "toolcall_delta");
        expect(deltas.length).toBe(1);
        for (const delta of deltas) {
            if (delta.type === "toolcall_delta") {
                expect(delta.id).toBeUndefined();
            }
        }
    });

    it("correctly correlates deltas to parallel tool calls by id", async () => {
        const events = await collectEvents(parallelToolStream());
        const deltas = events.filter((e) => e.type === "toolcall_delta");
        const call1Deltas = deltas.filter((e) => e.type === "toolcall_delta" && e.id === "call_1");
        const call2Deltas = deltas.filter((e) => e.type === "toolcall_delta" && e.id === "call_2");
        expect(call1Deltas.length).toBe(2); // '{"a":' and '1}'
        expect(call2Deltas.length).toBe(2); // '{"b":' and '2}'
    });
});
