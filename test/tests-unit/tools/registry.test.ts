import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "clawtools/tools";
import {
    echoTool,
    fullTool,
    throwingTool,
    baseContext,
    contextAwareToolFactory,
} from "../../helpers/index.js";

describe("ToolRegistry", () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    // ---------------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------------

    describe("register", () => {
        it("registers a tool", () => {
            registry.register(echoTool);
            expect(registry.has("echo")).toBe(true);
            expect(registry.size).toBe(1);
        });

        it("registers multiple tools", () => {
            registry.register(echoTool);
            registry.register(fullTool);
            expect(registry.size).toBe(2);
        });

        it("overwrites when the same name is registered again", () => {
            registry.register(echoTool);
            registry.register({ ...echoTool, description: "updated" });
            expect(registry.size).toBe(1);
            expect(registry.list()[0].description).toBe("updated");
        });

        it("derives metadata from the tool when none is provided", () => {
            registry.register(echoTool);
            const meta = registry.list()[0];
            expect(meta.id).toBe("echo");
            expect(meta.label).toBe("Echo");
            expect(meta.description).toBe(echoTool.description);
        });

        it("allows metadata overrides", () => {
            registry.register(echoTool, { sectionId: "custom-section", profiles: ["minimal"] });
            const meta = registry.list()[0];
            expect(meta.sectionId).toBe("custom-section");
            expect(meta.profiles).toContain("minimal");
        });
    });

    describe("registerFactory", () => {
        it("registers a factory", () => {
            registry.registerFactory(contextAwareToolFactory, {
                id: "context_tool",
                label: "Context Tool",
                description: "Reports context",
                sectionId: "test",
                profiles: ["full"],
                source: "core",
            });
            expect(registry.has("context_tool")).toBe(true);
            expect(registry.size).toBe(1);
        });
    });

    // ---------------------------------------------------------------------------
    // Resolution
    // ---------------------------------------------------------------------------

    describe("resolveAll", () => {
        it("returns all direct tools", () => {
            registry.register(echoTool);
            registry.register(fullTool);
            const tools = registry.resolveAll();
            expect(tools).toHaveLength(2);
        });

        it("invokes factories with the provided context", () => {
            registry.registerFactory(contextAwareToolFactory, {
                id: "context_tool",
                label: "Context Tool",
                description: "",
                sectionId: "test",
                profiles: ["full"],
                source: "core",
            });
            const tools = registry.resolveAll(baseContext);
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe("context_tool");
        });

        it("silently skips factories that throw", () => {
            // Register a factory that will throw when invoked
            registry.registerFactory(
                () => {
                    throw new Error("factory exploded");
                },
                {
                    id: "exploding",
                    label: "Exploding",
                    description: "",
                    sectionId: "test",
                    profiles: ["full"],
                    source: "core",
                },
            );
            registry.register(echoTool);
            const tools = registry.resolveAll();
            // The echo tool should still be there; the broken factory is skipped
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe("echo");
        });
    });

    describe("resolve", () => {
        beforeEach(() => {
            registry.register(echoTool);
        });

        it("resolves a tool by name", () => {
            const tool = registry.resolve("echo");
            expect(tool).toBeDefined();
            expect(tool!.name).toBe("echo");
        });

        it("returns undefined for an unknown name", () => {
            expect(registry.resolve("nonexistent")).toBeUndefined();
        });
    });

    describe("resolveByProfile", () => {
        beforeEach(() => {
            registry.register(echoTool, { id: "echo", sectionId: "web", profiles: ["coding"] });
            registry.register(fullTool, { id: "full_tool", sectionId: "fs", profiles: ["messaging"] });
        });

        it('"full" includes all tools', () => {
            expect(registry.resolveByProfile("full")).toHaveLength(2);
        });

        it('"coding" includes only coding-profile tools', () => {
            const tools = registry.resolveByProfile("coding");
            expect(tools.map((t) => t.name)).toContain("echo");
            expect(tools.map((t) => t.name)).not.toContain("full_tool");
        });

        it('"minimal" excludes coding tools', () => {
            const tools = registry.resolveByProfile("minimal");
            expect(tools.map((t) => t.name)).not.toContain("echo");
        });

        it('"messaging" includes messaging-profile tools', () => {
            const tools = registry.resolveByProfile("messaging");
            expect(tools.map((t) => t.name)).toContain("full_tool");
        });
    });

    // ---------------------------------------------------------------------------
    // Catalog queries
    // ---------------------------------------------------------------------------

    describe("list", () => {
        it("returns metadata without resolving factories", () => {
            registry.register(echoTool);
            registry.registerFactory(contextAwareToolFactory, {
                id: "context_tool",
                label: "",
                description: "",
                sectionId: "test",
                profiles: ["full"],
                source: "core",
            });
            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list.every((m) => typeof m.id === "string")).toBe(true);
        });
    });

    describe("listBySection", () => {
        it("groups tools by sectionId", () => {
            registry.register(echoTool, { id: "echo", sectionId: "web", profiles: ["full"] });
            registry.register(fullTool, { id: "full_tool", sectionId: "fs", profiles: ["full"] });

            const sections = registry.listBySection();
            const sectionIds = sections.map((s) => s.id);
            expect(sectionIds).toContain("web");
            expect(sectionIds).toContain("fs");

            const webSection = sections.find((s) => s.id === "web")!;
            expect(webSection.tools.map((t) => t.id)).toContain("echo");
        });
    });

    // ---------------------------------------------------------------------------
    // Mutation
    // ---------------------------------------------------------------------------

    describe("unregister", () => {
        it("removes a registered tool", () => {
            registry.register(echoTool);
            expect(registry.unregister("echo")).toBe(true);
            expect(registry.has("echo")).toBe(false);
            expect(registry.size).toBe(0);
        });

        it("returns false for an unknown name", () => {
            expect(registry.unregister("nonexistent")).toBe(false);
        });
    });

    describe("clear", () => {
        it("removes all tools", () => {
            registry.register(echoTool);
            registry.register(fullTool);
            registry.clear();
            expect(registry.size).toBe(0);
            expect(registry.list()).toHaveLength(0);
        });
    });

    // ---------------------------------------------------------------------------
    // Tool execution (via registry)
    // ---------------------------------------------------------------------------

    describe("tool execution", () => {
        it("executes a resolved tool", async () => {
            registry.register(echoTool);
            const tool = registry.resolve("echo")!;
            const result = await tool.execute("call-1", { message: "hello" });
            expect(result.content[0]).toMatchObject({ type: "text", text: "hello" });
        });

        it("propagates errors thrown by tools", async () => {
            registry.register(throwingTool);
            const tool = registry.resolve("throwing_tool")!;
            await expect(tool.execute("call-1", {})).rejects.toThrow("Tool intentionally threw");
        });
    });
});
