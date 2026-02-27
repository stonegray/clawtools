import { describe, it, expect } from "vitest";
import {
    extractToolSchema,
    extractToolSchemas,
    normalizeSchema,
    cleanSchemaForGemini,
} from "clawtools/tools";
import { echoTool, fullTool } from "../../helpers/index.js";

describe("Schema utilities", () => {
    // ---------------------------------------------------------------------------
    // extractToolSchema
    // ---------------------------------------------------------------------------

    describe("extractToolSchema", () => {
        it("returns name, description, input_schema", () => {
            const s = extractToolSchema(echoTool);
            expect(s.name).toBe("echo");
            expect(s.description).toBe(echoTool.description);
            expect(s.input_schema).toBeDefined();
        });

        it("normalizes the schema so type is always object", () => {
            const s = extractToolSchema(echoTool);
            expect((s.input_schema as Record<string, unknown>).type).toBe("object");
        });

        it("preserves the tool's properties in input_schema", () => {
            const s = extractToolSchema(echoTool);
            const props = (s.input_schema as Record<string, unknown>).properties as Record<
                string,
                unknown
            >;
            expect(props.message).toBeDefined();
        });
    });

    // ---------------------------------------------------------------------------
    // extractToolSchemas
    // ---------------------------------------------------------------------------

    describe("extractToolSchemas", () => {
        it("returns one schema per tool", () => {
            expect(extractToolSchemas([echoTool, fullTool])).toHaveLength(2);
        });

        it("auto-applies Gemini cleaning for google provider", () => {
            const toolWithExtras: typeof echoTool = {
                ...echoTool,
                parameters: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                    $schema: "http://json-schema.org/draft-07/schema",
                } as Record<string, unknown>,
            };
            const [schema] = extractToolSchemas([toolWithExtras], "google-generative-ai");
            const input = schema.input_schema as Record<string, unknown>;
            expect(input).not.toHaveProperty("additionalProperties");
            expect(input).not.toHaveProperty("$schema");
        });

        it("does NOT strip for non-google providers", () => {
            const toolWithExtras: typeof echoTool = {
                ...echoTool,
                parameters: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                } as Record<string, unknown>,
            };
            const [schema] = extractToolSchemas([toolWithExtras], "anthropic");
            const input = schema.input_schema as Record<string, unknown>;
            expect(input).toHaveProperty("additionalProperties");
        });
    });

    // ---------------------------------------------------------------------------
    // normalizeSchema
    // ---------------------------------------------------------------------------

    describe("normalizeSchema", () => {
        it("returns a valid object schema unchanged", () => {
            const s = { type: "object", properties: { x: { type: "string" } } };
            expect(normalizeSchema(s)).toMatchObject({ type: "object" });
        });

        it("wraps a non-object schema in an object wrapper", () => {
            expect(normalizeSchema({ type: "string" }).type).toBe("object");
        });

        it("returns empty object schema for null", () => {
            expect(normalizeSchema(null)).toEqual({ type: "object", properties: {} });
        });

        it("returns empty object schema for undefined", () => {
            expect(normalizeSchema(undefined)).toEqual({ type: "object", properties: {} });
        });

        it("returns empty object schema for non-object primitive", () => {
            expect(normalizeSchema("bad")).toEqual({ type: "object", properties: {} });
        });
    });

    // ---------------------------------------------------------------------------
    // cleanSchemaForGemini
    // ---------------------------------------------------------------------------

    describe("cleanSchemaForGemini", () => {
        it("strips additionalProperties", () => {
            const s = { type: "object", properties: {}, additionalProperties: false };
            expect(cleanSchemaForGemini(s)).not.toHaveProperty("additionalProperties");
        });

        it("strips $schema", () => {
            const s = {
                type: "object",
                properties: {},
                $schema: "http://json-schema.org/draft-07/schema",
            };
            expect(cleanSchemaForGemini(s)).not.toHaveProperty("$schema");
        });

        it("strips minLength and maxLength", () => {
            const s = { type: "object", properties: {}, minLength: 1, maxLength: 100 };
            const cleaned = cleanSchemaForGemini(s);
            expect(cleaned).not.toHaveProperty("minLength");
            expect(cleaned).not.toHaveProperty("maxLength");
        });

        it("keeps supported keywords (type, properties, required, description)", () => {
            const s = {
                type: "object",
                properties: { x: { type: "string" } },
                required: ["x"],
                description: "a schema",
            };
            const cleaned = cleanSchemaForGemini(s);
            expect(cleaned).toHaveProperty("type");
            expect(cleaned).toHaveProperty("properties");
            expect(cleaned).toHaveProperty("required");
            expect(cleaned).toHaveProperty("description");
        });

        it("recursively cleans nested property schemas", () => {
            const s = {
                type: "object",
                properties: {
                    child: {
                        type: "string",
                        additionalProperties: true,
                        minLength: 1,
                    },
                },
            };
            const cleaned = cleanSchemaForGemini(s);
            const childProp = (cleaned.properties as Record<string, unknown>).child as Record<
                string,
                unknown
            >;
            expect(childProp).not.toHaveProperty("additionalProperties");
            expect(childProp).not.toHaveProperty("minLength");
            expect(childProp).toHaveProperty("type", "string");
        });

        it("recursively cleans array item schemas", () => {
            const s = {
                type: "object",
                properties: {
                    tags: {
                        type: "array",
                        items: { type: "string", minLength: 1 },
                    },
                },
            };
            const cleaned = cleanSchemaForGemini(s);
            const tagProp = (cleaned.properties as Record<string, unknown>).tags as Record<
                string,
                unknown
            >;
            const items = tagProp.items as Record<string, unknown>;
            expect(items).not.toHaveProperty("minLength");
        });
    });
});
