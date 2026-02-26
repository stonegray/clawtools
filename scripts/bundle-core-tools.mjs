/**
 * bundle-core-tools.mjs — Build-time patching pipeline for openclaw tools.
 *
 * Bundles each openclaw tool factory into a standalone ESM module that:
 * - Resolves all 1,400+ internal .ts imports at build time (the "patch")
 * - Inlines universal npm deps (typebox, chalk, tslog, etc.)
 * - Auto-stubs any unresolvable package with correct ESM named exports
 * - Outputs compiled JS that works on Node 18+ — no TypeScript runtime needed
 *
 * Build strategy:
 *   1. Scan all original .ts source files to discover the complete import surface
 *      (avoids tree-shaking bias that would miss named imports from stubbed packages)
 *   2. Classify each package: resolvable (in node_modules), always-external, or stub
 *   3. Generate ESM stubs with real class exports for `class extends` compatibility
 *   4. Single esbuild pass with code splitting → standalone ESM bundles
 */

import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OPENCLAW_SRC = join(ROOT, "openclaw", "src");
const OUTDIR = join(ROOT, "dist", "core-tools");
const TMP = join(ROOT, ".build-tmp");

// ─── Tool Catalog ────────────────────────────────────────────────────────────

export const TOOL_CATALOG = [
    { id: "read", entry: "agents/pi-tools.read.ts", factory: "createSandboxedReadTool" },
    { id: "write", entry: "agents/pi-tools.read.ts", factory: "createSandboxedWriteTool" },
    { id: "edit", entry: "agents/pi-tools.read.ts", factory: "createSandboxedEditTool" },
    { id: "exec", entry: "agents/bash-tools.exec.ts", factory: "createExecTool" },
    { id: "web_search", entry: "agents/tools/web-search.ts", factory: "createWebSearchTool" },
    { id: "web_fetch", entry: "agents/tools/web-fetch.ts", factory: "createWebFetchTool" },
    { id: "memory_search", entry: "agents/tools/memory-tool.ts", factory: "createMemorySearchTool" },
    { id: "memory_get", entry: "agents/tools/memory-tool.ts", factory: "createMemoryGetTool" },
    { id: "sessions_list", entry: "agents/tools/sessions-list-tool.ts", factory: "createSessionsListTool" },
    { id: "sessions_history", entry: "agents/tools/sessions-history-tool.ts", factory: "createSessionsHistoryTool" },
    { id: "sessions_send", entry: "agents/tools/sessions-send-tool.ts", factory: "createSessionsSendTool" },
    { id: "sessions_spawn", entry: "agents/tools/sessions-spawn-tool.ts", factory: "createSessionsSpawnTool" },
    { id: "subagents", entry: "agents/tools/subagents-tool.ts", factory: "createSubagentsTool" },
    { id: "session_status", entry: "agents/tools/session-status-tool.ts", factory: "createSessionStatusTool" },
    { id: "browser", entry: "agents/tools/browser-tool.ts", factory: "createBrowserTool" },
    { id: "canvas", entry: "agents/tools/canvas-tool.ts", factory: "createCanvasTool" },
    { id: "message", entry: "agents/tools/message-tool.ts", factory: "createMessageTool" },
    { id: "cron", entry: "agents/tools/cron-tool.ts", factory: "createCronTool" },
    { id: "gateway", entry: "agents/tools/gateway-tool.ts", factory: "createGatewayTool" },
    { id: "nodes", entry: "agents/tools/nodes-tool.ts", factory: "createNodesTool" },
    { id: "agents_list", entry: "agents/tools/agents-list-tool.ts", factory: "createAgentsListTool" },
    { id: "image", entry: "agents/tools/image-tool.ts", factory: "createImageTool" },
    { id: "tts", entry: "agents/tools/tts-tool.ts", factory: "createTtsTool" },
];

// ─── Packages that can never be bundled ──────────────────────────────────────

export const ALWAYS_EXTERNAL = new Set([
    // Native addons / platform-specific
    "sharp",
    "node-llama-cpp",
    "koffi",
    "@lydell/node-pty",
    "@mariozechner/clipboard-linux-x64-gnu",
    // Real runtime dependencies — consumers have these installed via
    // package.json#dependencies, so we keep them external to avoid
    // duplicating them in the bundle and to allow version sharing.
    "undici",
    "@sinclair/typebox",
    "ajv",
]);

