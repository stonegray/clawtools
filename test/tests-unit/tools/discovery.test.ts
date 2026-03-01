import { describe, it, expect } from "vitest";
import { ToolRegistry, getCoreToolCatalog, getCoreSections, discoverCoreTools, discoverCoreToolsAsync } from "clawtools/tools";

describe("Tool discovery", () => {
    // ---------------------------------------------------------------------------
    // getCoreToolCatalog
    // ---------------------------------------------------------------------------

    describe("getCoreToolCatalog", () => {
        it("returns 23 tools", () => {
            // 23 = sum of all entries in CORE_TOOL_CATALOG (src/tools/discovery.ts)
            // Breakdown by section:
            //   fs (3):         read, write, edit
            //   runtime (1):    exec
            //   web (2):        web_search, web_fetch
            //   memory (2):     memory_search, memory_get
            //   sessions (6):   sessions_list, sessions_history, sessions_send,
            //                   sessions_spawn, subagents, session_status
            //   ui (2):         browser, canvas
            //   messaging (1):  message
            //   automation (2): cron, gateway
            //   nodes (1):      nodes
            //   agents (1):     agents_list
            //   media (2):      image, tts
            // If this number changes, update the breakdown above AND the ID snapshot below.
            expect(getCoreToolCatalog()).toHaveLength(23);
        });

        it("tool ID list matches the expected set (regression anchor for issue 45)", () => {
            // Snapshot of all 23 tool IDs in sorted order.
            // A failure here tells you exactly which tool was added or removed.
            const ids = getCoreToolCatalog().map((t) => t.id).sort();
            expect(ids).toEqual([
                "agents_list",
                "browser",
                "canvas",
                "cron",
                "edit",
                "exec",
                "gateway",
                "image",
                "memory_get",
                "memory_search",
                "message",
                "nodes",
                "read",
                "session_status",
                "sessions_history",
                "sessions_list",
                "sessions_send",
                "sessions_spawn",
                "subagents",
                "tts",
                "web_fetch",
                "web_search",
                "write",
            ]);
        });

        it("all entries have required fields", () => {
            for (const tool of getCoreToolCatalog()) {
                expect(tool.id, `${tool.id} missing id`).toBeTruthy();
                expect(tool.description, `${tool.id} missing description`).toBeTruthy();
                expect(tool.sectionId, `${tool.id} missing sectionId`).toBeTruthy();
                expect(Array.isArray(tool.profiles), `${tool.id} profiles not array`).toBe(true);
                expect(tool.source).toBe("core");
            }
        });

        it("contains expected well-known tools", () => {
            const ids = getCoreToolCatalog().map((t) => t.id);
            for (const expected of ["read", "write", "exec", "web_search", "web_fetch", "session_status"]) {
                expect(ids, `missing tool: ${expected}`).toContain(expected);
            }
        });

        it("does not expose factoryModule or factoryName", () => {
            for (const entry of getCoreToolCatalog()) {
                expect(entry).not.toHaveProperty("factoryModule");
                expect(entry).not.toHaveProperty("factoryName");
            }
        });
    });

    // ---------------------------------------------------------------------------
    // getCoreSections
    // ---------------------------------------------------------------------------

    describe("getCoreSections", () => {
        it("returns 11 sections", () => {
            expect(getCoreSections()).toHaveLength(11);
        });

        it("each section has id and label", () => {
            for (const s of getCoreSections()) {
                expect(s.id).toBeTruthy();
                expect(s.label).toBeTruthy();
            }
        });

        it("contains expected section IDs", () => {
            const ids = getCoreSections().map((s) => s.id);
            for (const expected of ["fs", "runtime", "web", "memory", "sessions", "media"]) {
                expect(ids).toContain(expected);
            }
        });
    });

    // ---------------------------------------------------------------------------
    // discoverCoreTools
    // ---------------------------------------------------------------------------

    describe("discoverCoreTools", () => {
        it("registers 23 tools into a new registry", () => {
            // 23 = total tool count; see getCoreToolCatalog count test for breakdown.
            const registry = new ToolRegistry();
            discoverCoreTools(registry);
            expect(registry.size).toBe(23);
        });

        it("resolveAll() returns [] for a sync-populated registry (issue 44: null-factory invariant)", () => {
            // discoverCoreTools registers null-returning stub factories for
            // catalog / metadata use only.  Every stub returns null so that
            // registry.resolveAll() yields an empty array, which is the correct
            // signal that tools need to be loaded via discoverCoreToolsAsync()
            // before they can execute.
            const registry = new ToolRegistry();
            discoverCoreTools(registry);
            expect(registry.resolveAll()).toEqual([]);
        });

        it("tool metadata is in the registry without loading modules", () => {
            const registry = new ToolRegistry();
            discoverCoreTools(registry);
            const meta = registry.list();
            expect(meta.every((m) => typeof m.id === "string")).toBe(true);
        });

        it("filters with include list (exact IDs)", () => {
            const registry = new ToolRegistry();
            discoverCoreTools(registry, { include: ["read", "write"] });
            expect(registry.size).toBe(2);
            expect(registry.has("read")).toBe(true);
            expect(registry.has("write")).toBe(true);
        });

        it("excludes tools in the exclude list", () => {
            const registry = new ToolRegistry();
            discoverCoreTools(registry, { exclude: ["read", "write"] });
            expect(registry.size).toBe(21);
            expect(registry.has("read")).toBe(false);
        });

        it("expands group: prefix in include", () => {
            const registry = new ToolRegistry();
            discoverCoreTools(registry, { include: ["group:web"] });
            expect(registry.size).toBe(2); // web_search + web_fetch
            expect(registry.has("web_search")).toBe(true);
            expect(registry.has("web_fetch")).toBe(true);
        });

        it("expands group: prefix in exclude", () => {
            const registry = new ToolRegistry();
            discoverCoreTools(registry, { exclude: ["group:web"] });
            expect(registry.size).toBe(21);
            expect(registry.has("web_search")).toBe(false);
            expect(registry.has("web_fetch")).toBe(false);
        });

        it("include and exclude can be combined (exclude wins for overlaps)", () => {
            const registry = new ToolRegistry();
            discoverCoreTools(registry, { include: ["group:fs"], exclude: ["read"] });
            expect(registry.has("write")).toBe(true);
            expect(registry.has("read")).toBe(false);
        });

        it("produces no duplicate IDs", () => {
            const registry = new ToolRegistry();
            discoverCoreTools(registry);
            // Registering everything twice should not double the count
            discoverCoreTools(registry);
            expect(registry.size).toBe(23);
        });
    });

    // ---------------------------------------------------------------------------
    // discoverCoreToolsAsync
    // ---------------------------------------------------------------------------

    describe("discoverCoreToolsAsync", () => {
        it("resolveAll() returns [] before the promise resolves (issue 42: lazy-load invariant)", async () => {
            // Start discovery without awaiting.  The async function suspends at its
            // first await inside discoverFromBundles/discoverFromSource, so no
            // factories have been registered yet by the time the next line runs.
            //
            // Use a non-existent openclawRoot to prevent the source-fallback path
            // from trying to import from the real openclaw submodule, which would
            // cascade into a long import chain and time out the test.
            const registry = new ToolRegistry();
            const promise = discoverCoreToolsAsync(registry, {
                include: ["read"],
                openclawRoot: "/nonexistent-root-for-lazy-load-test",
            });

            // Registry is still empty — no factories registered synchronously
            expect(registry.size).toBe(0);
            expect(registry.resolveAll()).toEqual([]);

            await promise;

            // After resolution the catalog entry for "read" is registered
            // (ghost registration: factory returns null since openclawRoot is fake)
            expect(registry.size).toBe(1);
            expect(registry.has("read")).toBe(true);
        });

        it("registers factories for all tools matching an include filter", async () => {
            const registry = new ToolRegistry();
            await discoverCoreToolsAsync(registry, {
                include: ["read", "write", "exec"],
                openclawRoot: "/nonexistent-root-for-filter-test",
            });
            expect(registry.size).toBe(3);
            expect(registry.has("read")).toBe(true);
            expect(registry.has("write")).toBe(true);
            expect(registry.has("exec")).toBe(true);
        });

        it("source-path fallback: catalog entry is registered even when openclawRoot is missing (issue 52)", async () => {
            // This test directly exercises the source-path fallback code path.
            // When pre-built bundles are present (post-build), discoverFromBundles
            // runs instead and the openclawRoot option is ignored.  In a pre-build
            // environment (no dist/core-tools/ bundles), discoverFromSource runs
            // and the missing root triggers the onLoadWarning callback while still
            // registering null-returning stub factories for catalog use — exactly
            // the same guarantee that discoverCoreTools (sync) provides.
            const registry = new ToolRegistry();
            const warnings: string[] = [];

            await discoverCoreToolsAsync(registry, {
                include: ["read"],
                openclawRoot: "/definitely-nonexistent-source-root-for-unit-test",
                onLoadWarning: (msg) => warnings.push(msg),
            });

            // Catalog entry is always registered regardless of bundle/source availability
            expect(registry.size).toBe(1);
            expect(registry.has("read")).toBe(true);
            expect(registry.list()[0].id).toBe("read");
            expect(registry.list()[0].source).toBe("core");
        });
    });
});
