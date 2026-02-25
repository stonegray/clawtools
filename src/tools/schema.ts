/**
 * JSON Schema utilities for tool parameter definitions.
 *
 * Provides helpers for extracting and normalizing JSON Schema from tool
 * parameters, including provider-specific cleaning (e.g., Gemini).
 *
 * Reimplemented from OpenClaw's schema handling.
 * Original source: openclaw/src/agents/pi-tool-definition-adapter.ts (MIT license)
 *
 * @module
 */

import type { Tool } from "../types.js";

/**
 * Extract a JSON Schema tool definition suitable for sending to an LLM.
 *
 * @param tool - The tool to extract schema from.
 * @returns An object with name, description, and input_schema.
 */
export function extractToolSchema(tool: Tool): {
    name: string;
    description: string;
    input_schema: unknown;
} {
    return {
        name: tool.name,
        description: tool.description,
        input_schema: normalizeSchema(tool.parameters),
    };
}

/**
 * Normalize a parameter schema to ensure it's a valid JSON Schema object type.
 *
 * Ensures the root is always `type: "object"` with `properties`.
 */
export function normalizeSchema(schema: unknown): Record<string, unknown> {
    if (!schema || typeof schema !== "object") {
        return { type: "object", properties: {} };
    }

    const s = schema as Record<string, unknown>;
    if (s.type !== "object") {
        // Spread s first so its properties are preserved, then force type=object
        return { ...s, type: "object", properties: (s.properties as Record<string, unknown>) ?? {} };
    }

    return s;
}

/**
 * Keywords that Google Gemini does not support in JSON Schema.
 *
 * These are stripped before sending tool definitions to Gemini.
 *
 * Reimplemented from OpenClaw's Gemini sanitization.
 * Original source: openclaw/src/agents/pi-tool-definition-adapter.ts (MIT license)
 */
const GEMINI_UNSUPPORTED_KEYWORDS = new Set([
    "patternProperties",
    "additionalProperties",
    "$schema",
    "$id",
    "$ref",
    "$defs",
    "definitions",
    "examples",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "multipleOf",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minProperties",
    "maxProperties",
]);

/**
 * Clean a JSON Schema for Gemini compatibility by stripping unsupported keywords.
 *
 * @param schema - The schema to clean.
 * @returns A new schema with unsupported keywords removed.
 */
export function cleanSchemaForGemini(
    schema: Record<string, unknown>,
): Record<string, unknown> {
    return deepClean(schema, GEMINI_UNSUPPORTED_KEYWORDS);
}

function deepClean(
    obj: Record<string, unknown>,
    banned: Set<string>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (banned.has(key)) continue;
        if (value && typeof value === "object" && !Array.isArray(value)) {
            result[key] = deepClean(value as Record<string, unknown>, banned);
        } else if (Array.isArray(value)) {
            result[key] = value.map((item) =>
                item && typeof item === "object" && !Array.isArray(item)
                    ? deepClean(item as Record<string, unknown>, banned)
                    : item,
            );
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Extract tool schemas from an array of tools, ready for LLM submission.
 *
 * @param tools - Array of tools.
 * @param provider - Optional provider name for provider-specific cleaning.
 * @returns Array of tool schema objects.
 */
export function extractToolSchemas(
    tools: Tool[],
    provider?: string,
): Array<{ name: string; description: string; input_schema: unknown }> {
    return tools.map((tool) => {
        const schema = extractToolSchema(tool);
        if (
            provider &&
            (provider === "google" ||
                provider === "google-generative-ai" ||
                provider === "google-vertex")
        ) {
            return {
                ...schema,
                input_schema: cleanSchemaForGemini(
                    schema.input_schema as Record<string, unknown>,
                ),
            };
        }
        return schema;
    });
}
