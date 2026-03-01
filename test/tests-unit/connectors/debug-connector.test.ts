/**
 * Unit tests: clawfice-debug connector — all 8 deterministic models.
 *
 * Verifies every model replies correctly via the clawtools connector API
 * (createClawtools → builtin/clawfice-debug → stream).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createClawtools } from "clawtools";
import type { Connector, StreamEvent } from "clawtools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function drain(
    stream: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    return events;
}

function textFrom(events: StreamEvent[]): string {
    return events
        .filter((e): e is Extract<StreamEvent, { type: "text_delta" }> => e.type === "text_delta")
        .map((e) => e.delta)
        .join("");
}

function thinkingFrom(events: StreamEvent[]): string {
    return events
        .filter((e): e is Extract<StreamEvent, { type: "thinking_delta" }> => e.type === "thinking_delta")
        .map((e) => e.delta)
        .join("");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let conn: Connector;

beforeAll(async () => {
    const ct = await createClawtools({ skipCoreTools: true });
    const c = ct.connectors.get("builtin/clawfice-debug");
    expect(c, "builtin/clawfice-debug connector must be registered").toBeDefined();
    conn = c!;
}, 30_000);

// ---------------------------------------------------------------------------
// Stream protocol invariants (all models)
// ---------------------------------------------------------------------------

describe("clawfice-debug connector — stream invariants", () => {
    for (const model of [
        "dummy-echo-1",
        "sys-echo-1",
        "parrot-1",
        "silent-1",
        "upper-parrot-1",
        "tagged-parrot-1",
        "inspect-echo-1",
        "thinking-stream-1",
    ]) {
        it(`${model}: starts with 'start' and ends with 'done'`, async () => {
            const m = conn.models.find((m) => m.id === model)!;
            expect(m, `model ${model} must be in catalog`).toBeDefined();

            const events = await drain(
                conn.stream(m, { messages: [{ role: "user", content: "hi" }] }, {}),
            );

            expect(events[0]?.type).toBe("start");
            expect(events.at(-1)?.type).toBe("done");
            const done = events.at(-1) as Extract<StreamEvent, { type: "done" }>;
            expect(done.stopReason).toBe("stop");
        });
    }
});

// ---------------------------------------------------------------------------
// Per-model behaviour
// ---------------------------------------------------------------------------

describe("clawfice-debug connector — model behaviours", () => {
    const USER = "Hello from tests";
    const CTX = { messages: [{ role: "user" as const, content: USER }] };

    it("dummy-echo-1: returns a canned reply containing the user input", async () => {
        const m = conn.models.find((m) => m.id === "dummy-echo-1")!;
        const events = await drain(conn.stream(m, CTX, {}));
        const text = textFrom(events);
        expect(text).toContain(`You said: "${USER}"`);
        expect(text.length).toBeGreaterThan(10);
    });

    it("parrot-1: echoes the user message verbatim", async () => {
        const m = conn.models.find((m) => m.id === "parrot-1")!;
        const events = await drain(conn.stream(m, CTX, {}));
        expect(textFrom(events)).toBe(USER);
    });

    it("upper-parrot-1: echoes the user message in uppercase", async () => {
        const m = conn.models.find((m) => m.id === "upper-parrot-1")!;
        const events = await drain(conn.stream(m, CTX, {}));
        expect(textFrom(events)).toBe(USER.toUpperCase());
    });

    it("tagged-parrot-1: prefixes reply with [relay]", async () => {
        const m = conn.models.find((m) => m.id === "tagged-parrot-1")!;
        const events = await drain(conn.stream(m, CTX, {}));
        expect(textFrom(events)).toBe(`[relay] ${USER}`);
    });

    it("silent-1: replies with '(silent)'", async () => {
        const m = conn.models.find((m) => m.id === "silent-1")!;
        const events = await drain(conn.stream(m, CTX, {}));
        expect(textFrom(events)).toBe("(silent)");
    });

    it("sys-echo-1: mirrors the system prompt and tool list", async () => {
        const m = conn.models.find((m) => m.id === "sys-echo-1")!;
        const events = await drain(
            conn.stream(m, {
                messages: [{ role: "user", content: "hi" }],
                systemPrompt: "You are a test bot.",
                tools: [{ name: "search", description: "Search web", input_schema: {} }],
            }, {}),
        );
        const text = textFrom(events);
        expect(text).toContain("You are a test bot.");
        expect(text).toContain("search");
    });

    it("inspect-echo-1: reports message count and last user text", async () => {
        const m = conn.models.find((m) => m.id === "inspect-echo-1")!;
        const events = await drain(conn.stream(m, CTX, {}));
        const text = textFrom(events);
        expect(text).toContain("[inspect] messages: 1");
        expect(text).toContain(`[inspect] last_user: ${USER}`);
    });

    it("thinking-stream-1: emits thinking_delta events before text_delta", async () => {
        const m = conn.models.find((m) => m.id === "thinking-stream-1")!;
        const events = await drain(conn.stream(m, CTX, {}));

        const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
        const textDeltas = events.filter((e) => e.type === "text_delta");
        expect(thinkingDeltas.length).toBeGreaterThan(0);
        expect(textDeltas.length).toBeGreaterThan(0);

        const firstThinking = events.findIndex((e) => e.type === "thinking_delta");
        const firstText = events.findIndex((e) => e.type === "text_delta");
        expect(firstThinking).toBeLessThan(firstText);

        const thinking = thinkingFrom(events);
        expect(thinking).toContain(`The user asked: "${USER}"`);
    });

    it("dummy-echo-1: deterministic hash → same model + input always gives same reply", async () => {
        const m = conn.models.find((m) => m.id === "dummy-echo-1")!;
        const ctx = { messages: [{ role: "user" as const, content: "consistent input" }] };
        const [a, b] = await Promise.all([
            drain(conn.stream(m, ctx, {})).then(textFrom),
            drain(conn.stream(m, ctx, {})).then(textFrom),
        ]);
        expect(a).toBe(b);
    });

    it("usage is reported in the 'done' event", async () => {
        const m = conn.models.find((m) => m.id === "parrot-1")!;
        const events = await drain(conn.stream(m, CTX, {}));
        const done = events.at(-1) as Extract<StreamEvent, { type: "done" }>;
        expect(done.usage?.inputTokens).toBeGreaterThanOrEqual(0);
        expect(done.usage?.outputTokens).toBeGreaterThanOrEqual(0);
    });
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

describe("clawfice-debug connector — catalog", () => {
    it("exposes exactly 8 models", () => {
        expect(conn.models).toHaveLength(8);
    });

    it("all model IDs are unique", () => {
        const ids = conn.models.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("all models have api='clawfice-debug'", () => {
        for (const m of conn.models) {
            expect(m.api).toBe("clawfice-debug");
        }
    });

    it("thinking-stream-1 has reasoning=true", () => {
        const m = conn.models.find((m) => m.id === "thinking-stream-1");
        expect(m?.reasoning).toBe(true);
    });

    it("all non-thinking models have reasoning=false or undefined", () => {
        for (const m of conn.models) {
            if (m.id !== "thinking-stream-1") {
                expect(m.reasoning).toBeFalsy();
            }
        }
    });
});