export const NODE_BUILTINS = new Set([
    "assert", "assert/strict", "async_hooks", "buffer", "child_process",
    "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel",
    "dns", "dns/promises", "domain", "events", "fs", "fs/promises", "http",
    "http2", "https", "inspector", "module", "net", "os", "path", "path/posix",
    "path/win32", "perf_hooks", "process", "punycode", "querystring", "readline",
    "readline/promises", "repl", "stream", "stream/consumers", "stream/promises",
    "stream/web", "string_decoder", "sys", "timers", "timers/promises", "tls",
    "trace_events", "tty", "url", "util", "util/types", "v8", "vm",
    "worker_threads", "zlib",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function packageName(spec) {
    if (spec.startsWith("@")) return spec.split("/").slice(0, 2).join("/");
    return spec.split("/")[0];
}

function getEntryMap() {
    const entryMap = {};
    for (const tool of TOOL_CATALOG) {
        const fullPath = join(OPENCLAW_SRC, tool.entry);
        const key = tool.entry.replace(/[\/\.]/g, "_");
        entryMap[key] = fullPath;
    }
    return entryMap;
}

/**
 * Parse all import statements from source (handles multi-line TS imports).
 * Returns Map<specifier, { names: Set<string>, hasDefault: boolean, hasNamespace: boolean }>
 */
export function parseAllImports(source) {
    const result = new Map();

    function ensure(spec) {
        if (!result.has(spec)) result.set(spec, { names: new Set(), hasDefault: false, hasNamespace: false });
        return result.get(spec);
    }

    // Normalize source: collapse multi-line imports to single lines
    // Matches `import ... from "pkg"` even across newlines
    const normalized = source.replace(
        /\bimport\s*\{[^}]*\}\s*from/g,
        (m) => m.replace(/\n/g, " ")
    );
    // Also collapse `import X, { ... } from`
    const normalized2 = normalized.replace(
        /\bimport\s+\w+\s*,\s*\{[^}]*\}\s*from/g,
        (m) => m.replace(/\n/g, " ")
    );

    // Static: import { A, B as C } from "pkg"
    //         import X from "pkg"
    //         import * as X from "pkg"
    //         import X, { A, B } from "pkg"
    // NOTE: also matches `import type { X }` — we filter those out below
    const staticRe = /\bimport\s+(.*?)\s+from\s+["']([^"']+)["']/g;
    for (const m of normalized2.matchAll(staticRe)) {
        let clause = m[1].trim();
        const spec = m[2];

        // Skip type-only imports: `import type { X } from "pkg"`
        if (/^type\s+/.test(clause)) continue;

        // Skip relative/absolute imports, node builtins
        if (spec.startsWith(".") || spec.startsWith("/")) continue;
        if (spec.startsWith("node:") || NODE_BUILTINS.has(spec)) continue;
        const info = ensure(spec);

        // namespace: * as X
        if (/^\*\s+as\s+/.test(clause)) {
            info.hasNamespace = true;
            continue;
        }

        // Check for default + named: X, { A, B }
        const defaultAndNamed = clause.match(/^(\w+)\s*,\s*\{([^}]*)\}/);
        if (defaultAndNamed) {
            info.hasDefault = true;
            for (const part of defaultAndNamed[2].split(",")) {
                const trimmed = part.trim();
                // Skip inline type-only bindings: `import { type X, Y }` — X must not appear in stub
                if (/^type\s+/.test(trimmed)) continue;
                const name = trimmed.split(/\s+as\s+/)[0].trim();
                if (name) info.names.add(name);
            }
            continue;
        }

        // named only: { A, B }
        const namedOnly = clause.match(/^\{([^}]*)\}/);
        if (namedOnly) {
            for (const part of namedOnly[1].split(",")) {
                const trimmed = part.trim();
                // Skip inline type-only bindings: `import { type X, Y }` — X must not appear in stub
                if (/^type\s+/.test(trimmed)) continue;
                const name = trimmed.split(/\s+as\s+/)[0].trim();
                if (name) info.names.add(name);
            }
            continue;
        }

        // default only: X
        if (/^\w+$/.test(clause)) {
            info.hasDefault = true;
        }
    }

    // Dynamic: import("pkg") — these just need the module to be loadable
    const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const m of source.matchAll(dynamicRe)) {
        const spec = m[1];
        if (spec.startsWith("node:") || NODE_BUILTINS.has(spec) || spec.startsWith(".")) continue;
        ensure(spec);
    }

    return result;
}

