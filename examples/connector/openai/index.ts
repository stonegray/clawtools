/**
 * OpenAI Connector Example — using the built-in OpenClaw connector
 *
 * Demonstrates how to look up the built-in OpenAI connector from
 * discoverBuiltinConnectors() and stream a response with it.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/connector/openai/index.ts
 */

import type { StreamContext } from "clawtools";
import { discoverBuiltinConnectors, resolveAuth } from "clawtools/connectors";

async function main() {
    // Load all built-in connectors (backed by @mariozechner/pi-ai)
    const connectors = await discoverBuiltinConnectors();

    // Find the built-in OpenAI connector
    const connector = connectors.find((c) => c.provider === "openai");
    if (!connector) throw new Error("Built-in OpenAI connector not found");

    // Resolve auth from OPENAI_API_KEY in the environment
    const auth = resolveAuth("openai", connector.envVars);
    if (!auth?.apiKey) throw new Error("OPENAI_API_KEY not set");

    // Pick a model from the connector's model list
    const model = connector.models?.find((m) => m.id === "gpt-4o-mini")
        ?? connector.models?.[0];
    if (!model) throw new Error("No models available on the OpenAI connector");

    const context: StreamContext = {
        messages: [{ role: "user", content: "Hello world!" }],
    };

    for await (const event of connector.stream(model, context, { apiKey: auth.apiKey })) {
        if (event.type === "text_delta") process.stdout.write(event.delta);
        if (event.type === "error") { console.error("\nError:", event.error); break; }
    }
    console.log();
}

main();
