# Known Issues

This file documents limitations and known issues that cannot currently be fixed
without upstream changes or significant architectural rework.

---

## 1. Synchronous `discoverCoreTools` returns non-executable tools

**Status:** By design — documented as catalog-only.

`discoverCoreTools()` (the synchronous entry point) registers tool metadata and
lazy factory stubs, but the factories always return `null` at call time because
ESM dynamic `import()` is inherently asynchronous. Calling `resolveAll()` on a
registry populated by `discoverCoreTools()` returns empty tools.

**Workaround:** Use `discoverCoreToolsAsync()` or `createClawtoolsAsync()` to
load pre-built bundles; then `resolveAll()` works normally.

The sync function is kept for catalog/metadata-only use-cases (listing tools,
filtering by profile, generating documentation) where the `execute` method is
never called.

---

## 2. `createClawtools()` produces non-executable tools

**Status:** By design — documented in JSDoc.

The synchronous `createClawtools()` convenience function internally calls
`discoverCoreTools()`, which means `ct.tools.resolveAll()` returns tools whose
`execute` methods throw (wrapped to return `null`). The companion async function
`createClawtoolsAsync()` is the correct path for executable tools.

**Workaround:** Replace `createClawtools()` with `await createClawtoolsAsync()`.

---

## 3. Three core tools require explicit configuration in `ToolContext`

**Status:** By design — configuration-gated, not broken.

`memory_search`, `memory_get`, and `image` are fully bundled in `dist/core-tools/`
and their factories work correctly when called with the right `ToolContext`. They
do **not** require a live OpenClaw runtime or daemon.

When `resolveAll()` is called with an empty context (`{}`), these three return
`null` because their factories need specific fields:

- **`memory_search` / `memory_get`** — require `config` to be set (any object,
  even `{}`, is sufficient). Without `config` the factory returns `null`.
- **`image`** — requires `agentDir` (non-empty string) **and** either explicit
  model config (`config.agents.defaults.imageModel`) or auth-profile files in
  `agentDir`. Does **not** depend on the native `sharp` module.

**Usage — memory tools:**
```ts
const ct = await createClawtoolsAsync();
const tools = ct.tools.resolveAll({ config: {} });
// → memory_search and memory_get are included
```

**Usage — image tool:**
```ts
const ct = await createClawtoolsAsync();
const tools = ct.tools.resolveAll({
  agentDir: "/path/to/agent",
  config: { agents: { defaults: { imageModel: "openai/gpt-4o" } } },
});
// → image tool is included (execute still needs a valid API key)
```

**Impact:** `resolveAll()` with an empty context silently omits these tools.
Users must supply the appropriate `ToolContext` fields to enable them. The tools
instantiate (factory returns non-null), but execution of memory tools requires
accessible memory backends and execution of the image tool requires valid API
credentials.

---

## 4. Bundle compile time is high (~30 s)

**Status:** Known limitation of the esbuild code-splitting approach.

The full `npm run build` takes approximately 30–45 seconds because esbuild must
bundle and tree-shake 3,700+ openclaw TypeScript source files, generate ESM
stubs for ~15 unresolvable packages, and produce 23 entry bundles + ~150 shared
chunks.

There is no incremental build; every `npm run build` is a full rebuild.

**Workaround:** `npm run build:tools` re-runs only the bundler step (skipping
`tsc`), which is useful when iterating on the bundle script. For CI, the build
artifact is cached by the publish workflow.

---

## 5. Bundle-loading tests exceed the default vitest 5 s timeout on slow machines

**Status:** Fixed in test suite — 60 s `beforeAll` timeout applied.

The first `import()` of bundles that pull in large shared chunks (read/write/edit
share a 3.7 MB chunk; exec and sessions_spawn load native modules) can take
5–15 s on cold JIT. The test suite pre-warms all 23 bundles in parallel inside a
`beforeAll` with a 60 s timeout, making individual test assertions fast.

If this timeout is still exceeded on very slow CI hardware, set the environment
variable `VITEST_TEST_TIMEOUT=120000` or increase the `beforeAll` timeout in
[`test/test-build/bundler.test.ts`](../test/test-build/bundler.test.ts).

---

## 6. `act` runs the CI on Node 16 (Debian Buster) image by default

**Status:** Local environment limitation.

`act` defaults to `node:16-buster-slim` when the workflow requests
`ubuntu-latest`, which is Node 16 rather than the GitHub-hosted Node 22. This
causes `npm ci` to install a different package set than the real CI. The actual
GitHub Actions workflows run on `ubuntu-latest` with Node 18/20/22 as specified.

Running `act` with `--platform ubuntu-latest=catthehacker/ubuntu:act-22.04` uses
a closer image but requires a larger container pull.

---

## 7. Plugin loader only handles pre-compiled JavaScript plugins

**Status:** By design — documented in loader JSDoc.

`loadPlugins()` uses Node's native `import()`, which in Node 18/20 cannot
execute `.ts` files directly. OpenClaw's own plugin loader uses
[jiti](https://github.com/unjs/jiti) for TypeScript-transparent loading;
clawtools does not include that dependency to keep the package lightweight.

**Workaround:** Pre-compile plugins to JavaScript before loading them through
clawtools. Under Node 22+ with `--experimental-strip-types`, `.ts` entry points
may work if the plugin uses only type-only TypeScript syntax.
