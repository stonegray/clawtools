/**
 * A static mock connector fixture for direct use in unit tests.
 * Import this rather than constructing a connector inline.
 */

import type { Connector } from "clawtools";

export const mockConnector: Connector = {
    id: "test-connector",
    label: "Test Connector",
    provider: "test",
    api: "openai-completions",
    envVars: ["TEST_API_KEY"],
    models: [
        {
            id: "test-model",
            api: "openai-completions",
            provider: "test",
            contextWindow: 4096,
            maxTokens: 256,
        },
    ],
    async *stream(_model, _context, _options) {
        yield { type: "start" as const };
        yield { type: "text_delta" as const, delta: "test response" };
        yield { type: "text_end" as const, content: "test response" };
        yield { type: "done" as const, stopReason: "stop" };
    },
};
