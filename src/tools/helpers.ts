/**
 * Tool result helpers — convenience functions for creating tool results.
 *
 * Reimplemented from OpenClaw's `common.ts` helpers.
 * Original source: openclaw/src/agents/tools/common.ts (MIT license)
 *
 * @module
 */

import type { ContentBlock, ToolResult } from "../types.js";

/**
 * Create a tool result containing JSON text.
 *
 * This is the most common pattern for tool results — the payload is
 * serialized as pretty-printed JSON.
 *
 * @param payload - Any JSON-serializable value.
 * @returns A ToolResult with the payload as formatted JSON text.
 */
export function jsonResult(payload: unknown): ToolResult<unknown> {
    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
    };
}

/**
 * Create a tool result containing plain text.
 *
 * @param text - The text content.
 * @param details - Optional structured details.
 * @returns A ToolResult with the text content.
 */
export function textResult(text: string, details?: unknown): ToolResult<unknown> {
    return {
        content: [{ type: "text", text }],
        details,
    };
}

/**
 * Create a tool result containing an error.
 *
 * Error results follow OpenClaw's convention of returning a JSON object
 * with `status: "error"` so the LLM can distinguish errors from normal results.
 *
 * @param toolName - The tool that produced the error.
 * @param error - Error message or description.
 * @returns A ToolResult formatted as an error.
 */
export function errorResult(toolName: string, error: string): ToolResult<unknown> {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ status: "error", tool: toolName, error }),
            },
        ],
        details: { status: "error", tool: toolName, error },
    };
}

/**
 * Create a tool result containing an image.
 *
 * @param params - Image parameters.
 * @returns A ToolResult with both text and image content blocks.
 */
export function imageResult(params: {
    label: string;
    base64: string;
    mimeType: string;
    path?: string;
    extraText?: string;
    details?: Record<string, unknown>;
}): ToolResult<unknown> {
    const content: ContentBlock[] = [];

    if (params.path) {
        content.push({ type: "text", text: `MEDIA:${params.path}` });
    }
    if (params.extraText) {
        content.push({ type: "text", text: params.extraText });
    }

    content.push({
        type: "image",
        data: params.base64,
        mimeType: params.mimeType,
    });

    return {
        content,
        details: params.details ?? { label: params.label, path: params.path },
    };
}
