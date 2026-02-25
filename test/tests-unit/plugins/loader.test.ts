import { describe, it, expect } from "vitest";
import { loadPlugins } from "clawtools/plugins";
import { loadTestPlugin, loadTestPlugins, TEST_PLUGINS_DIR } from "../../helpers/index.js";

describe("Plugin loader", () => {
    // ---------------------------------------------------------------------------
    // Manifest discovery
    // ---------------------------------------------------------------------------

    describe("discovery", () => {
        it("discovers plugins in the test resources directory", async () => {
            const plugins = await loadTestPlugins();
            expect(plugins.length).toBeGreaterThanOrEqual(2); // echo-plugin + hook-compat-plugin
        });

        it("finds echo-plugin by ID", async () => {
            const plugin = await loadTestPlugin("echo-plugin");
            expect(plugin).toBeDefined();
            expect(plugin!.id).toBe("echo-plugin");
            expect(plugin!.name).toBe("Echo Plugin");
        });

        it("skips bad-plugin (no entry point)", async () => {
            const plugins = await loadTestPlugins();
            const bad = plugins.find((p) => p.id === "bad-plugin");
            expect(bad).toBeUndefined();
        });
    });

    // ---------------------------------------------------------------------------
    // enabledPlugins / disabledPlugins filters
    // ---------------------------------------------------------------------------

    describe("filtering", () => {
        it("loads only enabled plugins when enabledPlugins is set", async () => {
            const plugins = await loadTestPlugins({ enabled: ["echo-plugin"] });
            expect(plugins).toHaveLength(1);
            expect(plugins[0].id).toBe("echo-plugin");
        });

        it("skips disabled plugins", async () => {
            const plugins = await loadTestPlugins({ disabled: ["echo-plugin"] });
            expect(plugins.every((p) => p.id !== "echo-plugin")).toBe(true);
        });

        it("returns empty array when no search paths match", async () => {
            const plugins = await loadPlugins({ searchPaths: ["/tmp/nonexistent-dir-xyz"] });
            expect(plugins).toHaveLength(0);
        });
    });

    // ---------------------------------------------------------------------------
    // Tool collection
    // ---------------------------------------------------------------------------

    describe("tool collection", () => {
        it("collects tools registered via registerTool", async () => {
            const plugin = await loadTestPlugin("echo-plugin");
            expect(plugin!.tools).toHaveLength(1);
            expect(plugin!.tools[0].name).toBe("echo");
        });

        it("collected tools are executable", async () => {
            const plugin = await loadTestPlugin("echo-plugin");
            const tool = plugin!.tools[0];
            const result = await tool.execute("test-call", { message: "hello" });
            expect(result.content[0]).toMatchObject({ type: "text", text: "hello" });
        });
    });

    // ---------------------------------------------------------------------------
    // Connector collection
    // ---------------------------------------------------------------------------

    describe("connector collection", () => {
        it("collects connectors registered via registerConnector", async () => {
            const plugin = await loadTestPlugin("echo-plugin");
            expect(plugin!.connectors).toHaveLength(1);
            expect(plugin!.connectors[0].id).toBe("echo-connector");
        });

        it("collected connectors are streamable", async () => {
            const plugin = await loadTestPlugin("echo-plugin");
            const connector = plugin!.connectors[0];
            const events = [];
            for await (const event of connector.stream(
                connector.models![0],
                { messages: [{ role: "user", content: "hi" }] },
                {},
            )) {
                events.push(event);
            }
            expect(events.some((e) => e.type === "text_delta")).toBe(true);
            expect(events.some((e) => e.type === "done")).toBe(true);
        });
    });

    // ---------------------------------------------------------------------------
    // No-op compatibility (hook-compat-plugin)
    // ---------------------------------------------------------------------------

    describe("no-op compatibility", () => {
        it("loads hook-compat-plugin without throwing", async () => {
            const plugin = await loadTestPlugin("hook-compat-plugin");
            expect(plugin).toBeDefined();
        });

        it("collects the compat_check tool despite all no-op calls", async () => {
            const plugin = await loadTestPlugin("hook-compat-plugin");
            expect(plugin!.tools.some((t) => t.name === "compat_check")).toBe(true);
        });
    });

    // ---------------------------------------------------------------------------
    // LoadedPlugin shape
    // ---------------------------------------------------------------------------

    describe("LoadedPlugin shape", () => {
        it("has all expected fields", async () => {
            const plugin = await loadTestPlugin("echo-plugin");
            expect(plugin).toMatchObject({
                id: expect.any(String),
                name: expect.any(String),
                source: expect.any(String),
                tools: expect.any(Array),
                toolFactories: expect.any(Array),
                connectors: expect.any(Array),
            });
        });
    });
});