/**
 * Walk all .ts files under a directory (recursively).
 * Skips .d.ts declaration files, node_modules/, and .git/.
 * Gracefully skips broken symlinks and unreadable entries.
 */
export function walkTs(dir) {
    const files = [];
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return files; // directory not readable — return empty
    }
    for (const entry of entries) {
        const full = join(dir, entry);
        let stat;
        try {
            stat = statSync(full);
        } catch {
            continue; // broken symlink or permission error — skip
        }
        if (stat.isDirectory() && entry !== "node_modules" && entry !== ".git") {
            files.push(...walkTs(full));
        } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
            files.push(full);
        }
    }
    return files;
}

/**
 * Scan ALL original TypeScript source files under openclaw/src/ for import
 * statements. Returns the complete import surface — no tree-shaking bias.
 */
function scanOriginalSource() {
    console.log("Scanning original source for import surface...");

    const allImports = new Map();
    const tsFiles = walkTs(OPENCLAW_SRC);
    console.log(`  Scanning ${tsFiles.length} .ts files...`);

    for (const file of tsFiles) {
        const source = readFileSync(file, "utf8");
        const fileImports = parseAllImports(source);

        for (const [spec, info] of fileImports) {
            const existing = allImports.get(spec);
            if (existing) {
                existing.hasDefault = existing.hasDefault || info.hasDefault;
                existing.hasNamespace = existing.hasNamespace || info.hasNamespace;
                for (const n of info.names) existing.names.add(n);
            } else {
                allImports.set(spec, { ...info, names: new Set(info.names) });
            }
        }
    }

    console.log(`  Found ${allImports.size} external package specifiers`);

    return allImports;
}

/**
 * Generate an ESM stub module with the correct named exports.
 * Uses real class constructors (not Proxies) so `class extends Stub` works.
 */
export function generateEsmStub(specifier, importInfo) {
    const lines = [
        `// Auto-generated ESM stub for "${specifier}"`,
        `// This package was not available at build time.`,
        ``,
        `class _Stub { constructor(...a) {} }`,
        `const _noop = (...a) => undefined;`,
    ];

    if (importInfo.hasDefault) {
        lines.push(`export default _Stub;`);
    }

    for (const name of importInfo.names) {
        // Heuristic: uppercase first letter = class, lowercase = function/const
        if (name[0] === name[0].toUpperCase() && /^[A-Z]/.test(name)) {
            lines.push(`export class ${name} extends _Stub {}`);
        } else {
            lines.push(`export const ${name} = _noop;`);
        }
    }

    if (importInfo.hasNamespace && !importInfo.hasDefault) {
        lines.push(`export default _Stub;`);
    }

    return lines.join("\n") + "\n";
}

// ─── Bundle: Single pass with ESM stubs ─────────────────────────────────────

