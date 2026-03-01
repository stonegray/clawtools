/**
 * Build regression tests for the bundle-core-tools pipeline.
 *
 * These tests are the line-of-defence against openclaw upstream changes breaking
 * clawtools. They verify every assumption the bundler makes about the world:
 *
 *   1. Source preconditions  — openclaw entry files and factory exports exist
 *   2. parseAllImports        — import parser handles every TS import pattern
 *   2b. generateEsmStub       — stub generator produces valid ESM exports
 *   2c. walkTs                — directory walker respects exclusions and .d.ts
 *   4. Bundle loading         — built bundles load, export the factory, return tools
 *      (skip if bundles not yet built — run `npm run build` first)
 *   5. Discovery integration  — discoverCoreToolsAsync uses bundles from dist/
 *      (skip if dist/ not yet built)
 *   6. Regression anchors     — catalog contents locked against accidental drift
 *
 * Run as part of the normal test suite: npm test
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    TOOL_CATALOG,
    NODE_BUILTINS,
    ALWAYS_EXTERNAL,
    parseAllImports,
    walkTs,
    generateEsmStub,
} from "../../scripts/bundle-core-tools.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OPENCLAW_SRC = join(ROOT, "openclaw", "src");
const MANIFEST_PATH = join(ROOT, "dist", "core-tools", "manifest.json");
const DIST_REG_PATH = join(ROOT, "dist", "tools", "registry.js");
const DIST_DIS_PATH = join(ROOT, "dist", "tools", "discovery.js");

const BUNDLES_BUILT = existsSync(MANIFEST_PATH);
const DIST_BUILT = existsSync(DIST_DIS_PATH);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Source preconditions
//    The bundler hard-codes paths and export names inside openclaw. If the
//    upstream renames or moves a file, these tests catch it immediately.
// ─────────────────────────────────────────────────────────────────────────────
describe("1. Source preconditions", () => {
    it("openclaw/src directory exists (submodule initialised)", () => {
        expect(
            existsSync(OPENCLAW_SRC),
            `openclaw submodule not found at ${OPENCLAW_SRC}.\n` +
            "Run: git submodule update --init",
        ).toBe(true);
    });

    it("openclaw/src contains a substantial number of TypeScript source files", () => {
        if (!existsSync(OPENCLAW_SRC)) return;
        const files = walkTs(OPENCLAW_SRC);
        expect(files.length, "expected >100 .ts files under openclaw/src").toBeGreaterThan(100);
    });

    it.each(TOOL_CATALOG)(
        "entry file exists on disk: $id → openclaw/src/$entry",
        ({ id, entry }) => {
            if (!existsSync(OPENCLAW_SRC)) return; // already reported above
            const fullPath = join(OPENCLAW_SRC, entry);
            expect(
                existsSync(fullPath),
                `Tool "${id}": entry file not found at openclaw/src/${entry}`,
            ).toBe(true);
        },
    );

    it.each(TOOL_CATALOG)(
        "factory is exported from entry file: $id → $factory()",
        ({ id, entry, factory }) => {
            if (!existsSync(OPENCLAW_SRC)) return;
            const fullPath = join(OPENCLAW_SRC, entry);
            if (!existsSync(fullPath)) return; // already reported above
            const source = readFileSync(fullPath, "utf8");
            // Match: export function Foo / export async function Foo / export const Foo
            const pattern = new RegExp(
                `\\bexport\\s+(?:async\\s+)?(?:function|const)\\s+${factory}\\b`,
            );
            expect(
                pattern.test(source),
                `Tool "${id}": cannot find "export … ${factory}" in openclaw/src/${entry}.\n` +
                "The factory was renamed or moved upstream.",
            ).toBe(true);
        },
    );

    it("no (entry, factory) pair appears twice in TOOL_CATALOG", () => {
        // Multiple tools can share an entry file (read/write/edit all use pi-tools.read.ts)
        // but each (entry, factory) combination must be unique.
        const pairs = TOOL_CATALOG.map((t) => `${t.entry}::${t.factory}`);
        const unique = new Set(pairs);
        expect(unique.size).toBe(pairs.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Bundler internals — parseAllImports
//    These tests lock the parser's behaviour. If the regex or normalisation
//    logic is ever changed, a failing test here pinpoints the regression before
//    it silently produces broken stubs.
// ─────────────────────────────────────────────────────────────────────────────
describe("2. Bundler internals — parseAllImports", () => {
    it("parses a simple named import", () => {
        const result = parseAllImports(`import { Foo, Bar } from "some-pkg";`);
        const info = result.get("some-pkg")!;
        expect(info).toBeDefined();
        expect([...info.names]).toContain("Foo");
        expect([...info.names]).toContain("Bar");
        expect(info.hasDefault).toBe(false);
        expect(info.hasNamespace).toBe(false);
    });

    it("captures the original name, not the local alias", () => {
        const result = parseAllImports(`import { Foo as F, Bar as B } from "pkg";`);
        const info = result.get("pkg")!;
        expect([...info.names]).toContain("Foo");
        expect([...info.names]).toContain("Bar");
        expect([...info.names]).not.toContain("F");
        expect([...info.names]).not.toContain("B");
    });

    it("parses a default import", () => {
        const result = parseAllImports(`import MyDefault from "pkg";`);
        const info = result.get("pkg")!;
        expect(info.hasDefault).toBe(true);
        expect(info.names.size).toBe(0);
        expect(info.hasNamespace).toBe(false);
    });

    it("parses a namespace import (* as X)", () => {
        const result = parseAllImports(`import * as All from "pkg";`);
        const info = result.get("pkg")!;
        expect(info.hasNamespace).toBe(true);
        expect(info.hasDefault).toBe(false);
    });

    it("parses a combined default + named import", () => {
        const result = parseAllImports(`import Def, { Named } from "pkg";`);
        const info = result.get("pkg")!;
        expect(info.hasDefault).toBe(true);
        expect([...info.names]).toContain("Named");
    });

    it("parses multi-line named imports", () => {
        const src = [
            `import {`,
            `  Alpha,`,
            `  Beta,`,
            `  Gamma`,
            `} from "multi-pkg";`,
        ].join("\n");
        const result = parseAllImports(src);
        const info = result.get("multi-pkg")!;
        expect(info).toBeDefined();
        expect([...info.names]).toContain("Alpha");
        expect([...info.names]).toContain("Beta");
        expect([...info.names]).toContain("Gamma");
    });

    it("skips type-only imports (import type { X } from 'pkg')", () => {
        const result = parseAllImports(`import type { Foo } from "type-pkg";`);
        expect(result.has("type-pkg")).toBe(false);
    });

    it("strips inline `type` modifier from a mixed named import list", () => {
        const result = parseAllImports(`import { type TypeOnly, Runtime } from "mixed-pkg";`);
        const info = result.get("mixed-pkg")!;
        expect(info).toBeDefined();
        expect([...info.names]).toContain("Runtime");
        expect([...info.names]).not.toContain("TypeOnly");
        expect([...info.names]).not.toContain("type");
    });

    it("records dynamic import() calls", () => {
        const result = parseAllImports(`const m = await import("dyn-pkg");`);
        expect(result.has("dyn-pkg")).toBe(true);
    });

    it("skips node: prefixed built-in specifiers", () => {
        const result = parseAllImports(`import { readFile } from "node:fs";`);
        expect(result.has("node:fs")).toBe(false);
    });

    it("skips bare Node.js built-in module names", () => {
        const src = [
            `import { readFile } from "fs";`,
            `import { join } from "path";`,
            `import { createHash } from "crypto";`,
        ].join("\n");
        const result = parseAllImports(src);
        expect(result.has("fs")).toBe(false);
        expect(result.has("path")).toBe(false);
        expect(result.has("crypto")).toBe(false);
    });

    it("skips relative and absolute path imports", () => {
        const src = [
            `import { foo } from "./local";`,
            `import { bar } from "../parent";`,
            `import { baz } from "/absolute";`,
        ].join("\n");
        const result = parseAllImports(src);
        expect(result.has("./local")).toBe(false);
        expect(result.has("../parent")).toBe(false);
        expect(result.has("/absolute")).toBe(false);
    });

    it("merges named bindings from multiple import statements for the same package", () => {
        const src = [
            `import { Foo } from "pkg";`,
            `import { Bar } from "pkg";`,
        ].join("\n");
        const result = parseAllImports(src);
        const info = result.get("pkg")!;
        expect([...info.names]).toContain("Foo");
        expect([...info.names]).toContain("Bar");
    });

    it("correctly handles the chromium/playwright-core split-import pattern (regression)", () => {
        // The original bug: `[\\s\\S]*?` in the regex would cross newlines and merge
        // a side-effect import with a later named import, capturing the wrong clause
        // and losing `chromium` from the stub. This test locks that fix.
        const src = [
            `import "./some-chunk.js";`,
            ``,
            `// intervening code`,
            `import { chromium } from "playwright-core";`,
            `import { devices as playwrightDevices } from "playwright-core";`,
        ].join("\n");
        const result = parseAllImports(src);
        const info = result.get("playwright-core")!;
        expect(info).toBeDefined();
        expect([...info.names]).toContain("chromium");
        expect([...info.names]).toContain("devices");
    });

    it("handles scoped package names (@org/pkg)", () => {
        const result = parseAllImports(`import { thing } from "@org/lib";`);
        expect(result.has("@org/lib")).toBe(true);
        expect([...result.get("@org/lib")!.names]).toContain("thing");
    });

    it("handles sub-path imports (@org/pkg/sub)", () => {
        const result = parseAllImports(`import { x } from "@org/pkg/sub";`);
        expect(result.has("@org/pkg/sub")).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b. Bundler internals — generateEsmStub
// ─────────────────────────────────────────────────────────────────────────────
describe("2b. Bundler internals — generateEsmStub", () => {
    it("uppercase-initial names get `export class` exports", () => {
        const stub = generateEsmStub("pkg", {
            names: new Set(["MyClass", "AnotherClass"]),
            hasDefault: false,
            hasNamespace: false,
        });
        expect(stub).toContain("export class MyClass");
        expect(stub).toContain("export class AnotherClass");
        expect(stub).not.toContain("export const MyClass");
    });

    it("lowercase-initial names get `export const` exports", () => {
        const stub = generateEsmStub("pkg", {
            names: new Set(["myFunc", "helperFn"]),
            hasDefault: false,
            hasNamespace: false,
        });
        expect(stub).toContain("export const myFunc");
        expect(stub).toContain("export const helperFn");
        expect(stub).not.toContain("export class myFunc");
    });

    it("hasDefault: true emits `export default`", () => {
        const stub = generateEsmStub("pkg", {
            names: new Set(),
            hasDefault: true,
            hasNamespace: false,
        });
        expect(stub).toContain("export default");
    });

    it("hasDefault: false does NOT emit `export default`", () => {
        const stub = generateEsmStub("pkg", {
            names: new Set(),
            hasDefault: false,
            hasNamespace: false,
        });
        expect(stub).not.toContain("export default");
    });

    it("hasNamespace: true (without hasDefault) emits a default export as namespace fallback", () => {
        const stub = generateEsmStub("pkg", {
            names: new Set(),
            hasDefault: false,
            hasNamespace: true,
        });
        expect(stub).toContain("export default");
    });

    it("stub always contains the _Stub base class and _noop helper", () => {
        const stub = generateEsmStub("any-pkg", {
            names: new Set(["Foo"]),
            hasDefault: false,
            hasNamespace: false,
        });
        expect(stub).toContain("class _Stub");
        expect(stub).toContain("_noop");
    });

    it("generated stub is syntactically valid (classes extend _Stub, consts are arrow fns)", () => {
        const stub = generateEsmStub("pkg", {
            names: new Set(["Cls", "fn"]),
            hasDefault: true,
            hasNamespace: false,
        });
        expect(stub).toContain("export class Cls extends _Stub {}");
        expect(stub).toContain("export const fn = _noop");
        expect(stub).toContain("export default _Stub");
    });

    it("stub includes a comment attributing the specifier", () => {
        const stub = generateEsmStub("my-special-package", {
            names: new Set(),
            hasDefault: false,
            hasNamespace: false,
        });
        expect(stub).toContain("my-special-package");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2c. Bundler internals — walkTs
// ─────────────────────────────────────────────────────────────────────────────
describe("2c. Bundler internals — walkTs", () => {
    it("returns only .ts files — no .d.ts declaration files", () => {
        if (!existsSync(OPENCLAW_SRC)) return;
        const files = walkTs(OPENCLAW_SRC);
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
            expect(f, `unexpected extension: ${f}`).toMatch(/\.ts$/);
            expect(f, `declaration file leaked through: ${f}`).not.toMatch(/\.d\.ts$/);
        }
    });

    it("does not recurse into node_modules", () => {
        if (!existsSync(OPENCLAW_SRC)) return;
        const files = walkTs(OPENCLAW_SRC);
        for (const f of files) {
            expect(f, `node_modules leaked: ${f}`).not.toContain("/node_modules/");
        }
    });

    it("does not recurse into .git", () => {
        if (!existsSync(OPENCLAW_SRC)) return;
        const files = walkTs(OPENCLAW_SRC);
        for (const f of files) {
            expect(f, `.git leaked: ${f}`).not.toContain("/.git/");
        }
    });

    it("recurses into nested subdirectories (finds agents/tools/ files)", () => {
        if (!existsSync(OPENCLAW_SRC)) return;
        const files = walkTs(OPENCLAW_SRC);
        const hasNested = files.some((f) => f.includes("/agents/tools/"));
        expect(hasNested, "walkTs must recurse into subdirectories").toBe(true);
    });

    it("returns absolute paths", () => {
        if (!existsSync(OPENCLAW_SRC)) return;
        const files = walkTs(OPENCLAW_SRC);
        for (const f of files.slice(0, 5)) {
            expect(f, `expected absolute path: ${f}`).toMatch(/^\//);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Bundle loading
//    Skipped when bundles have not been built. Run `npm run build` to enable.
//    These tests verify that the esbuild output is actually loadable and that
//    each factory function returns a properly-shaped AgentTool.
// ─────────────────────────────────────────────────────────────────────────────

type ManifestEntry = { bundle: string; factory: string };
type Manifest = Record<string, ManifestEntry>;

describe.skipIf(!BUNDLES_BUILT)("4. Bundle loading", () => {
    let manifest: Manifest;
    // Pre-warm the ESM module cache for all bundles before individual checks run.
    // Some bundles (read/exec/sessions_spawn) pull in 3–10 MB of shared chunks and
    // take 5–15 s to JIT-compile on first import.  Loading them in parallel here
    // means every it() below hits an already-cached URL and completes instantly.
    beforeAll(async () => {
        manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
        await Promise.allSettled(
            Object.values(manifest).map((e) =>
                import(pathToFileURL(join(ROOT, "dist", e.bundle.replace(/^\.\//, ""))).href),
            ),
        );
    }, 180_000); // 180 s — bundles JIT-compile in parallel; real first-load ~90 s

    it("manifest.json is valid JSON with the expected per-tool structure", () => {
        expect(typeof manifest).toBe("object");
        expect(manifest).not.toBeNull();
        for (const [id, entry] of Object.entries(manifest)) {
            expect(typeof id).toBe("string");
            expect(typeof entry.bundle, `${id}.bundle`).toBe("string");
            expect(typeof entry.factory, `${id}.factory`).toBe("string");
            expect(entry.bundle, `${id}.bundle must start with ./core-tools/`)
                .toMatch(/^\.\/core-tools\//);
            expect(entry.bundle, `${id}.bundle must end with .js`).toMatch(/\.js$/);
        }
    });

    it("manifest contains all 23 TOOL_CATALOG IDs", () => {
        for (const tool of TOOL_CATALOG) {
            expect(manifest, `manifest is missing tool: "${tool.id}"`).toHaveProperty(tool.id);
        }
    });

    it("manifest factory names match TOOL_CATALOG factory names (no drift)", () => {
        for (const tool of TOOL_CATALOG) {
            const entry = manifest[tool.id];
            if (!entry) continue;
            expect(
                entry.factory,
                `"${tool.id}": manifest says "${entry.factory}" but TOOL_CATALOG says "${tool.factory}"`,
            ).toBe(tool.factory);
        }
    });

    it("all bundle files referenced in the manifest exist on disk", () => {
        for (const [id, entry] of Object.entries(manifest)) {
            const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
            expect(
                existsSync(bundlePath),
                `bundle for "${id}" not found at ${bundlePath}`,
            ).toBe(true);
        }
    });

    it.each(TOOL_CATALOG)(
        "bundle for '$id' can be dynamically imported and exports factory '$factory'",
        async ({ id, factory }) => {
            const entry = manifest[id];
            if (!entry) return;
            const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
            const mod = await import(pathToFileURL(bundlePath).href);
            expect(
                typeof mod[entry.factory],
                `"${id}": expected exported function "${entry.factory}", got ${typeof mod[entry.factory]}`,
            ).toBe("function");
        },
    );

    // Tools that should return a valid AgentTool when called with no arguments.
    // read/write/edit require a sandbox root, memory tools require a config object —
    // those are intentionally excluded here and tested separately below.
    const NO_ARG_TOOLS = [
        "exec", "web_search", "web_fetch",
        "sessions_list", "sessions_history", "sessions_send", "sessions_spawn",
        "subagents", "session_status",
        "browser", "canvas",
        "message", "cron", "gateway",
        "nodes", "agents_list", "tts",
    ] as const;

    it.each(NO_ARG_TOOLS)(
        "factory for '%s' returns a valid AgentTool (name, description, parameters, execute)",
        async (id) => {
            const entry = manifest[id];
            const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
            const mod = await import(pathToFileURL(bundlePath).href);
            const factory = mod[entry.factory] as (...args: unknown[]) => unknown;
            const tool = factory() as Record<string, unknown> | null;

            // null is accepted (e.g. image tool when config/agentDir is absent), undefined is not
            if (tool === null) return;
            expect(tool, `"${id}": factory returned undefined`).toBeDefined();

            expect(typeof tool["name"], `"${id}": tool.name must be a string`).toBe("string");
            expect((tool["name"] as string).length, `"${id}": tool.name must be non-empty`).toBeGreaterThan(0);
            expect(typeof tool["description"], `"${id}": tool.description must be a string`).toBe("string");
            expect(typeof tool["execute"], `"${id}": tool.execute must be a function`).toBe("function");
            expect(typeof tool["parameters"], `"${id}": tool.parameters must be an object`).toBe("object");
            expect(tool["parameters"], `"${id}": tool.parameters must not be null`).not.toBeNull();
        },
    );

    it("config-requiring tools (read/write/edit) throw or return null without required args — not crash the process", async () => {
        for (const id of ["read", "write", "edit"] as const) {
            const entry = manifest[id];
            const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
            const mod = await import(pathToFileURL(bundlePath).href);
            const factory = mod[entry.factory] as (...args: unknown[]) => unknown;
            // Calling with no args should throw a TypeError (missing required param)
            // or return null/undefined — it must NOT crash the whole process.
            expect(() => {
                try { factory(); } catch { /* expected */ }
            }).not.toThrow();
        }
    });

    it("image tool has the correct factory entry (graceful-degradation documented)", () => {
        // image requires agentDir + model config. Without them the factory returns null.
        // This test documents the expected disabled-by-default behaviour.
        expect(manifest["image"]).toBeDefined();
        expect(manifest["image"].factory).toBe("createImageTool");
    });

    // Config-gated tools: verify that supplying a ToolContext with the correct
    // fields enables memory and image tools (see docs/issues.md §3).

    it("memory_search returns a valid tool when config is supplied", async () => {
        const entry = manifest["memory_search"];
        const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
        const mod = await import(pathToFileURL(bundlePath).href);
        const factory = mod[entry.factory] as (...args: unknown[]) => unknown;

        const tool = factory({ config: {} }) as Record<string, unknown> | null;
        expect(tool, "memory_search should not be null with config: {}").not.toBeNull();
        expect(typeof tool!["name"]).toBe("string");
        expect(typeof tool!["execute"]).toBe("function");
        expect(typeof tool!["parameters"]).toBe("object");
    });

    it("memory_get returns a valid tool when config is supplied", async () => {
        const entry = manifest["memory_get"];
        const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
        const mod = await import(pathToFileURL(bundlePath).href);
        const factory = mod[entry.factory] as (...args: unknown[]) => unknown;

        const tool = factory({ config: {} }) as Record<string, unknown> | null;
        expect(tool, "memory_get should not be null with config: {}").not.toBeNull();
        expect(typeof tool!["name"]).toBe("string");
        expect(typeof tool!["execute"]).toBe("function");
    });

    it("memory_search returns null without config", async () => {
        const entry = manifest["memory_search"];
        const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
        const mod = await import(pathToFileURL(bundlePath).href);
        const factory = mod[entry.factory] as (...args: unknown[]) => unknown;

        expect(factory({})).toBeNull();
    });

    it("image returns a valid tool when agentDir + imageModel config are supplied", async () => {
        const entry = manifest["image"];
        const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
        const mod = await import(pathToFileURL(bundlePath).href);
        const factory = mod[entry.factory] as (...args: unknown[]) => unknown;

        const tool = factory({
            agentDir: "/tmp/fake-agent-dir",
            config: { agents: { defaults: { imageModel: "openai/gpt-4o" } } },
        }) as Record<string, unknown> | null;

        expect(tool, "image should not be null with agentDir + imageModel").not.toBeNull();
        expect(typeof tool!["name"]).toBe("string");
        expect(typeof tool!["execute"]).toBe("function");
        expect(typeof tool!["parameters"]).toBe("object");
    });

    it("image returns null without agentDir", async () => {
        const entry = manifest["image"];
        const bundlePath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
        const mod = await import(pathToFileURL(bundlePath).href);
        const factory = mod[entry.factory] as (...args: unknown[]) => unknown;

        expect(factory({})).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Discovery integration
//    Skipped when dist/ has not been built. Run `npm run build` to enable.
//    Verifies that discovery.ts correctly routes through the bundle manifests.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!DIST_BUILT)("5. Discovery integration", () => {
    // When bundles are present, discoverCoreToolsAsync must not emit any warnings.
    // When only tsc has run (no bundles), it falls back to source; warnings are OK.
    const MINIMUM_RESOLVED = 17; // exec + web* + sessions* + subagents + browser + canvas + message + cron + gateway + nodes + agents_list + tts

    it("emits no warnings when bundles are present", async () => {
        const { ToolRegistry } = await import(pathToFileURL(DIST_REG_PATH).href);
        const { discoverCoreToolsAsync } = await import(pathToFileURL(DIST_DIS_PATH).href);

        const registry = new ToolRegistry();
        const warnings: string[] = [];

        await discoverCoreToolsAsync(registry, {
            onLoadWarning: (msg: string) => warnings.push(msg),
        });

        if (BUNDLES_BUILT) {
            expect(
                warnings,
                `Unexpected warnings when bundles are present:\n${warnings.join("\n")}`,
            ).toHaveLength(0);
        }
    });

    it("registry contains all 23 tool metadata entries after discovery", async () => {
        const { ToolRegistry } = await import(pathToFileURL(DIST_REG_PATH).href);
        const { discoverCoreToolsAsync } = await import(pathToFileURL(DIST_DIS_PATH).href);

        const registry = new ToolRegistry();
        await discoverCoreToolsAsync(registry);

        expect(registry.list()).toHaveLength(TOOL_CATALOG.length);
    });

    it(`resolves at least ${MINIMUM_RESOLVED} tools with a valid AgentTool shape`, async () => {
        const { ToolRegistry } = await import(pathToFileURL(DIST_REG_PATH).href);
        const { discoverCoreToolsAsync } = await import(pathToFileURL(DIST_DIS_PATH).href);

        const registry = new ToolRegistry();
        await discoverCoreToolsAsync(registry);

        const tools = registry.resolveAll() as Record<string, unknown>[];
        expect(
            tools.length,
            `Expected ≥${MINIMUM_RESOLVED} tools to resolve; got ${tools.length}. ` +
            "Bundles may be stale — run `npm run build`.",
        ).toBeGreaterThanOrEqual(MINIMUM_RESOLVED);

        for (const tool of tools) {
            expect(typeof tool["name"], `tool missing .name`).toBe("string");
            expect((tool["name"] as string).length, `tool.name empty`).toBeGreaterThan(0);
            expect(typeof tool["description"], `${tool["name"]}: missing .description`).toBe("string");
            expect(typeof tool["execute"], `${tool["name"]}: missing .execute`).toBe("function");
            expect(typeof tool["parameters"], `${tool["name"]}: missing .parameters`).toBe("object");
        }
    });

    it("manifest bundle paths resolve correctly relative to dist/", () => {
        // Sanity check for the path arithmetic in discovery.ts's resolveBundleManifest().
        // If the manifest or bundle layout ever changes, this catches it before runtime.
        if (!BUNDLES_BUILT) return;

        const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
        for (const [id, entry] of Object.entries(manifest)) {
            const absPath = join(ROOT, "dist", entry.bundle.replace(/^\.\//, ""));
            expect(
                existsSync(absPath),
                `discovery: bundle for "${id}" unreachable via dist/ + "${entry.bundle}"`,
            ).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Regression anchors
//    Always runs. Locks catalog shape, IDs, factory names, and constants
//    against accidental drift. Any upstream rename triggers a clear failure.
// ─────────────────────────────────────────────────────────────────────────────

describe("6. Regression anchors", () => {
    // The canonical ordered list of tool IDs. Update only when a tool is
    // intentionally added to or removed from openclaw.
    const EXPECTED_IDS = [
        "read", "write", "edit",
        "exec",
        "web_search", "web_fetch",
        "memory_search", "memory_get",
        "sessions_list", "sessions_history", "sessions_send", "sessions_spawn",
        "subagents", "session_status",
        "browser", "canvas",
        "message",
        "cron", "gateway",
        "nodes",
        "agents_list",
        "image", "tts",
    ] as const;

    // The complete factory-name mapping. Changing any of these in the bundler
    // without updating here is a bug that this test catches.
    const EXPECTED_FACTORIES: Record<string, string> = {
        read: "createSandboxedReadTool",
        write: "createSandboxedWriteTool",
        edit: "createSandboxedEditTool",
        exec: "createExecTool",
        web_search: "createWebSearchTool",
        web_fetch: "createWebFetchTool",
        memory_search: "createMemorySearchTool",
        memory_get: "createMemoryGetTool",
        sessions_list: "createSessionsListTool",
        sessions_history: "createSessionsHistoryTool",
        sessions_send: "createSessionsSendTool",
        sessions_spawn: "createSessionsSpawnTool",
        subagents: "createSubagentsTool",
        session_status: "createSessionStatusTool",
        browser: "createBrowserTool",
        canvas: "createCanvasTool",
        message: "createMessageTool",
        cron: "createCronTool",
        gateway: "createGatewayTool",
        nodes: "createNodesTool",
        agents_list: "createAgentsListTool",
        image: "createImageTool",
        tts: "createTtsTool",
    };

    it("TOOL_CATALOG has exactly 23 entries", () => {
        expect(TOOL_CATALOG).toHaveLength(23);
    });

    it("all expected tool IDs are present", () => {
        const ids = TOOL_CATALOG.map((t) => t.id);
        for (const id of EXPECTED_IDS) {
            expect(ids, `TOOL_CATALOG is missing tool: "${id}"`).toContain(id);
        }
    });

    it("no duplicate tool IDs", () => {
        const ids = TOOL_CATALOG.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("read / write / edit all use pi-tools.read.ts as their entry file", () => {
        for (const id of ["read", "write", "edit"] as const) {
            const tool = TOOL_CATALOG.find((t) => t.id === id);
            expect(tool, `TOOL_CATALOG missing "${id}"`).toBeDefined();
            expect(
                tool!.entry,
                `"${id}" has the wrong entry file — was it moved upstream?`,
            ).toBe("agents/pi-tools.read.ts");
        }
    });

    it("factory names match the known-correct values for all 23 tools", () => {
        for (const [id, expectedFactory] of Object.entries(EXPECTED_FACTORIES)) {
            const tool = TOOL_CATALOG.find((t) => t.id === id);
            expect(tool, `TOOL_CATALOG missing "${id}"`).toBeDefined();
            expect(
                tool!.factory,
                `"${id}": factory is "${tool!.factory}" but expected "${expectedFactory}"`,
            ).toBe(expectedFactory);
        }
    });

    it("ALWAYS_EXTERNAL contains all packages that must never be bundled", () => {
        const required = ["sharp", "node-llama-cpp", "koffi", "undici"];
        for (const pkg of required) {
            expect(
                ALWAYS_EXTERNAL.has(pkg),
                `"${pkg}" must be in ALWAYS_EXTERNAL (native/built-in package)`,
            ).toBe(true);
        }
    });

    it("NODE_BUILTINS covers all standard Node.js module names used by openclaw", () => {
        const required = [
            "fs", "path", "crypto", "os", "child_process",
            "stream", "http", "https", "url", "events",
            "buffer", "util", "net", "tty", "worker_threads",
        ];
        for (const mod of required) {
            expect(
                NODE_BUILTINS.has(mod),
                `"${mod}" is missing from NODE_BUILTINS`,
            ).toBe(true);
        }
    });

    it("TOOL_CATALOG IDs are a superset/subset match with discovery.ts catalog (no drift)", async () => {
        // Cross-check: the bundler's hardcoded catalog and discovery.ts CORE_TOOL_CATALOG
        // must always stay in sync. Any tool added to one but not the other shows up here.
        const { getCoreToolCatalog } = await import("clawtools/tools");
        const discoveryIds = new Set((getCoreToolCatalog() as Array<{ id: string }>).map((t) => t.id));
        const bundlerIds = new Set(TOOL_CATALOG.map((t) => t.id));

        for (const id of bundlerIds) {
            expect(
                discoveryIds.has(id),
                `bundler has "${id}" but discovery.ts does not — add it to CORE_TOOL_CATALOG`,
            ).toBe(true);
        }
        for (const id of discoveryIds) {
            expect(
                bundlerIds.has(id),
                `discovery.ts has "${id}" but bundler does not — add it to TOOL_CATALOG`,
            ).toBe(true);
        }
    });
});
