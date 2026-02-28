/**
 * pi-ai bridge — wraps @mariozechner/pi-ai provider implementations as
 * clawtools Connector objects.
 *
 * This module is **not imported at runtime directly**. It is compiled and
 * bundled at build time (via `scripts/bundle-core-connectors.mjs`) into
 * `dist/core-connectors/builtins.js` with all provider SDKs and pi-ai code
 * inlined. At runtime, `discoverBuiltinConnectors()` dynamically imports
 * that bundle.
 *
 * ## Event mapping
 *
 * pi-ai `AssistantMessageEvent` → clawtools `StreamEvent`:
 *
 * | pi-ai                    | clawtools              |
 * |--------------------------|------------------------|
 * | start                    | start                  |
 * | text_start               | (skipped — no content) |
 * | text_delta               | text_delta             |
 * | text_end                 | text_end               |
 * | thinking_start           | (skipped — no content) |
 * | thinking_delta           | thinking_delta         |
 * | thinking_end             | thinking_end           |
 * | toolcall_start           | toolcall_start (+ id?) |
 * | toolcall_delta           | toolcall_delta         |
 * | toolcall_end             | toolcall_end           |
 * | done                     | done (with usage)      |
 * | error                    | error                  |
 *
 * @module
 */

import { stream as piStream, getProviders, getModels } from "@mariozechner/pi-ai";
import type { AssistantMessageEvent, Model, Api } from "@mariozechner/pi-ai";
import type { Connector, StreamContext, StreamEvent } from "../types.js";
import { debugConnector } from "./debug-connector.js";

// =============================================================================
// Event adapter
// =============================================================================

/**
 * Adapt an async iterable of pi-ai `AssistantMessageEvent`s into clawtools
 * `StreamEvent`s.
 *
 * `text_start` and `thinking_start` carry no content, so they are suppressed
 * — the corresponding `_delta` / `_end` events provide all the data the
 * consumer needs. `toolcall_start` is forwarded (with the optional `id` when
 * the provider makes it available at call-start time).
 */
async function* adaptEvents(
    events: AsyncIterable<AssistantMessageEvent>,
): AsyncIterable<StreamEvent> {
    for await (const ev of events) {
        switch (ev.type) {
            case "start":
                yield { type: "start" };
                break;

            case "text_delta":
                yield { type: "text_delta", delta: ev.delta };
                break;

            case "text_end":
                yield { type: "text_end", content: ev.content };
                break;

            case "thinking_delta":
                yield { type: "thinking_delta", delta: ev.delta };
                break;

            case "thinking_end":
                yield { type: "thinking_end", content: ev.content };
                break;

            case "toolcall_start": {
                // Extract the tool call id from the partial message when available.
                // The id is set on the toolCall block at content_block_start time by
                // Anthropic (and similar providers), so it is available before any deltas.
                const partialContent = ev.partial?.content;
                const toolCallBlock = Array.isArray(partialContent)
                    ? partialContent[ev.contentIndex]
                    : undefined;
                const startId =
                    toolCallBlock && "id" in toolCallBlock && typeof toolCallBlock.id === "string"
                        ? toolCallBlock.id
                        : undefined;
                yield startId !== undefined
                    ? { type: "toolcall_start", id: startId }
                    : { type: "toolcall_start" };
                break;
            }

            case "toolcall_delta": {
                // Mirror the id from toolcall_start so consumers can correlate deltas.
                const deltaContent = ev.partial?.content;
                const deltaBlock = Array.isArray(deltaContent)
                    ? deltaContent[ev.contentIndex]
                    : undefined;
                const deltaId =
                    deltaBlock && "id" in deltaBlock && typeof deltaBlock.id === "string"
                        ? deltaBlock.id
                        : undefined;
                yield deltaId !== undefined
                    ? { type: "toolcall_delta", delta: ev.delta, id: deltaId }
                    : { type: "toolcall_delta", delta: ev.delta };
                break;
            }

            case "toolcall_end":
                yield {
                    type: "toolcall_end",
                    toolCall: {
                        id: ev.toolCall.id,
                        name: ev.toolCall.name,
                        arguments: ev.toolCall.arguments,
                    },
                };
                break;

            case "done":
                yield {
                    type: "done",
                    stopReason: ev.reason,
                    usage: {
                        inputTokens: ev.message.usage.input,
                        outputTokens: ev.message.usage.output,
                    },
                };
                break;

            case "error":
                if (ev.error === undefined) {
                    console.warn(
                        "[clawtools] pi-ai-bridge: received error event with unexpected shape (ev.error is undefined)",
                        ev,
                    );
                }
                yield {
                    type: "error",
                    error: ev.error?.errorMessage ?? `LLM provider error (${ev.reason})`,
                };
                break;

            // Suppress no-content marker events: text_start, thinking_start
            default:
                break;
        }
    }
}

