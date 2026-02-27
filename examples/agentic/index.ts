/**
 * Agentic Loop Example
 *
 * Demonstrates a complete agentic loop using clawtools:
 *
 *   1. init     — load clawtools (tools + connectors)
 *   2. resolve  — materialise tools for the current workspace
 *   3. stream   — call the LLM with the user message + tool schemas
 *   4. tool use — on toolcall_end: execute the tool, feed result back
 *   5. repeat   — loop until the LLM produces a final text response
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY env var (or any provider key — change PROVIDER below)
 *   - Built tool bundles: run `npm run build` from the repo root first
 *
 * Run:
 *   npx tsx examples/agentic/index.ts
 *   npx tsx examples/agentic/index.ts "List all .ts files in src/"
 */

import {
    createClawtoolsAsync,
    createNodeBridge,
    extractToolSchemas,
    type UserMessage,
    type AssistantMessage,
    type ToolResultMessage,
} from "../../src/index.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const PROVIDER = "anthropic";                          // change to "openai", "google", etc.
const MODEL_ID = "claude-opus-4-6";                    // change to any model in that provider
const MAX_TURNS = 10;                                  // safety limit on tool-call rounds
const ROOT = process.cwd();                            // workspace root for fs tools

// ─── Init ─────────────────────────────────────────────────────────────────────

const userPrompt = process.argv[2] ?? "Read src/index.ts and summarise its exports in one sentence.";

console.log(`\nUser: ${userPrompt}\n`);

const ct = await createClawtoolsAsync();

// ─── Resolve tools ────────────────────────────────────────────────────────────

// bridge + root enable the fs tools (read / write / edit).
// Without them those three tools are silently skipped.
const tools = ct.tools.resolveAll({
    workspaceDir: ROOT,
    root: ROOT,
    bridge: createNodeBridge(ROOT),
});

const toolSchemas = extractToolSchemas(tools);

// ─── Pick connector + model ───────────────────────────────────────────────────

const connector = ct.connectors.getByProvider(PROVIDER);
if (!connector) {
    console.error(`No connector for provider "${PROVIDER}". Available: ${ct.connectors.listProviders().join(", ")}`);
    process.exit(1);
}

const model = connector.models?.find(m => m.id === MODEL_ID);
if (!model) {
    console.error(`Model "${MODEL_ID}" not found for provider "${PROVIDER}".`);
    process.exit(1);
}

// ─── Conversation history ─────────────────────────────────────────────────────

type Message = UserMessage | AssistantMessage | ToolResultMessage;

const messages: Message[] = [
    { role: "user", content: userPrompt },
];

// ─── Agentic loop ─────────────────────────────────────────────────────────────

for (let turn = 0; turn < MAX_TURNS; turn++) {
    // ── Stream one LLM response ───────────────────────────────────────────────

    let textBuffer = "";
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let stopReason: string | undefined;

    process.stdout.write("Assistant: ");

    for await (const event of connector.stream(
        model,
        {
            systemPrompt: "You are a helpful assistant with access to tools.",
            messages,
            tools: toolSchemas,
        },
        {
            apiKey: process.env[`${PROVIDER.toUpperCase().replace(/-/g, "_")}_API_KEY`],
            maxTokens: 4096,
        },
    )) {
        switch (event.type) {
            case "text_delta":
                process.stdout.write(event.delta);
                textBuffer += event.delta;
                break;
            case "toolcall_end":
                toolCalls.push(event.toolCall);
                break;
            case "done":
                stopReason = event.stopReason;
                break;
            case "error":
                throw new Error(`LLM error: ${event.error}`);
        }
    }

    process.stdout.write("\n");

    // ── Record the assistant turn ─────────────────────────────────────────────

    const assistantContent: AssistantMessage["content"] = [];
    if (textBuffer) {
        assistantContent.push({ type: "text", text: textBuffer } as { type: string; text: string });
    }
    for (const tc of toolCalls) {
        assistantContent.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: tc.arguments } as { type: string; [k: string]: unknown });
    }
    messages.push({ role: "assistant", content: assistantContent });

    // ── Done if no tool calls ─────────────────────────────────────────────────

    if (stopReason !== "toolUse" || toolCalls.length === 0) {
        break;
    }

    // ── Execute each tool call and feed results back ───────────────────────────

    for (const tc of toolCalls) {
        const tool = tools.find(t => t.name === tc.name);

        let resultMessage: ToolResultMessage;

        if (!tool) {
            console.error(`  [tool not found: ${tc.name}]`);
            resultMessage = {
                role: "toolResult",
                toolCallId: tc.id,
                toolName: tc.name,
                content: [{ type: "text", text: `Error: tool "${tc.name}" is not available.` }],
                isError: true,
            };
        } else {
            console.error(`  → ${tc.name}(${JSON.stringify(tc.arguments)})`);
            try {
                const result = await tool.execute(
                    tc.id,             // use the LLM-assigned call ID for traceability
                    tc.arguments,
                );

                const content = result.content.map(block => {
                    if (block.type === "text") {
                        return { type: "text" as const, text: block.text };
                    }
                    return { type: "image" as const, data: block.data, mimeType: block.mimeType };
                });

                console.error(`  ← ${tc.name}: ${result.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("").slice(0, 80)}…`);

                resultMessage = {
                    role: "toolResult",
                    toolCallId: tc.id,
                    toolName: tc.name,
                    content,
                    isError: false,
                };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`  ✗ ${tc.name} threw: ${msg}`);
                resultMessage = {
                    role: "toolResult",
                    toolCallId: tc.id,
                    toolName: tc.name,
                    content: [{ type: "text", text: `Error: ${msg}` }],
                    isError: true,
                };
            }
        }

        messages.push(resultMessage);
    }
}