async function bundle(allImports) {
    console.log("Generating stubs and bundling...");

    const stubDir = join(TMP, "stubs");
    mkdirSync(stubDir, { recursive: true });

    // Classify each external import
    const stubMap = new Map();   // specifier → stub file path
    const realPkgs = [];
    const externalPkgs = [];

    for (const [spec, info] of allImports) {
        const pkg = packageName(spec);

        // Always-external packages (native, undici, etc.)
        if (ALWAYS_EXTERNAL.has(pkg)) {
            externalPkgs.push(spec);
            continue;
        }

        // Check if package is installed in our node_modules
        const testPath = join(ROOT, "node_modules", pkg, "package.json");
        if (existsSync(testPath)) {
            realPkgs.push(spec);
            continue;
        }

        // Generate ESM stub
        const safeName = spec.replace(/[\/@]/g, "_").replace(/[^a-zA-Z0-9_-]/g, "_");
        const stubPath = join(stubDir, `${safeName}.mjs`);
        writeFileSync(stubPath, generateEsmStub(spec, info));
        stubMap.set(spec, stubPath);
    }

    console.log(`  ${realPkgs.length} packages resolved from node_modules`);
    console.log(`  ${externalPkgs.length} packages marked external`);
    console.log(`  ${stubMap.size} packages stubbed:`);
    for (const [spec] of stubMap) console.log(`    → ${spec}`);

    // esbuild plugin: redirect stubs + catch any missed packages
    const stubPlugin = {
        name: "openclaw-stubs",
        setup(build) {
            // Exact-match redirects for known stubs
            for (const [spec, stubPath] of stubMap) {
                const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
                    path: stubPath,
                }));
            }

            // Always-external packages
            for (const pkg of ALWAYS_EXTERNAL) {
                const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                build.onResolve({ filter: new RegExp(`^${escaped}`) }, (args) => ({
                    path: args.path, external: true,
                }));
            }

            // Bare Node built-ins (without node: prefix)
            build.onResolve({ filter: /^[^./]/ }, (args) => {
                if (args.pluginData?.skip) return null;
                if (NODE_BUILTINS.has(args.path)) {
                    return { path: "node:" + args.path, external: true };
                }
                return null;
            });

            // Catch-all: any remaining unresolvable package gets a fallback stub
            build.onResolve({ filter: /^[^./]/ }, async (args) => {
                if (args.pluginData?.skip) return null;
                if (args.path.startsWith("node:")) return null;

                // Try normal resolution
                try {
                    const result = await build.resolve(args.path, {
                        kind: args.kind,
                        resolveDir: args.resolveDir,
                        pluginData: { skip: true },
                    });
                    if (result.errors.length === 0) {
                        if (result.path.endsWith(".node")) {
                            return { path: args.path, external: true };
                        }
                        return result;
                    }
                } catch { /* resolution failed */ }

                // Generate a minimal fallback stub
                return { path: args.path, namespace: "fallback-stub" };
            });

            build.onLoad({ filter: /.*/, namespace: "fallback-stub" }, (args) => ({
                contents: [
                    `// Fallback stub for "${args.path}"`,
                    `class _S { constructor(...a) {} }`,
                    `export default _S;`,
                ].join("\n"),
                loader: "js",
            }));

            // Handle .node files
            build.onLoad({ filter: /\.node$/ }, () => ({
                contents: "module.exports = {};",
                loader: "js",
            }));
        },
    };

    // Clean output
    if (existsSync(OUTDIR)) rmSync(OUTDIR, { recursive: true });
    mkdirSync(OUTDIR, { recursive: true });

    const result = await esbuild.build({
        entryPoints: getEntryMap(),
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node18",
        outdir: OUTDIR,
        splitting: true,
        treeShaking: true,
        minify: true,
        write: true,
        logLevel: "warning",
        metafile: true,
        plugins: [stubPlugin],
        external: ["node:*", ...ALWAYS_EXTERNAL],
        banner: {
            js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
        },
        nodePaths: [join(ROOT, "node_modules")],
    });

    // Report sizes
    const outputs = result.metafile.outputs;
    let totalSize = 0, entryCount = 0, chunkCount = 0;
    for (const [, info] of Object.entries(outputs)) {
        totalSize += info.bytes;
        if (info.entryPoint) entryCount++;
        else chunkCount++;
    }
    console.log(`\nOutput: ${entryCount} entries + ${chunkCount} shared chunks`);
    console.log(`Total size: ${(totalSize / 1024).toFixed(0)} KB (${(totalSize / 1024 / 1024).toFixed(1)} MB)`);

    return result;
}

// ─── Generate manifest ───────────────────────────────────────────────────────

function generateManifest() {
    const manifest = {};
    for (const tool of TOOL_CATALOG) {
        const key = tool.entry.replace(/[\/\.]/g, "_");
        manifest[tool.id] = {
            bundle: `./core-tools/${key}.js`,
            factory: tool.factory,
        };
    }
    const manifestPath = join(OUTDIR, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Manifest: ${manifestPath}`);
    return manifest;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log("=== OpenClaw Tool Bundler ===\n");

    if (!existsSync(OPENCLAW_SRC)) {
        console.error(`ERROR: openclaw source not found at ${OPENCLAW_SRC}`);
        console.error("  git submodule update --init");
        process.exit(1);
    }

    mkdirSync(TMP, { recursive: true });

    try {
        const allImports = scanOriginalSource();
        await bundle(allImports);
        generateManifest();
        console.log("\n✓ Core tool bundles ready.");
    } finally {
        if (existsSync(TMP)) rmSync(TMP, { recursive: true });
    }
}

// Only run main() when executed directly (`node bundle-core-tools.mjs`),
// not when imported as a module (e.g. by the test suite).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error("Bundle failed:", err);
        process.exit(1);
    });
}
