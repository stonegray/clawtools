/**
 * Test application — demonstrates end-user usage of clawtools.
 *
 * This is intentionally written the way a real consumer would write it:
 * import from "clawtools", build a connector, register tools, call stream().
 * Integration tests point this app at the openai-mock server.
 */

import { createClawtools } from "clawtools";
import { jsonResult } from "clawtools/tools";
import { resolveAuth } from "clawtools/connectors";
import type { ModelDescriptor, StreamEvent } from "clawtools";

// =============================================================================
// Public API
// =============================================================================

export interface AppConfig {
    /** Base URL of the OpenAI-compatible server (e.g. mock server URL). */
    mockServerUrl: string;
    /** API key to send in the Authorization header. Defaults to "test-key". */
    apiKey?: string;
}

export interface AppResult {
    events: StreamEvent[];
    /** Full text assembled from text_delta events. */
    text: string;
    /** Tool calls the LLM requested. */
    toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    /** Number of tools available in the registry during the call. */
    toolCount: number;
}

/**
 * Create a test application instance.
 *
 * Returns a `query()` function that sends a prompt to the mock server and
 * collects all stream events.
 */
export function createTestApp(config: AppConfig) {
    // ── Create a clawtools instance (no core tools — keep tests fast) ────────
    const ct = createClawtools({ skipCoreTools: true });

    const model: ModelDescriptor = {
        id: "gpt-4o-mini",
        api: "openai-completions",
        provider: "mock",
        baseUrl: config.mockServerUrl,
        contextWindow: 8192,
        maxTokens: 1024,
    };

    // ── Register a connector implementing OpenAI SSE streaming ───────────────
    ct.connectors.register({
        id: "mock-openai",
        label: "Mock OpenAI",
        provider: "mock",
        api: "openai-completions",
        envVars: ["MOCK_API_KEY"],
        models: [model],

        async *stream(model, context, options) {
            const apiKey = options.apiKey ?? config.apiKey ?? "test-key";

            const response = await fetch(`${model.baseUrl}/v1/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: model.id,
                    messages: context.messages,
                    tools: context.tools?.length ? context.tools : undefined,
                    stream: true,
                }),
                signal: options.signal,
            });

            if (!response.ok || !response.body) {
                yield { type: "error", error: `HTTP ${response.status}` } satisfies StreamEvent;
                return;
            }

            yield { type: "start" } satisfies StreamEvent;

            let fullText = "";
            const toolBuffers = new Map<number, { id: string; name: string; args: string }>();

            for await (const data of readSSE(response.body as ReadableStream<Uint8Array>)) {
                if (data === "[DONE]") {
                    break;
                }

                let chunk: Record<string, unknown>;
                try {
                    chunk = JSON.parse(data) as Record<string, unknown>;
                } catch {
                    continue;
                }

                const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
                if (!choices?.length) continue;

                const choice = choices[0];
                const delta = choice.delta as Record<string, unknown> | undefined;
                const finishReason = choice.finish_reason as string | null;

                // ── Text delta ───────────────────────────────────────────────────────
                if (typeof delta?.content === "string" && delta.content) {
                    fullText += delta.content;
                    yield { type: "text_delta", delta: delta.content } satisfies StreamEvent;
                }

                // ── Tool call streaming ──────────────────────────────────────────────
                if (Array.isArray(delta?.tool_calls)) {
                    for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
                        const idx = tc.index as number;
                        const fn = tc.function as Record<string, string> | undefined;

                        if (!toolBuffers.has(idx)) {
                            toolBuffers.set(idx, {
                                id: (tc.id as string) ?? `call_${idx}`,
                                name: fn?.name ?? "",
                                args: "",
                            });
                            yield { type: "toolcall_start" } satisfies StreamEvent;
                        }

                        const buf = toolBuffers.get(idx)!;
                        if (fn?.name && !buf.name) buf.name = fn.name;
                        if (fn?.arguments) {
                            buf.args += fn.arguments;
                            yield { type: "toolcall_delta", delta: fn.arguments } satisfies StreamEvent;
                        }
                    }
                }

                // ── Finish reasons ───────────────────────────────────────────────────
                if (finishReason === "stop") {
                    if (fullText) {
                        yield { type: "text_end", content: fullText } satisfies StreamEvent;
                    }
                    yield { type: "done", stopReason: "stop" } satisfies StreamEvent;
                    return;
                }

                if (finishReason === "tool_calls") {
                    for (const buf of toolBuffers.values()) {
                        yield {
                            type: "toolcall_end",
                            toolCall: {
                                id: buf.id,
                                name: buf.name,
                                arguments: JSON.parse(buf.args) as Record<string, unknown>,
                            },
                        } satisfies StreamEvent;
                    }
                    yield { type: "done", stopReason: "toolUse" } satisfies StreamEvent;
                    return;
                }
            }

            // Fallback if [DONE] was reached before a finish_reason
            yield { type: "done", stopReason: "stop" } satisfies StreamEvent;
        },
    });

    // ── Register a simple custom tool ────────────────────────────────────────
    ct.tools.register({
        name: "echo",
        description: "Echoes the input back to the caller.",
        parameters: {
            type: "object",
            properties: {
                message: { type: "string", description: "The message to echo." },
            },
            required: ["message"],
        },
        execute: async (_id, params) => jsonResult({ echo: params.message }),
    });

    // ── query() ──────────────────────────────────────────────────────────────

    return {
        ct,
        model,

        async query(prompt: string, signal?: AbortSignal): Promise<AppResult> {
            const connector = ct.connectors.getByProvider("mock")!;
            const auth = resolveAuth("mock", ["MOCK_API_KEY"], config.apiKey);

            const tools = ct.tools.resolveAll();
            const context = {
                messages: [{ role: "user", content: prompt }] as Array<Record<string, unknown>>,
                tools: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.parameters,
                })),
            };

            const events: StreamEvent[] = [];
            const toolCalls: AppResult["toolCalls"] = [];

            for await (const event of connector.stream(model, context, {
                apiKey: auth?.apiKey,
                signal,
            })) {
                events.push(event);
                if (event.type === "toolcall_end") {
                    toolCalls.push({
                        id: event.toolCall.id,
                        name: event.toolCall.name,
                        args: event.toolCall.arguments,
                    });
                }
            }

            const textEnd = events.find((e) => e.type === "text_end") as
                | { type: "text_end"; content: string }
                | undefined;

            return {
                events,
                text: textEnd?.content ?? "",
                toolCalls,
                toolCount: ct.tools.size,
            };
        },
    };
}

// =============================================================================
// Internal: SSE reader
// =============================================================================

async function* readSSE(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    yield line.slice(6).trim();
                }
            }
        }

        // Flush remaining buffer
        for (const line of buffer.split("\n")) {
            if (line.startsWith("data: ")) {
                yield line.slice(6).trim();
            }
        }
    } finally {
        reader.releaseLock();
    }
}
