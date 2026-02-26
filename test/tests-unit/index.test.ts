/**
 * Unit tests: createClawtools / createClawtoolsAsync public API.
 *
 * These tests verify that the top-level factory functions return correctly
 * structured instances, that registries start in the right state, and that
 * options like `skipCoreTools` and `skipBuiltinConnectors` are honoured.
 *
 * The bundle-dependent async test (builtin connectors) is skipped when the
 * dist bundle has not been built yet.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClawtools, createClawtoolsAsync } from "clawtools";
import { ToolRegistry } from "clawtools/tools";
import { ConnectorRegistry } from "clawtools/connectors";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUNDLES_BUILT = existsSync(resolve(ROOT, "dist/core-connectors/builtins.js"));

// ---------------------------------------------------------------------------
// createClawtools (sync)
// ---------------------------------------------------------------------------

describe("createClawtools", () => {
    describe("return shape", () => {
        it("returns an object with tools, connectors, and extensions", () => {
            const ct = createClawtools({ skipCoreTools: true });
            expect(ct).toHaveProperty("tools");
            expect(ct).toHaveProperty("connectors");
            expect(ct).toHaveProperty("extensions");
        });

        it("tools is a ToolRegistry instance", () => {
            expect(createClawtools({ skipCoreTools: true }).tools).toBeInstanceOf(ToolRegistry);
        });

        it("connectors is a ConnectorRegistry instance", () => {
            expect(createClawtools({ skipCoreTools: true }).connectors).toBeInstanceOf(ConnectorRegistry);
        });

        it("extensions is an array", () => {
            expect(Array.isArray(createClawtools({ skipCoreTools: true }).extensions)).toBe(true);
        });
    });

    describe("skipCoreTools option", () => {
        it("skipCoreTools:true → empty tool registry", () => {
            expect(createClawtools({ skipCoreTools: true }).tools.size).toBe(0);
        });
    });

    describe("initial state", () => {
        it("connector registry starts empty", () => {
            expect(createClawtools({ skipCoreTools: true }).connectors.size).toBe(0);
        });
    });

    describe("mutability after creation", () => {
        it("can register a tool after creation", () => {
            const ct = createClawtools({ skipCoreTools: true });
            ct.tools.register({
                name: "post_create_tool",
                description: "added after init",
                parameters: { type: "object", properties: {} },
                execute: async () => ({ content: [] }),
            });
            expect(ct.tools.size).toBe(1);
            expect(ct.tools.has("post_create_tool")).toBe(true);
        });

        it("can register a connector after creation", () => {
            const ct = createClawtools({ skipCoreTools: true });
            ct.connectors.register({
                id: "post-create-conn",
                label: "Post-create",
                provider: "post-create",
                api: "openai-completions",
                async *stream() {
                    yield { type: "done", stopReason: "stop" };
                },
            });
            expect(ct.connectors.size).toBe(1);
        });
    });

    describe("instance isolation", () => {
        it("two calls return independent instances", () => {
            const ct1 = createClawtools({ skipCoreTools: true });
            const ct2 = createClawtools({ skipCoreTools: true });
            ct1.tools.register({
                name: "only_in_ct1",
                description: "x",
                parameters: { type: "object", properties: {} },
                execute: async () => ({ content: [] }),
            });
            expect(ct1.tools.size).toBe(1);
            expect(ct2.tools.size).toBe(0);
        });

        it("tool registry instances are distinct objects", () => {
            const ct1 = createClawtools({ skipCoreTools: true });
            const ct2 = createClawtools({ skipCoreTools: true });
            expect(ct1.tools).not.toBe(ct2.tools);
        });

        it("connector registry instances are distinct objects", () => {
            const ct1 = createClawtools({ skipCoreTools: true });
            const ct2 = createClawtools({ skipCoreTools: true });
            expect(ct1.connectors).not.toBe(ct2.connectors);
        });
    });
});

// ---------------------------------------------------------------------------
// createClawtoolsAsync
// ---------------------------------------------------------------------------

describe("createClawtoolsAsync", () => {
    describe("return shape", () => {
        it("resolves to an object with tools, connectors, and extensions", async () => {
            const ct = await createClawtoolsAsync({
                skipCoreTools: true,
                skipBuiltinConnectors: true,
            });
            expect(ct).toHaveProperty("tools");
            expect(ct).toHaveProperty("connectors");
            expect(ct).toHaveProperty("extensions");
        });

        it("tools is a ToolRegistry instance", async () => {
            const ct = await createClawtoolsAsync({
                skipCoreTools: true,
                skipBuiltinConnectors: true,
            });
            expect(ct.tools).toBeInstanceOf(ToolRegistry);
        });

        it("connectors is a ConnectorRegistry instance", async () => {
            const ct = await createClawtoolsAsync({
                skipCoreTools: true,
                skipBuiltinConnectors: true,
            });
            expect(ct.connectors).toBeInstanceOf(ConnectorRegistry);
        });

        it("extensions is an array", async () => {
            const ct = await createClawtoolsAsync({
                skipCoreTools: true,
                skipBuiltinConnectors: true,
            });
            expect(Array.isArray(ct.extensions)).toBe(true);
        });
    });

    describe("skipCoreTools + skipBuiltinConnectors", () => {
        it("both skipped → empty tool and connector registries", async () => {
            const ct = await createClawtoolsAsync({
                skipCoreTools: true,
                skipBuiltinConnectors: true,
            });
            expect(ct.tools.size).toBe(0);
            expect(ct.connectors.size).toBe(0);
        });
    });

    describe("instance isolation", () => {
        it("two awaits return independent tool registries", async () => {
            const ct1 = await createClawtoolsAsync({
                skipCoreTools: true,
                skipBuiltinConnectors: true,
            });
            const ct2 = await createClawtoolsAsync({
                skipCoreTools: true,
                skipBuiltinConnectors: true,
            });
            expect(ct1.tools).not.toBe(ct2.tools);
            expect(ct1.connectors).not.toBe(ct2.connectors);
        });
    });

    describe("builtin connectors (requires built bundle)", () => {
        it.skipIf(!BUNDLES_BUILT)(
            "skipBuiltinConnectors:false registers connectors from the bundle",
            async () => {
                const ct = await createClawtoolsAsync({
                    skipCoreTools: true,
                    skipBuiltinConnectors: false,
                });
                expect(ct.connectors.size).toBeGreaterThan(0);
            },
            30_000,
        );

        it.skipIf(!BUNDLES_BUILT)(
            "each built-in connector has a provider and model list",
            async () => {
                const ct = await createClawtoolsAsync({
                    skipCoreTools: true,
                    skipBuiltinConnectors: false,
                });
                for (const connector of ct.connectors.list()) {
                    expect(connector.provider).toBeTruthy();
                    expect(Array.isArray(connector.models)).toBe(true);
                    expect(connector.models!.length).toBeGreaterThan(0);
                }
            },
            30_000,
        );
    });
});
