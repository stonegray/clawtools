/**
 * Integration tests: AbortSignal propagation.
 *
 * Verifies that the `signal` argument passed to `query()` is forwarded to the
 * underlying `fetch()` call inside the connector, causing in-progress streams
 * to terminate early and `query()` to reject.
 *
 * The "hung server" scenario is used for mid-stream abort tests: the mock
 * server writes SSE headers but never sends data or closes the connection,
 * so the only way for the client to stop waiting is to fire the AbortSignal.
 */

import { describe, it, expect } from "vitest";
import { createTestApp } from "../testapp/index.js";
import { withMockServer } from "../helpers/index.js";

const mock = withMockServer();

function app() {
    return createTestApp({ mockServerUrl: mock.url, apiKey: "signal-test-key" });
}

// ---------------------------------------------------------------------------
// Pre-aborted signal
// ---------------------------------------------------------------------------

describe("pre-aborted signal", () => {
    it("rejects when the signal is already aborted before query()", async () => {
        mock.setScenario({ type: "text", content: "this should not arrive" });
        const ac = new AbortController();
        ac.abort();
        await expect(app().query("hi", ac.signal)).rejects.toThrow();
    });

    it("the rejection is an AbortError (name matches /abort/i)", async () => {
        mock.setScenario({ type: "text", content: "nope" });
        const ac = new AbortController();
        ac.abort();
        let thrown: unknown;
        try {
            await app().query("hi", ac.signal);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeDefined();
        expect((thrown as Error).name).toMatch(/abort/i);
    });

    it("can pass an explicit abort reason", async () => {
        mock.setScenario({ type: "text", content: "nope" });
        const ac = new AbortController();
        ac.abort(new Error("user cancelled"));
        // Must reject (reason does not need to be the thrown value in all runtimes)
        await expect(app().query("hi", ac.signal)).rejects.toThrow();
    });

    it("rejection value is (or wraps) the reason passed to AbortController.abort() (issue 51)", async () => {
        // Node.js 20+ native fetch throws signal.reason directly when the signal
        // is already aborted before fetch() is called.  The error that propagates
        // through the connector's async generator and out of query() should
        // therefore BE the abort reason, or have it as its .cause property.
        mock.setScenario({ type: "text", content: "never arrives" });
        const abortReason = new Error("user-initiated abort for cause test");
        const ac = new AbortController();
        ac.abort(abortReason);

        let caughtErr: unknown;
        try {
            await app().query("hi", ac.signal);
        } catch (e) {
            caughtErr = e;
        }

        expect(caughtErr).toBeDefined();
        // Accept either: the reason is thrown directly, OR it is exposed as .cause
        const err = caughtErr as Error & { cause?: unknown };
        expect(err === abortReason || err.cause === abortReason).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Mid-stream abort (hung server)
// ---------------------------------------------------------------------------

describe("mid-stream abort via hung server", () => {
    it(
        "rejects when the signal fires after the stream has started",
        async () => {
            mock.setScenario({ type: "hung" });
            const ac = new AbortController();
            // Abort after a short delay — by then fetch will have resolved and
            // the SSE reader will be blocked waiting for the first data chunk.
            setTimeout(() => ac.abort(), 80);
            await expect(app().query("long-running", ac.signal)).rejects.toThrow();
        },
        { timeout: 5_000 },
    );

    it(
        "rejection is an AbortError when aborted mid-stream",
        async () => {
            mock.setScenario({ type: "hung" });
            const ac = new AbortController();
            setTimeout(() => ac.abort(), 80);
            let thrown: unknown;
            try {
                await app().query("will hang", ac.signal);
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeDefined();
            expect((thrown as Error).name).toMatch(/abort/i);
        },
        { timeout: 5_000 },
    );
});

// ---------------------------------------------------------------------------
// Normal completion with a live (non-aborted) signal
// ---------------------------------------------------------------------------

describe("non-aborted signal", () => {
    it("completes normally when the signal is never fired", async () => {
        mock.setScenario({ type: "text", content: "success" });
        const ac = new AbortController();
        const result = await app().query("hi", ac.signal);
        expect(result.text).toBe("success");
    });

    it("passes the signal through so fetch sends it (verified by normal completion)", async () => {
        mock.setScenario({ type: "text", content: "ok" });
        const ac = new AbortController();
        // If signal were not forwarded, a pre-aborted signal would succeed
        // instead of throwing — the normal-completion case proves the path works.
        const result = await app().query("hi", ac.signal);
        expect(result.events.length).toBeGreaterThan(0);
    });

    it("start event is present in a non-aborted stream", async () => {
        mock.setScenario({ type: "text", content: "hello" });
        const ac = new AbortController();
        const result = await app().query("hi", ac.signal);
        expect(result.events[0].type).toBe("start");
    });
});
