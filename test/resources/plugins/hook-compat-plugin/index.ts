/**
 * hook-compat-plugin — test resource plugin.
 *
 * Calls every method on the PluginApi, including all the no-op ones, to
 * verify that a plugin written for OpenClaw loads cleanly through clawtools
 * without throwing.
 *
 * Also registers one real tool ("compat_check") so the loaded plugin is
 * non-empty and assertions can confirm it was collected.
 */

import type { PluginApi } from "clawtools";

export function register(api: PluginApi): void {
    // ── Real registration (collected by clawtools) ───────────────────────────
    api.registerTool({
        name: "compat_check",
        description: "Verifies that all PluginApi methods are callable.",
        parameters: { type: "object", properties: {} },
        execute: async () => ({
            content: [{ type: "text" as const, text: "ok" }],
        }),
    });

    // ── No-op registrations (accepted, silently discarded) ───────────────────
    // These mirror the calls a real OpenClaw plugin would make.
    api.registerHook("session_start", async () => { });
    api.registerHook(["before_tool_call", "after_tool_call"], async () => { });
    api.registerHttpHandler(() => false);
    api.registerHttpRoute({ path: "/compat-test", handler: async () => { } });
    api.registerChannel({ id: "fake-channel", meta: {}, capabilities: {} });
    api.registerGatewayMethod("compat_method", async () => { });
    api.registerCli(async () => { }, { commands: ["compat"] });
    api.registerService({
        id: "compat-service",
        start: async () => { },
        stop: async () => { },
    });
    api.registerProvider({
        id: "compat-provider",
        label: "Compat Provider",
        auth: [],
    });
    api.registerCommand({
        name: "compat",
        description: "Compat test command",
        handler: async () => ({}),
    });

    // resolvePath should return the input unchanged
    const resolved = api.resolvePath("./relative/path");
    if (typeof resolved !== "string") throw new Error("resolvePath must return a string");

    api.on("agent_end", async () => { });
    api.on("before_model_resolve", async () => ({}));
}
