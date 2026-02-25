/**
 * Lifecycle helper for the OpenAI mock server.
 *
 * `withMockServer()` registers `beforeAll` / `afterAll` hooks automatically
 * and returns the server instance so tests can configure scenarios and
 * inspect captured requests.
 *
 * @example
 * ```ts
 * describe("my suite", () => {
 *   const mock = withMockServer();
 *
 *   beforeEach(() => mock.clearRequests());
 *
 *   it("gets a text response", async () => {
 *     mock.setScenario({ type: "text", content: "hello" });
 *     // ... use mock.url
 *   });
 * });
 * ```
 */

import { beforeAll, afterAll } from "vitest";
import { OpenAIMockServer } from "../openai-mock/index.js";
import type { MockScenario } from "../openai-mock/index.js";

export type { MockScenario };

/**
 * Create an `OpenAIMockServer`, register start/stop lifecycle hooks,
 * and return the server.
 *
 * Must be called at the top level of a `describe` block (or test file).
 */
export function withMockServer(): OpenAIMockServer {
    const server = new OpenAIMockServer();

    beforeAll(async () => server.start());
    afterAll(async () => server.stop());

    return server;
}
