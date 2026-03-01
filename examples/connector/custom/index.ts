/**
 * Custom Connector Example
 *
 * Demonstrates how to implement a custom Connector from scratch and register
 * it with the ConnectorRegistry.
 *
 * This example uses a trivial "echo" connector that streams back a canned
 * response locally — no API key or network access required.
 *
 * Run: npx tsx examples/connector/custom/index.ts
 */

import type { Connector, StreamContext } from "clawtools";
import { ConnectorRegistry } from "clawtools/connectors";

// ---------------------------------------------------------------------------
// 1. Implement a custom connector
// ---------------------------------------------------------------------------

/**
 * A minimal echo connector.
 *
 * A real connector would call an external LLM API here; this one simply
 * streams a canned reply so the example runs without credentials.
 */
const echoConnector: Connector = {
    id: "custom/echo",
    label: "Echo (custom)",
    provider: "echo",
    api: "openai-completions",
    envVars: [], // no credentials required

    models: [
        {
            id: "echo-1",
            name: "Echo Model",
            provider: "echo",
            api: "openai-completions",
        },
    ],

    async *stream(model, context, _options) {
        // Extract the last user message to echo back
        const lastMessage = [...context.messages]
            .reverse()
            .find((m) => (m as { role: string }).role === "user");
        const userText =
            typeof (lastMessage as { content?: unknown })?.content === "string"
                ? (lastMessage as { content: string }).content
                : "(no message)";

        yield { type: "start" };

        // Stream the reply word-by-word to demonstrate incremental deltas
        const reply = `Echo [${model.id}]: ${userText}`;
        for (const word of reply.split(" ")) {
            yield { type: "text_delta", delta: word + " " };
            // Simulate network latency between chunks
            await new Promise((r) => setTimeout(r, 30));
        }

        yield { type: "done", stopReason: "stop" };
    },
};

// ---------------------------------------------------------------------------
// 2. Register it with a ConnectorRegistry
// ---------------------------------------------------------------------------

const registry = new ConnectorRegistry();
registry.register(echoConnector);

// ---------------------------------------------------------------------------
// 3. Use the connector
// ---------------------------------------------------------------------------

async function main() {
    const connector = registry.getByProvider("echo");
    if (!connector) throw new Error("Echo connector not found in registry");

    const model = connector.models?.[0];
    if (!model) throw new Error("No models on echo connector");

    const context: StreamContext = {
        messages: [{ role: "user", content: "Hello, custom connector!" }],
    };

    console.log("Streaming response from custom echo connector:\n");

    for await (const event of connector.stream(model, context, {})) {
        if (event.type === "text_delta") process.stdout.write(event.delta);
        if (event.type === "error") { console.error("\nError:", event.error); break; }
    }
    console.log();
}

main();
