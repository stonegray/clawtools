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
    input_schema: Record<string, unknown>;
} {
    return {
        name: tool.name,
        description: tool.description,
        input_schema: normalizeSchema(tool.parameters),
    };
}

/**
 * Keywords meaningful only for specific primitive/array types that must not
 * bleed into a wrapping object schema.
 */
const NON_OBJECT_KEYWORDS = new Set([
    // string-specific
    "minLength", "maxLength", "pattern", "format",
    // number-specific
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    // array-specific
    "minItems", "maxItems", "uniqueItems", "items",
]);

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
        // Strip keywords only meaningful for the original non-object type so
        // they don't pollute the wrapping object schema (issue 9).
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(s)) {
            if (!NON_OBJECT_KEYWORDS.has(key)) {
                result[key] = value;
            }
        }
        result.type = "object";
        // Guard against non-object `properties` values such as `true` (issue 10).
        const props = s.properties;
        result.properties =
            typeof props === "object" && props !== null && !Array.isArray(props)
                ? (props as Record<string, unknown>)
                : {};
        return result;
    }

    // Return a shallow copy so callers cannot mutate the stored schema in place
    // (issue 8).
    return { ...s };
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
 * @param providerOrApi - Optional provider name **or** API transport string for
 *   provider-specific schema cleaning. Accepts either `connector.provider`
 *   (e.g. `"google"`) or `connector.api` (e.g. `"google-generative-ai"`,
 *   `"google-gemini-cli"`, `"google-vertex"`). When either matches a known Google transport, Gemini-
 *   incompatible JSON Schema keywords are stripped from the schemas.
 * @returns Array of tool schema objects.
 */
export function extractToolSchemas(
    tools: Tool[],
    providerOrApi?: string,
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    return tools.map((tool) => {
        const schema = extractToolSchema(tool);
        if (
            providerOrApi &&
            (providerOrApi === "google" ||
                providerOrApi === "google-generative-ai" ||
                providerOrApi === "google-gemini-cli" ||
                providerOrApi === "google-vertex")
        ) {
            return {
                ...schema,
                input_schema: cleanSchemaForGemini(
                    schema.input_schema,
                ),
            };
        }
        return schema;
    });
}
