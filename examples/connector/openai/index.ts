/**
 * Minimal OpenAI Connector Example
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/openai-connector/index.ts
 */

import type { Connector, StreamContext } from "clawtools";
import { resolveAuth } from "clawtools/connectors";

// Define a minimal OpenAI connector
const openaiConnector: Connector = {
    id: "openai",
    label: "OpenAI",
    provider: "openai",
    api: "openai-completions",
    envVars: ["OPENAI_API_KEY"],

    async *stream(model, context, options) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify({
                model: model.id,
                messages: context.messages,
                stream: true,
            }),
        });

        if (!res.ok) {
            yield { type: "error", error: await res.text() };
            return;
        }

        yield { type: "start" };
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
                const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
                if (delta) yield { type: "text_delta", delta };
            }
        }

        yield { type: "done", stopReason: "stop" };
    },
};

// Stream "Hello world!" and print the response
async function main() {
    const auth = resolveAuth("openai", openaiConnector.envVars);
    if (!auth?.apiKey) throw new Error("OPENAI_API_KEY not set");

    const context: StreamContext = {
        messages: [{ role: "user", content: "Hello world!" }],
    };

    for await (const event of openaiConnector.stream(
        { id: "gpt-4o-mini", provider: "openai", api: "openai-completions" },
        context,
        { apiKey: auth!.apiKey },
    )) {
        if (event.type === "text_delta") process.stdout.write(event.delta);
    }
    console.log();
}

main();
