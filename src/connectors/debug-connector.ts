/**
 * debug-connector.ts — clawtools Connector implementation for the
 * "clawfice-debug" provider.
 *
 * Provides 8 deterministic test models that produce known, predictable
 * responses without calling any real LLM API. All logic is self-contained
 * with no external dependencies.
 *
 * This connector is included in the built-in connector catalog returned by
 * {@link getBuiltinConnectors} so that `discoverBuiltinConnectorsAsync()`
 * surfaces it alongside the pi-ai providers.
 *
 * @module
 */

import type {
    Connector,
    ModelDescriptor,
    StreamContext,
    StreamEvent,
    StreamOptions,
    UserMessage,
} from "../types.js";

// =============================================================================
// Constants
// =============================================================================

export const DEBUG_PROVIDER_ID = "clawfice-debug";

const DEBUG_API = "clawfice-debug";
const DEBUG_BASE_URL = "local://clawfice-debug";

const CANNED_RESPONSES = [
    "I understand your request. Let me help you with that.",
    "That's a great question. Based on my analysis, here's what I think.",
    "I've processed your input and here's my response.",
    "Thank you for the information. Here's what I can tell you.",
    "I'm working on your request. Here are my findings.",
] as const;

const THINKING_STEPS = [
    "Let me analyze this request carefully...\n",
    "Breaking down the key components:\n",
    "1. Understanding the user's intent\n",
    "2. Considering relevant context\n",
    "3. Formulating a structured response\n",
    "\nI should address the main points clearly and provide actionable information.\n",
] as const;

// =============================================================================
// Model catalog
// =============================================================================

