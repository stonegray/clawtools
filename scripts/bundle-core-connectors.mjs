/**
 * bundle-core-connectors.mjs — Build-time bundler for built-in LLM connectors.
 *
 * Bundles `src/connectors/pi-ai-bridge.ts` (and all its transitive dependencies,
 * including @mariozechner/pi-ai and its provider SDKs) into a single standalone
 * ESM module at `dist/core-connectors/builtins.js`.
 *
 * Unlike the tool bundler, this script is simple: pi-ai and its SDKs are all
 * present in node_modules (as transitive devDependencies), so no stubbing is
 * needed. We just compile the TypeScript bridge + inline all npm deps.
 *
 * The output is self-contained — no external runtime dependencies. The only
 * externals are Node.js builtins (node:fs, node:path, …) and a small set of
 * native-code or process-bound packages that cannot be bundled.
 */

import * as esbuild from "esbuild";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENTRY = join(ROOT, "src", "connectors", "pi-ai-bridge.ts");
const OUTDIR = join(ROOT, "dist", "core-connectors");
const OUTFILE = join(OUTDIR, "builtins.js");

// ─── Node.js built-in module names (without the "node:" prefix) ──────────────
// esbuild handles "node:*" as external automatically, but some older imports
// may omit the prefix.

const NODE_BUILTINS = new Set([
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

// Packages that contain native (.node) addons, are real runtime dependencies
// (and therefore already available to the consumer), or cannot be bundled.
// They are marked external — callers must install them separately.
const ALWAYS_EXTERNAL = new Set([
    // Native addons
    "koffi",
    "@lydell/node-pty",
    "sharp",
    "node-llama-cpp",
    // Real runtime dependencies listed in package.json#dependencies —
    // externalising avoids duplicating these in the bundle and lets the
    // consumer share a single install.
    // NOTE: undici also transitively removes ~1.5 MB of AST tooling
    // (quickjs-emscripten, esprima, ast-types, escodegen) pulled in via
    // pac-resolver → degenerator.
    "undici",
    "@sinclair/typebox",
    "ajv",
]);

// ─── esbuild plugin ───────────────────────────────────────────────────────────

/**
 * Minimal esbuild plugin that:
 *  - Externalises Node builtins referenced without the `node:` prefix
 *  - Externalises always-external native packages
 *  - Provides a fallback stub for any remaining unresolvable import so the
 *    build never hard-fails due to an optional or platform-specific dep
 */
const resolverPlugin = {
    name: "connector-resolver",
    setup(build) {
        // Bare Node built-ins (without node: prefix) → mark external
        build.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.pluginData?.skip) return null;
            if (NODE_BUILTINS.has(args.path)) {
                return { path: "node:" + args.path, external: true };
            }
            return null;
        });

        // Always-external native packages
        for (const pkg of ALWAYS_EXTERNAL) {
            const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            build.onResolve({ filter: new RegExp(`^${escaped}`) }, (args) => ({
                path: args.path,
                external: true,
            }));
        }

        // Catch-all: attempt normal resolution; stub anything that fails
        build.onResolve({ filter: /^[^./]/ }, async (args) => {
            if (args.pluginData?.skip) return null;
            if (args.path.startsWith("node:")) return null;

            try {
                const result = await build.resolve(args.path, {
                    kind: args.kind,
                    resolveDir: args.resolveDir,
                    pluginData: { skip: true },
                });
                if (result.errors.length === 0) {
                    // Native addon — keep external
                    if (result.path.endsWith(".node")) {
                        return { path: args.path, external: true };
                    }
                    return result;
                }
            } catch { /* fall through to stub */ }

            console.warn(`  [connectors] stubbing unresolvable import: ${args.path}`);
            return { path: args.path, namespace: "fallback-stub" };
        });

        // Fallback stub loader
        build.onLoad({ filter: /.*/, namespace: "fallback-stub" }, (args) => ({
            contents: [
                `// Fallback stub for "${args.path}"`,
                `class _S { constructor(...a) {} }`,
                `export default _S;`,
            ].join("\n"),
            loader: "js",
        }));

        // .node native modules → empty stub
        build.onLoad({ filter: /\.node$/ }, () => ({
            contents: "module.exports = {};",
            loader: "js",
        }));
    },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log("Building core connectors bundle...");
    console.log(`  Entry:  ${ENTRY}`);
    console.log(`  Output: ${OUTFILE}`);

    if (existsSync(OUTDIR)) {
        rmSync(OUTDIR, { recursive: true });
    }
    mkdirSync(OUTDIR, { recursive: true });

    const result = await esbuild.build({
        entryPoints: { builtins: ENTRY },
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node18",
        outdir: OUTDIR,
        splitting: false,     // single-file output — no dynamic split chunks needed
        treeShaking: true,
        minify: false,        // leave readable for debugging provider issues
        write: true,
        logLevel: "warning",
        metafile: true,
        plugins: [resolverPlugin],
        external: ["node:*", ...ALWAYS_EXTERNAL],
        // Some AWS SDK files use __dirname; provide a CJS shim
        banner: {
            js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
        },
        nodePaths: [join(ROOT, "node_modules")],
    });

    // Report output size
    const outputs = result.metafile?.outputs ?? {};
    for (const [outPath, info] of Object.entries(outputs)) {
        const kb = (info.bytes / 1024).toFixed(1);
        console.log(`  → ${outPath}  (${kb} kB)`);
    }

    const warnings = result.warnings.length;
    if (warnings > 0) {
        console.warn(`  ${warnings} warning(s) during connector bundle`);
    }

    console.log("Core connectors bundle complete.");
}

main().catch((err) => {
    console.error("Connector bundle failed:", err);
    process.exit(1);
});