// =============================================================================
// Type converters
// =============================================================================

/**
 * Convert a pi-ai `Model` to a clawtools `ModelDescriptor`.
 * All pi-ai Model fields map 1:1 to ModelDescriptor fields.
 */
function toDescriptor(m: Model<Api>): ModelDescriptor {
    return {
        id: m.id,
        name: m.name,
        api: m.api,
        provider: m.provider,
        baseUrl: m.baseUrl,
        reasoning: m.reasoning,
        input: m.input,
        cost: m.cost,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        headers: m.headers,
        compat: m.compat as Record<string, unknown> | undefined,
    };
}

/**
 * Coerce a clawtools `ModelDescriptor` back to a pi-ai `Model`.
 *
 * For built-in connectors the caller always passes a descriptor that was
 * originally returned by `connector.models`, so the fields are complete. The
 * defaults below only guard against callers constructing a ModelDescriptor
 * manually with minimal fields.
 */
function toModel(desc: ModelDescriptor): Model<Api> {
    return {
        id: desc.id,
        name: desc.name ?? desc.id,
        api: desc.api,
        provider: desc.provider,
        baseUrl: desc.baseUrl ?? "",
        reasoning: desc.reasoning ?? false,
        input: desc.input ?? ["text"],
        cost: desc.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: desc.contextWindow ?? 200_000,
        maxTokens: desc.maxTokens ?? 8_192,
        headers: desc.headers,
        compat: desc.compat as Model<Api>["compat"],
    };
}

/**
 * Convert a clawtools `StreamContext` to a pi-ai `Context`.
 *
 * - `messages` is passed through as-is (clawtools declares them as
 *   `Record<string, unknown>[]` for forward-compatibility; they must match
 *   pi-ai's Message union at runtime).
 * - `tools` renames `input_schema` → `parameters` to match pi-ai's Tool type.
 */
function toContext(ctx: StreamContext): {
    systemPrompt?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[];
    tools?: Array<{ name: string; description: string; parameters: unknown }>;
} {
    // Issue 16: runtime shape check — every message must have a string `role`.
    for (let i = 0; i < ctx.messages.length; i++) {
        const msg = ctx.messages[i];
        if (
            msg === null ||
            typeof msg !== "object" ||
            typeof (msg as Record<string, unknown>)["role"] !== "string"
        ) {
            throw new TypeError(
                `[clawtools] pi-ai-bridge: message at index ${i} is missing a required string 'role' field`,
            );
        }
    }

    return {
        systemPrompt: ctx.systemPrompt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: ctx.messages as any[],
        tools: ctx.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
        })),
    };
}

// =============================================================================
// Connector factory
// =============================================================================

/**
 * Build a single `Connector` for one pi-ai provider.
 *
 * The connector pre-builds a model map (id → pi-ai Model) so `stream()`
 * can look up the full pi-ai Model by ID, avoiding partial reconstruction
 * from a ModelDescriptor.
 */
function buildConnector(provider: string): Connector {
    const piModels = getModels(provider as Parameters<typeof getModels>[0]);
    if (piModels.length === 0) {
        console.warn(
            `[clawtools] Pi-ai connector: provider '${provider}' has no models defined`,
        );
    }
    const modelMap = new Map<string, Model<Api>>(piModels.map((m) => [m.id, m]));

    return {
        id: `builtin/${provider}`,
        label: provider
            .split("-")
            .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
            .join(" "),
        provider,
        // Use the API transport of the first model as the connector's primary API.
        // (All models for a given provider generally share the same transport.)
        api: piModels[0]?.api ?? "openai-completions",
        models: piModels.map(toDescriptor),

        async *stream(model, context, options) {
            // Prefer the fully-typed pi-ai Model when the caller passes back
            // one of our own descriptors; fall back to reconstructing from
            // the descriptor when a custom or synthesised model is used.
            const piModel = modelMap.get(model.id) ?? toModel(model);
            const piContext = toContext(context);

            yield* adaptEvents(
                piStream(
                    piModel,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    piContext as any,
                    options as Parameters<typeof piStream>[2],
                ),
            );
        },
    };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Return built-in connectors backed by `@mariozechner/pi-ai` provider
 * implementations.
 *
 * One `Connector` is created per provider in the pi-ai model catalog (e.g.
 * `anthropic`, `openai`, `google`, `amazon-bedrock`, …). Each connector
 * exposes the full model list and a working `stream()` function.
 *
 * @returns Array of connectors — one per pi-ai provider.
 */
export function getBuiltinConnectors(): Connector[] {
    return [...getProviders().map(buildConnector), debugConnector];
}