function makeModel(id: string, name: string, reasoning = false): ModelDescriptor {
    return {
        id,
        name,
        api: DEBUG_API,
        provider: DEBUG_PROVIDER_ID,
        baseUrl: DEBUG_BASE_URL,
        reasoning,
        input: ["text"],
        contextWindow: 100_000,
        maxTokens: 16_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
}

const DEBUG_MODELS: ModelDescriptor[] = [
    makeModel("dummy-echo-1", "Dummy Echo"),
    makeModel("sys-echo-1", "System Prompt Mirror"),
    makeModel("parrot-1", "Parrot (Verbatim Echo)"),
    makeModel("silent-1", "Silent (No Reply)"),
    makeModel("upper-parrot-1", "Uppercase Parrot"),
    makeModel("tagged-parrot-1", "Tagged Parrot (Relay)"),
    makeModel("inspect-echo-1", "Inspect Echo"),
    makeModel("thinking-stream-1", "Thinking Stream", true),
];

// =============================================================================
// Helpers
// =============================================================================

/** Extract the plain-text content from a UserMessage content field. */
function extractUserText(content: UserMessage["content"]): string {
    if (typeof content === "string") return content;
    for (const block of content) {
        if (block.type === "text") {
            const t = block["text"];
            if (typeof t === "string") return t;
        }
    }
    return "";
}

/** Return the text of the last user turn in the context, or a placeholder. */
function lastUserText(ctx: StreamContext): string {
    for (let i = ctx.messages.length - 1; i >= 0; i--) {
        const msg = ctx.messages[i];
        if (msg !== undefined && msg.role === "user") {
            return extractUserText(msg.content);
        }
    }
    return "(no message)";
}

/** Rough token estimate for the whole context (4 chars ≈ 1 token). */
function roughInputTokens(ctx: StreamContext): number {
    const chars =
        (ctx.systemPrompt?.length ?? 0) +
        JSON.stringify(ctx.messages).length;
    return Math.ceil(chars / 4);
}

// =============================================================================
// Stream generators
// =============================================================================

async function* textResponse(
    text: string,
    inputTok: number,
): AsyncGenerator<StreamEvent> {
    yield { type: "start" };
    yield { type: "text_delta", delta: text };
    yield { type: "text_end", content: text };
    yield {
        type: "done",
        stopReason: "stop",
        usage: {
            inputTokens: inputTok,
            outputTokens: Math.ceil(text.length / 4),
        },
    };
}

async function* thinkingResponse(
    ctx: StreamContext,
    inputTok: number,
): AsyncGenerator<StreamEvent> {
    const userContent = lastUserText(ctx);

    const thinkingParts: string[] = [
        ...THINKING_STEPS,
        `The user asked: "${userContent}"\n`,
        `My system instructions say: ${ctx.systemPrompt
            ? `"${ctx.systemPrompt.slice(0, 80)}..."`
            : "(none)"
        }\n`,
    ];
    const thinkingContent = thinkingParts.join("");

    const answerParts = [
        "Based on my analysis, here is my response.\n\n",
        `You said: "${userContent}"\n\n`,
        "I've considered this carefully and here are my thoughts.",
    ];
    const answerContent = answerParts.join("");

    yield { type: "start" };

    for (const chunk of thinkingParts) {
        yield { type: "thinking_delta", delta: chunk };
    }
    yield { type: "thinking_end", content: thinkingContent };

    for (const chunk of answerParts) {
        yield { type: "text_delta", delta: chunk };
    }
    yield { type: "text_end", content: answerContent };

    yield {
        type: "done",
        stopReason: "stop",
        usage: {
            inputTokens: inputTok,
            outputTokens: Math.ceil(
                (thinkingContent.length + answerContent.length) / 4,
            ),
        },
    };
}

// =============================================================================
// Main stream dispatcher
// =============================================================================

function streamDebug(
    model: ModelDescriptor,
    ctx: StreamContext,
    _opts: StreamOptions,
): AsyncIterable<StreamEvent> {
    const inputTok = roughInputTokens(ctx);
    const lastUser = lastUserText(ctx);

    switch (model.id) {
        case "sys-echo-1": {
            const sys = ctx.systemPrompt?.trim() ?? "(no system prompt)";
            const toolsSection =
                ctx.tools && ctx.tools.length > 0
                    ? ctx.tools
                        .map((t) => `  • ${t.name} — ${t.description}`)
                        .join("\n")
                    : "(no tools assigned)";
            const text = [
                `[sys-echo] My system prompt is:\n\n${sys}`,
                `\n[sys-echo] My available tools (${ctx.tools?.length ?? 0}):\n\n${toolsSection}`,
            ].join("");
            return textResponse(text, inputTok);
        }

        case "parrot-1":
            return textResponse(lastUser, inputTok);

        case "silent-1":
            return textResponse("(silent)", 0);

        case "upper-parrot-1":
            return textResponse(lastUser.toUpperCase(), inputTok);

        case "tagged-parrot-1":
            return textResponse(`[relay] ${lastUser}`, inputTok);

        case "inspect-echo-1": {
            const lines = [
                `[inspect] messages: ${ctx.messages.length}`,
                `[inspect] last_user: ${lastUser}`,
                `[inspect] tools: ${ctx.tools?.map((t) => t.name).join(", ") ?? "(none)"}`,
                `[inspect] has_system_prompt: ${ctx.systemPrompt ? "yes" : "no"}`,
            ];
            return textResponse(lines.join("\n"), inputTok);
        }

        case "thinking-stream-1":
            return thinkingResponse(ctx, inputTok);

        case "dummy-echo-1":
        default: {
            // Deterministic canned response keyed by a simple hash of the input
            let hash = 0;
            for (let i = 0; i < lastUser.length; i++) {
                hash = ((hash << 5) - hash + lastUser.charCodeAt(i)) | 0;
            }
            const idx = Math.abs(hash) % CANNED_RESPONSES.length;
            const text = `${CANNED_RESPONSES[idx]}\n\nYou said: "${lastUser}"`;
            return textResponse(text, inputTok);
        }
    }
}

// =============================================================================
// Exported connector
// =============================================================================

/**
 * The clawfice-debug connector — deterministic LLM test backend.
 *
 * Provides 8 mock models for integration testing without real API keys.
 * Included in the built-in connector catalog by {@link getBuiltinConnectors}.
 */
export const debugConnector: Connector = {
    id: `builtin/${DEBUG_PROVIDER_ID}`,
    label: "Clawfice Debug Providers",
    provider: DEBUG_PROVIDER_ID,
    api: DEBUG_API,
    models: DEBUG_MODELS,
    envVars: [],
    stream: streamDebug,
};
