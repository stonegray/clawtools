/**
 * echo-plugin — test resource plugin.
 *
 * Registers:
 *   - "echo" tool    (active — collected by clawtools)
 *   - "echo-connector" connector (active — collected by clawtools)
 */

import type { PluginApi } from "clawtools";

export function register(api: PluginApi): void {
    api.registerTool({
        name: "echo",
        description: "Echoes the input message back verbatim.",
        parameters: {
            type: "object",
            properties: {
                message: { type: "string", description: "The message to echo" },
            },
            required: ["message"],
        },
        execute: async (_id, params) => ({
            content: [{ type: "text" as const, text: String(params.message) }],
            details: { echoed: params.message },
        }),
    });

    api.registerConnector({
        id: "echo-connector",
        label: "Echo Connector",
        provider: "echo",
        api: "openai-completions",
        envVars: ["ECHO_API_KEY"],
        models: [
            {
                id: "echo-model",
                api: "openai-completions",
                provider: "echo",
            },
        ],
        async *stream(_model, context, _options) {
            yield { type: "start" as const };
            const last = context.messages[context.messages.length - 1];
            const content = typeof last?.content === "string" ? last.content : "echo";
            yield { type: "text_delta" as const, delta: `echo: ${content}` };
            yield { type: "text_end" as const, content: `echo: ${content}` };
            yield { type: "done" as const, stopReason: "stop" };
        },
    });
}
