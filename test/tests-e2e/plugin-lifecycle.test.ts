/**
 * E2E: Plugin system — discover → load → execute tools → stream connectors.
 *
 * Tests the full plugin lifecycle using real test resource plugins.
 */

import { describe, it, expect } from "vitest";
import {
    createClawtoolsSync,
    loadPlugins,
} from "clawtools";
import type { Tool, Connector } from "clawtools";
import { TEST_PLUGINS_DIR, loadTestPlugin, loadTestPlugins } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Plugin discovery + loading
// ---------------------------------------------------------------------------

describe("plugin discovery and loading", () => {
    it("discovers and loads plugins from a directory", async () => {
        const plugins = await loadTestPlugins();
        expect(plugins.length).toBeGreaterThanOrEqual(2);

        const ids = plugins.map((p) => p.id);
        expect(ids).toContain("echo-plugin");
        expect(ids).toContain("hook-compat-plugin");
    });

    it("skips plugins with no entry point (bad-plugin)", async () => {
        const plugins = await loadTestPlugins();
        expect(plugins.find((p) => p.id === "bad-plugin")).toBeUndefined();
    });

    it("returns empty array for non-existent path", async () => {
        const plugins = await loadPlugins({
            searchPaths: ["./tmp/nonexistent-dir-xyz-e2e"],
        });
        expect(plugins).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Plugin tool execution
// ---------------------------------------------------------------------------

describe("plugin tool execution", () => {
    it("executes the echo tool from the echo-plugin", async () => {
        const plugin = await loadTestPlugin("echo-plugin");
        expect(plugin).toBeDefined();

        const echoTool = plugin!.tools.find((t) => t.name === "echo");
        expect(echoTool).toBeDefined();

        const result = await echoTool!.execute("e2e-call-1", { message: "hello from e2e" });
        expect(result.content[0]).toMatchObject({ type: "text", text: "hello from e2e" });
        expect(result.details).toEqual({ echoed: "hello from e2e" });
    });

    it("registers plugin tools into a ToolRegistry and resolves them", async () => {
        const plugin = await loadTestPlugin("echo-plugin");
        const ct = createClawtoolsSync({ skipCoreTools: true });

        for (const tool of plugin!.tools) {
            ct.tools.register(tool, { source: "plugin", pluginId: plugin!.id });
        }

        expect(ct.tools.has("echo")).toBe(true);
        const resolved = ct.tools.resolve("echo")!;
        const result = await resolved.execute("e2e-call-2", { message: "via registry" });
        expect(result.content[0]).toMatchObject({ type: "text", text: "via registry" });

        // Metadata shows plugin source
        const meta = ct.tools.list().find((m) => m.id === "echo");
        expect(meta?.source).toBe("plugin");
        expect(meta?.pluginId).toBe("echo-plugin");
    });
});

// ---------------------------------------------------------------------------
// Plugin connector streaming
// ---------------------------------------------------------------------------

describe("plugin connector streaming", () => {
    it("streams from the echo-plugin connector", async () => {
        const plugin = await loadTestPlugin("echo-plugin");
        expect(plugin).toBeDefined();

        const connector = plugin!.connectors.find((c) => c.id === "echo-connector");
        expect(connector).toBeDefined();

        const events: Array<{ type: string; [key: string]: unknown }> = [];
        for await (const event of connector!.stream(
            connector!.models![0],
            { messages: [{ role: "user", content: "hi from e2e" }] },
            {},
        )) {
            events.push(event as { type: string; [key: string]: unknown });
        }

        expect(events[0].type).toBe("start");
        const textDelta = events.find((e) => e.type === "text_delta") as
            | { type: "text_delta"; delta: string }
            | undefined;
        expect(textDelta).toBeDefined();
        expect(textDelta!.delta).toContain("hi from e2e");
        expect(events[events.length - 1].type).toBe("done");
    });

    it("registers plugin connectors into a ConnectorRegistry", async () => {
        const plugin = await loadTestPlugin("echo-plugin");
        const ct = createClawtoolsSync({ skipCoreTools: true });

        for (const connector of plugin!.connectors) {
            ct.connectors.register(connector);
        }

        expect(ct.connectors.has("echo-connector")).toBe(true);
        expect(ct.connectors.getByProvider("echo")).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// PluginApi no-op compatibility
// ---------------------------------------------------------------------------

describe("pluginapi no-op compatibility", () => {
    it("hook-compat-plugin loads without errors despite calling all no-op methods", async () => {
        const plugin = await loadTestPlugin("hook-compat-plugin");
        expect(plugin).toBeDefined();
        expect(plugin!.id).toBe("hook-compat-plugin");
    });

    it("hook-compat-plugin still registers its active tool", async () => {
        const plugin = await loadTestPlugin("hook-compat-plugin");
        const compatTool = plugin!.tools.find((t) => t.name === "compat_check");
        expect(compatTool).toBeDefined();

        const result = await compatTool!.execute("e2e-compat", {});
        expect(result.content[0]).toMatchObject({ type: "text", text: "ok" });
    });

    it("no-op methods do not produce any connectors or tool factories", async () => {
        const plugin = await loadTestPlugin("hook-compat-plugin");
        // hook-compat-plugin calls registerHook, registerHttpHandler, etc.
        // None of those should produce tools or connectors
        expect(plugin!.connectors).toHaveLength(0);
        // The only tool should be the one explicitly registered
        expect(plugin!.tools).toHaveLength(1);
        expect(plugin!.tools[0].name).toBe("compat_check");
    });
});

// ---------------------------------------------------------------------------
// Plugin filtering
// ---------------------------------------------------------------------------

describe("plugin filtering", () => {
    it("enabledPlugins restricts which plugins load", async () => {
        const plugins = await loadTestPlugins({ enabled: ["echo-plugin"] });
        expect(plugins).toHaveLength(1);
        expect(plugins[0].id).toBe("echo-plugin");
    });

    it("disabledPlugins excludes specific plugins", async () => {
        const plugins = await loadTestPlugins({ disabled: ["echo-plugin"] });
        expect(plugins.every((p) => p.id !== "echo-plugin")).toBe(true);
        // hook-compat-plugin should still be there
        expect(plugins.some((p) => p.id === "hook-compat-plugin")).toBe(true);
    });

    it("enabling a non-existent plugin returns empty array", async () => {
        const plugins = await loadTestPlugins({ enabled: ["does-not-exist"] });
        expect(plugins).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// LoadedPlugin shape
// ---------------------------------------------------------------------------

describe("LoadedPlugin shape", () => {
    it("has all required fields", async () => {
        const plugin = await loadTestPlugin("echo-plugin");
        expect(plugin).toMatchObject({
            id: "echo-plugin",
            name: "Echo Plugin",
            source: expect.stringContaining("echo-plugin"),
            tools: expect.any(Array),
            toolFactories: expect.any(Array),
            connectors: expect.any(Array),
        });
    });

    it("description is propagated from manifest", async () => {
        const plugin = await loadTestPlugin("echo-plugin");
        expect(plugin!.description).toBeDefined();
    });
});
