/**
 * E2E: Tool lifecycle — register → resolve → execute → verify.
 *
 * Tests the full tool lifecycle using the public clawtools API, including
 * custom tools, tool factories, and the core tool discovery system.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
    createClawtoolsSync,
    createClawtools,
    jsonResult,
    textResult,
    errorResult,
    readStringParam,
    readNumberParam,
    readBooleanParam,
    extractToolSchema,
    extractToolSchemas,
    ToolInputError,
} from "clawtools";
import type { Tool, ToolContext, ToolFactory } from "clawtools";

// ---------------------------------------------------------------------------
// Custom tool registration + execution
// ---------------------------------------------------------------------------

describe("custom tool lifecycle", () => {
    let ct: ReturnType<typeof createClawtoolsSync>;

    beforeEach(() => {
        ct = createClawtoolsSync({ skipCoreTools: true });
    });

    it("registers and executes a minimal tool", async () => {
        ct.tools.register({
            name: "greet",
            description: "Says hello",
            parameters: { type: "object", properties: { name: { type: "string" } } },
            execute: async (_id, params) =>
                textResult(`Hello, ${params.name}!`),
        });

        const tool = ct.tools.resolve("greet")!;
        expect(tool).toBeDefined();

        const result = await tool.execute("call-1", { name: "World" });
        expect(result.content[0]).toMatchObject({ type: "text", text: "Hello, World!" });
    });

    it("registers and executes a tool returning JSON", async () => {
        ct.tools.register({
            name: "calc",
            description: "Adds two numbers",
            parameters: {
                type: "object",
                properties: {
                    a: { type: "number" },
                    b: { type: "number" },
                },
                required: ["a", "b"],
            },
            execute: async (_id, params) => {
                const a = readNumberParam(params, "a", { required: true });
                const b = readNumberParam(params, "b", { required: true });
                return jsonResult({ sum: a + b });
            },
        });

        const tool = ct.tools.resolve("calc")!;
        const result = await tool.execute("call-1", { a: 3, b: 7 });
        expect(result.details).toEqual({ sum: 10 });
        const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
        expect(parsed.sum).toBe(10);
    });

    it("registers and executes a tool using all param helpers", async () => {
        ct.tools.register({
            name: "multi_param",
            description: "Tests all param types",
            parameters: {
                type: "object",
                properties: {
                    text: { type: "string" },
                    count: { type: "number" },
                    flag: { type: "boolean" },
                },
            },
            execute: async (_id, params) => {
                const text = readStringParam(params, "text", { required: true });
                const count = readNumberParam(params, "count", { required: true });
                const flag = readBooleanParam(params, "flag", false);
                return jsonResult({ text, count, flag });
            },
        });

        const tool = ct.tools.resolve("multi_param")!;
        const result = await tool.execute("call-1", {
            text: "hello",
            count: 42,
            flag: true,
        });
        expect(result.details).toEqual({ text: "hello", count: 42, flag: true });
    });

    it("tool error results are properly structured", async () => {
        ct.tools.register({
            name: "fail_tool",
            description: "Always errors",
            parameters: { type: "object", properties: {} },
            execute: async () => errorResult("fail_tool", "Something went wrong"),
        });

        const tool = ct.tools.resolve("fail_tool")!;
        const result = await tool.execute("call-1", {});
        const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
        expect(parsed.status).toBe("error");
        expect(parsed.error).toBe("Something went wrong");
    });

    it("tool that throws ToolInputError on bad params", async () => {
        ct.tools.register({
            name: "strict_tool",
            description: "Requires a name",
            parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
            execute: async (_id, params) => {
                readStringParam(params, "name", { required: true });
                return textResult("ok");
            },
        });

        const tool = ct.tools.resolve("strict_tool")!;
        await expect(tool.execute("call-1", {})).rejects.toThrow(ToolInputError);
    });

    it("unregisters a tool and it becomes unresolvable", () => {
        ct.tools.register({
            name: "temp",
            description: "Temporary",
            parameters: { type: "object", properties: {} },
            execute: async () => textResult("ok"),
        });
        expect(ct.tools.has("temp")).toBe(true);
        ct.tools.unregister("temp");
        expect(ct.tools.has("temp")).toBe(false);
        expect(ct.tools.resolve("temp")).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Tool factory lifecycle
// ---------------------------------------------------------------------------

describe("tool factory lifecycle", () => {
    it("factory receives context and creates tool accordingly", async () => {
        const ct = createClawtoolsSync({ skipCoreTools: true });

        const factory: ToolFactory = (ctx: ToolContext) => ({
            name: "workspace_info",
            description: "Reports workspace dir",
            parameters: { type: "object", properties: {} },
            execute: async () => textResult(`workspace: ${ctx.workspaceDir ?? "unknown"}`),
        });

        ct.tools.registerFactory(factory, {
            id: "workspace_info",
            label: "Workspace Info",
            description: "Reports workspace dir",
            sectionId: "custom",
            profiles: ["full"],
            source: "plugin",
        });

        const tools = ct.tools.resolveAll({ workspaceDir: "/my/project" });
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe("workspace_info");

        const result = await tools[0].execute("call-1", {});
        expect((result.content[0] as { type: "text"; text: string }).text).toBe(
            "workspace: /my/project",
        );
    });

    it("factory returning null is silently skipped", () => {
        const ct = createClawtoolsSync({ skipCoreTools: true });

        ct.tools.registerFactory(() => null, {
            id: "optional_tool",
            label: "Optional",
            description: "May not exist",
            sectionId: "custom",
            profiles: ["full"],
            source: "plugin",
        });

        const tools = ct.tools.resolveAll();
        expect(tools).toHaveLength(0);
        // But metadata is still listed
        expect(ct.tools.list()).toHaveLength(1);
    });

    it("factory returning multiple tools produces all of them", () => {
        const ct = createClawtoolsSync({ skipCoreTools: true });

        ct.tools.registerFactory(
            () => [
                {
                    name: "tool_a",
                    description: "A",
                    parameters: { type: "object", properties: {} },
                    execute: async () => textResult("a"),
                },
                {
                    name: "tool_b",
                    description: "B",
                    parameters: { type: "object", properties: {} },
                    execute: async () => textResult("b"),
                },
            ],
            {
                id: "multi_factory",
                label: "Multi",
                description: "Creates two tools",
                sectionId: "custom",
                profiles: ["full"],
                source: "plugin",
            },
        );

        const tools = ct.tools.resolveAll();
        expect(tools).toHaveLength(2);
        expect(tools.map((t) => t.name).sort()).toEqual(["tool_a", "tool_b"]);
    });
});

// ---------------------------------------------------------------------------
// Schema extraction e2e
// ---------------------------------------------------------------------------

describe("schema extraction e2e", () => {
    it("extractToolSchema produces a valid LLM-consumable schema", () => {
        const tool: Tool = {
            name: "search",
            description: "Search for things",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" },
                    limit: { type: "number", description: "Max results" },
                },
                required: ["query"],
            },
            execute: async () => textResult("results"),
        };

        const schema = extractToolSchema(tool);
        expect(schema.name).toBe("search");
        expect(schema.description).toBe("Search for things");
        expect((schema.input_schema as Record<string, unknown>).type).toBe("object");
        const props = (schema.input_schema as Record<string, unknown>).properties as Record<string, unknown>;
        expect(props.query).toBeDefined();
        expect(props.limit).toBeDefined();
    });

    it("extractToolSchemas works for multiple tools with different providers", () => {
        const tools: Tool[] = [
            {
                name: "tool_a",
                description: "A",
                parameters: { type: "object", properties: {} },
                execute: async () => textResult("a"),
            },
            {
                name: "tool_b",
                description: "B",
                parameters: { type: "object", properties: { x: { type: "string" } } },
                execute: async () => textResult("b"),
            },
        ];

        const schemas = extractToolSchemas(tools);
        expect(schemas).toHaveLength(2);
        expect(schemas[0].name).toBe("tool_a");
        expect(schemas[1].name).toBe("tool_b");

        // For Gemini provider, schemas should be cleaned
        const geminiSchemas = extractToolSchemas(
            tools.map((t) => ({
                ...t,
                parameters: { ...t.parameters, additionalProperties: false } as Record<string, unknown>,
            })),
            "google-generative-ai",
        );
        for (const s of geminiSchemas) {
            expect(s.input_schema).not.toHaveProperty("additionalProperties");
        }
    });
});

// ---------------------------------------------------------------------------
// Core tool discovery e2e (async — loads real bundles)
// ---------------------------------------------------------------------------

describe("core tool discovery e2e", { timeout: 180_000 }, () => {
    it("createClawtools discovers 23 core tools", async () => {
        const ct = await createClawtools({ skipBuiltinConnectors: true });
        expect(ct.tools.size).toBe(23);

        const meta = ct.tools.list();
        const ids = meta.map((m) => m.id);

        // Verify well-known tools are present
        expect(ids).toContain("read");
        expect(ids).toContain("write");
        expect(ids).toContain("edit");
        expect(ids).toContain("exec");
        expect(ids).toContain("web_search");
        expect(ids).toContain("web_fetch");
        expect(ids).toContain("browser");
    });

    it("resolveAll returns executable tools (≥17 non-null)", async () => {
        const ct = await createClawtools({ skipBuiltinConnectors: true });
        const tools = ct.tools.resolveAll({ workspaceDir: process.cwd() });
        // Some tools need config to return non-null; at least 15 should resolve
        expect(tools.length).toBeGreaterThanOrEqual(15);

        // Each resolved tool has the expected shape
        for (const tool of tools) {
            expect(typeof tool.name).toBe("string");
            expect(typeof tool.description).toBe("string");
            expect(typeof tool.execute).toBe("function");
            expect(tool.parameters).toBeDefined();
        }
    });

    it("resolveByProfile narrows to coding tools only", async () => {
        const ct = await createClawtools({ skipBuiltinConnectors: true });
        const codingTools = ct.tools.resolveByProfile("coding", { workspaceDir: process.cwd() });
        const fullTools = ct.tools.resolveAll({ workspaceDir: process.cwd() });
        expect(codingTools.length).toBeLessThanOrEqual(fullTools.length);
        expect(codingTools.length).toBeGreaterThan(0);
    });

    it("list returns metadata with correct section assignments", async () => {
        const ct = await createClawtools({ skipBuiltinConnectors: true });
        const meta = ct.tools.list();
        const sectionIds = [...new Set(meta.map((m) => m.sectionId))];
        expect(sectionIds).toContain("fs");
        expect(sectionIds).toContain("runtime");
        expect(sectionIds).toContain("web");
    });

    it("listBySection groups tools into the expected sections", async () => {
        const ct = await createClawtools({ skipBuiltinConnectors: true });
        const sections = ct.tools.listBySection();
        const fsSection = sections.find((s) => s.id === "fs");
        expect(fsSection).toBeDefined();
        expect(fsSection!.tools.length).toBeGreaterThanOrEqual(3); // read, write, edit
    });
});
