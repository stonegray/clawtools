/**
 * Integration tests: testapp ↔ openai-mock server.
 *
 * These tests start the mock HTTP server, create a test app pointed at it,
 * fire real fetch() calls, and assert on the collected StreamEvents.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "../testapp/index.js";
import { withMockServer } from "../helpers/index.js";

// Spin up one server for the entire suite — tests configure scenarios per-test
const mock = withMockServer();

// Fresh app per test so state doesn't leak (toolCount, etc.)
function app() {
    return createTestApp({ mockServerUrl: mock.url, apiKey: "integration-test-key" });
}

// ---------------------------------------------------------------------------
// Text streaming
// ---------------------------------------------------------------------------

describe("text response", () => {
    beforeEach(() => {
        mock.setScenario({ type: "text", content: "Hello from the mock!" });
    });

    it("receives a text_delta event", async () => {
        const result = await app().query("hi");
        expect(result.events.some((e) => e.type === "text_delta")).toBe(true);
    });

    it("assembles full text from deltas", async () => {
        const result = await app().query("hi");
        expect(result.text).toBe("Hello from the mock!");
    });

    it("emits a start event", async () => {
        const result = await app().query("hi");
        expect(result.events[0].type).toBe("start");
    });

    it("emits a done event as the final event", async () => {
        const result = await app().query("hi");
        const last = result.events[result.events.length - 1];
        expect(last.type).toBe("done");
    });

    it("done event has stopReason=stop", async () => {
        const result = await app().query("hi");
        const done = result.events.find((e) => e.type === "done") as
            | { type: "done"; stopReason: string }
            | undefined;
        expect(done?.stopReason).toBe("stop");
    });

    it("has no tool calls for a plain text response", async () => {
        const result = await app().query("hi");
        expect(result.toolCalls).toHaveLength(0);
    });

    it("reports at least one registered tool (echo)", async () => {
        const result = await app().query("hi");
        expect(result.toolCount).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// Tool call streaming
// ---------------------------------------------------------------------------

describe("tool_call response", () => {
    beforeEach(() => {
        mock.setScenario({
            type: "tool_call",
            name: "echo",
            id: "call_abc123",
            args: { message: "ping" },
        });
    });

    it("receives a toolcall_start event", async () => {
        const result = await app().query("use echo");
        expect(result.events.some((e) => e.type === "toolcall_start")).toBe(true);
    });

    it("receives toolcall_delta events", async () => {
        const result = await app().query("use echo");
        expect(result.events.some((e) => e.type === "toolcall_delta")).toBe(true);
    });

    it("receives a toolcall_end event", async () => {
        const result = await app().query("use echo");
        expect(result.events.some((e) => e.type === "toolcall_end")).toBe(true);
    });

    it("done event has stopReason=toolUse", async () => {
        const result = await app().query("use echo");
        const done = result.events.find((e) => e.type === "done") as
            | { type: "done"; stopReason: string }
            | undefined;
        expect(done?.stopReason).toBe("toolUse");
    });

    it("correctly assembles tool call name and args", async () => {
        const result = await app().query("use echo");
        expect(result.toolCalls).toHaveLength(1);
        const tc = result.toolCalls[0];
        expect(tc.id).toBe("call_abc123");
        expect(tc.name).toBe("echo");
        expect(tc.args).toEqual({ message: "ping" });
    });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error scenario", () => {
    it("emits an error event on HTTP 429", async () => {
        mock.setScenario({ type: "error", status: 429, message: "rate limited", code: "rate_limit" });
        const result = await app().query("hi");
        expect(result.events.some((e) => e.type === "error")).toBe(true);
    });

    it("emits an error event on HTTP 500", async () => {
        mock.setScenario({ type: "error", status: 500, message: "internal error" });
        const result = await app().query("hi");
        expect(result.events.some((e) => e.type === "error")).toBe(true);
    });

    it("does not throw from query() on error", async () => {
        mock.setScenario({ type: "error", status: 401, message: "unauthorized" });
        await expect(app().query("hi")).resolves.toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Request capture — verify what was sent to the server
// ---------------------------------------------------------------------------

describe("request capture", () => {
    beforeEach(() => {
        mock.setScenario({ type: "text", content: "ok" });
        mock.clearRequests();
    });

    it("sends exactly one POST to /v1/chat/completions", async () => {
        await app().query("hello");
        const reqs = mock.getRequests();
        expect(reqs).toHaveLength(1);
        expect(reqs[0].method).toBe("POST");
        expect(reqs[0].path).toBe("/v1/chat/completions");
    });

    it("includes Authorization header with Bearer token", async () => {
        await app().query("hello");
        const req = mock.lastRequest()!;
        const auth = req.headers["authorization"] as string;
        expect(auth).toMatch(/^Bearer /);
        expect(auth).toBe("Bearer integration-test-key");
    });

    it("sends stream: true in request body", async () => {
        await app().query("hello");
        const req = mock.lastRequest()!;
        expect(req.body?.stream).toBe(true);
    });

    it("includes the user message in messages array", async () => {
        await app().query("say something");
        const req = mock.lastRequest()!;
        const messages = req.body?.messages as Array<{ role: string; content: string }>;
        expect(messages).toBeDefined();
        const userMsg = messages.find((m) => m.role === "user");
        expect(userMsg?.content).toBe("say something");
    });

    it("includes tools in request body when tools are registered", async () => {
        await app().query("use a tool");
        const req = mock.lastRequest()!;
        expect(Array.isArray(req.body?.tools)).toBe(true);
        expect((req.body!.tools as unknown[]).length).toBeGreaterThan(0);
    });

    it("sends the correct model ID", async () => {
        await app().query("hi");
        const req = mock.lastRequest()!;
        expect(req.body?.model).toBe("gpt-4o-mini");
    });
});

// ---------------------------------------------------------------------------
// Multi-request isolation (scenario changes mid-suite)
// ---------------------------------------------------------------------------

describe("scenario isolation", () => {
    it("each setScenario call affects the very next request", async () => {
        mock.setScenario({ type: "text", content: "first" });
        const r1 = await app().query("q1");
        mock.setScenario({ type: "text", content: "second" });
        const r2 = await app().query("q2");

        expect(r1.text).toBe("first");
        expect(r2.text).toBe("second");
    });
});
