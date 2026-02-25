import { describe, it, expect } from "vitest";
import { ToolRegistry, getCoreToolCatalog, getCoreSections, discoverCoreTools } from "clawtools/tools";

describe("Tool discovery", () => {
    // ---------------------------------------------------------------------------
    // getCoreToolCatalog
    // ---------------------------------------------------------------------------

    describe("getCoreToolCatalog", () => {
        it("returns 23 tools", () => {
            expect(getCoreToolCatalog()).toHaveLength(23);
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
            const registry = new ToolRegistry();
            discoverCoreTools(registry);
            expect(registry.size).toBe(23);
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
});
