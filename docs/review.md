# Code Review — clawtools

**Reviewer:** AI (Claude Opus 4.6)
**Date:** 2026-02-26
**Commit:** 9c7eb86 (master)
**Scope:** Full project review
**Test status:** 312 tests passing (9 files), 52.97 s

---

## Table of Contents

1. [package.json](#1-packagejson)
2. [tsconfig.json](#2-tsconfigjson)
3. [vitest.config.ts](#3-vitestconfigts)
4. [.gitignore / .npmignore](#4-gitignore--npmignore)
5. [CI Workflow](#5-ci-workflow)
6. [Publish Workflow](#6-publish-workflow)
7. [src/index.ts](#7-srcindexts)
8. [src/types.ts](#8-srctypests)
9. [src/tools/registry.ts](#9-srctoolsregistryts)
10. [src/tools/discovery.ts](#10-srctoolsdiscoveryts)
11. [src/tools/schema.ts & params.ts](#11-srctoolsschemats--paramsts)
12. [src/tools/helpers.ts](#12-srctoolshelpersts)
13. [src/connectors/*](#13-srcconnectors)
14. [src/plugins/*](#14-srcplugins)
15. [scripts/bundle-core-tools.mjs](#15-scriptsbundle-core-toolsmjs)
16. [Test helpers](#16-test-helpers)
17. [Unit tests — tools](#17-unit-tests--tools)
18. [Unit tests — connectors](#18-unit-tests--connectors)
19. [Unit tests — plugins](#19-unit-tests--plugins)
20. [Integration tests](#20-integration-tests)
21. [Build regression tests](#21-build-regression-tests)
22. [examples/](#22-examples)
23. [docs/](#23-docs)
24. [README & CONTRIBUTING](#24-readme--contributing)
25. [Summary & Recommendations](#25-summary--recommendations)

---

## 1. package.json

**Rating:** ✅ Good

- Version 0.1.0, ESM-only (`"type": "module"`), `engines: ">=20.0.0"` — appropriate pre-release posture.
- Minimal runtime dependencies — `@sinclair/typebox`, `ajv`, and `undici` are in `dependencies`; 20 deps are `devDependencies`.
- Four subpath exports (`.`, `./tools`, `./connectors`, `./plugins`) with correct `types`/`import` conditions.
- `files` array correctly scopes the tarball to `dist/`, `README.md`, `LICENSE`.
- Scripts are well-organized: `build`, `build:tools`, `dev`, `typecheck`, `typecheck:test`, `test`, `test:coverage`, `release:*`.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | 🔴 Bug | `release:*` scripts push to `origin main` but the actual branch is `master`. All three release scripts will fail. |
| 2 | 🟡 Minor | `"build:tools"` runs `node scripts/bundle-core-tools.mjs` — no `--` separator. Works today, but fragile if args are added later. |
| 3 | 🟡 Minor | No `"lint"` script despite `ci.yml` running `npm run typecheck` as lint — convention mismatch, not blocking. |

---

## 2. tsconfig.json

**Rating:** ✅ Good

- `ES2022` target, `NodeNext` module resolution, `strict: true`, `declaration: true`, `sourceMap: true`.
- `outDir: "dist"`, `rootDir: "src"` — clean separation.
- Excludes `test/`, `openclaw/`, `scripts/`, `examples/`, `.build-tmp/`.
- `tsconfig.test.json` extends base and adds `clawtools/*` path aliases matching the vitest config.

**Issues:** None.

---

## 3. vitest.config.ts

**Rating:** ✅ Good

- Node environment, v8 coverage provider targeting `src/`.
- Three test directories: `test/tests-unit`, `test/tests-integration`, `test/test-build`.
- Path aliases (`clawtools`, `clawtools/tools`, `clawtools/connectors`, `clawtools/plugins`) mirror `package.json` exports — tests import the same way consumers would.
- 60-second `testTimeout` accommodates slow bundle-loading tests.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 4 | 🟢 Nit | `hookTimeout: 60_000` is set globally but only needed by the build test file. Could be scoped per-file to speed up failure detection in other suites. |

---

## 4. .gitignore / .npmignore

**Rating:** ✅ Good

- `.gitignore` covers `node_modules/`, `dist/`, `coverage/`, `.build-tmp/`, `tmp/`.
- `.npmignore` excludes `src/`, `test/`, `openclaw/`, `scripts/`, config files — tarball ships only `dist/`.
- Both files are concise and correct.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 5 | 🟡 Minor | Empty `tests/` directory at project root (distinct from `test/`) is tracked by git. Appears stale — `CLAUDE.md` mentions it as "additional/legacy test workspace (may be empty)". Should be removed. |

---

## 5. CI Workflow

**Rating:** ✅ Good

- Three-job pipeline: `lint-typecheck` → `test` (matrix: Node 20/22) → `build`.
- Tests both `typecheck` and `typecheck:test` — catches type errors in test code too.
- `act` guard (`if: ${{ !env.ACT }}`) on build job to skip locally.
- Proper caching of `node_modules` via `actions/setup-node` cache.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 6 | 🔴 Bug | Trigger branches are `[main, dev]` but the repo uses `master`. CI will never trigger on push to `master`. |

---

## 6. Publish Workflow

**Rating:** ✅ Good design, broken config

- Tag-triggered (`v*`), version assertion (tag matches `package.json`), npm provenance, GitHub release creation with auto-generated notes. Pre-release detection for tags containing `-`.
- Clean three-step: build → publish → release.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 7 | 🔴 Bug | Branch filter is `main` (line 27). Tags pushed on `master` won't match. Same root cause as issue #6. |
| 8 | 🟡 Minor | Comment on line 1 says "pushed to main" — stale documentation. |

---

## 7. src/index.ts

**Rating:** ✅ Good

- 280 lines. Clean public API surface.
- `createClawtools()` (sync, catalog-only) and `createClawtoolsAsync()` (async, executable) are well-documented with JSDoc examples explaining the sync/async tradeoff.
- Re-exports all types, registries, helpers, schema utilities, param helpers, plugin loader, and connector discovery.
- `extractToolSchemas()` is a convenience wrapper — useful, well-typed.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 9 | 🟢 Nit | `createClawtools` returns `{ tools, connectors }` but `createClawtoolsAsync` returns `Promise<{ tools, connectors }>`. No named return type — a `Clawtools` interface would add clarity. |

---

## 8. src/types.ts

**Rating:** ✅ Excellent

- 454 lines of standalone type definitions — zero imports from openclaw.
- Covers `Tool`, `ToolResult`, `ContentBlock`, `ToolContext`, `ToolFactory`, `ToolMeta`, `ToolProfile`, `ToolSection`, `Connector`, `ModelDescriptor`, `StreamEvent` (discriminated union with 9 event types), `StreamContext`, `PluginApi` (12 registration methods), `LoadedPlugin`.
- `StreamEvent` is a proper discriminated union — each variant has the right payload shape.
- `PluginApi` documents which methods are no-ops vs active.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 10 | 🟡 Minor | `ToolContext` fields are all optional (`workspaceDir?: string` etc.), which is maximally flexible but means factory code must null-check everything. A `RequiredToolContext` partial type would help consumers who want stronger guarantees. |
| 11 | 🟢 Nit | `StreamEvent` includes `text_end` with `content: string` but `toolcall_end` uses `toolCall: { id, name, arguments }`. The asymmetry is intentional (mirrors OpenClaw) but worth documenting. |

---

## 9. src/tools/registry.ts

**Rating:** ✅ Good

- 268 lines. `ToolRegistry` with `register`, `registerFactory`, `resolveAll`, `resolveByProfile`, `resolve`, `list`, `listBySection`, `unregister`, `clear`.
- Factory resolution wraps errors in try/catch → returns `null` on failure. Silently swallowed.
- `resolveEntry()` caches resolved tools per-call (not globally) — correct for context-dependent factories.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 12 | 🟡 Minor | `resolveByProfile("coding")` includes any tool whose profiles contain `"full"` (line 149: `entry.meta.profiles.includes("full")`). This means tools tagged `profiles: ["full"]` appear in **every** profile, not just when the user requests `"full"`. This may be intentional ("full" = "always available") but is surprising and undocumented. |
| 13 | 🟡 Minor | Factory errors are silently swallowed (caught, returns `null`). No logging or error event. A `debug` callback or `onFactoryError` option would help troubleshooting. |

---

## 10. src/tools/discovery.ts

**Rating:** ✅ Good, with caveats

- 729 lines — the largest file in `src/`. Houses `CORE_TOOL_CATALOG` (23 entries), `CORE_TOOL_GROUPS`, bundle/source discovery, module caching.
- `discoverCoreToolsAsync()` loads from bundles first, falls back to source. Clear separation.
- `CORE_TOOL_GROUPS` enables `group:` prefix expansion in profile configs — well thought out.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 14 | 🟡 Minor | Module-level caches (`bundleModuleCache`, `moduleCache`) are process-global singletons. In a long-running process, these can never be cleared. No `clearCache()` export exists. Not a problem today but limits testability. |
| 15 | 🟡 Minor | `discoverCoreTools()` (sync) registers factories that always return `null` — this is documented in `docs/issues.md` but the function itself has no `@deprecated` or `@see` tag pointing users to the async version. |
| 16 | 🟢 Nit | The 23-entry catalog duplicates metadata that also lives in the bundle manifest. The duplication is justified (catalog is needed before bundles load) but could drift if someone adds a tool to only one place. The regression test anchors in `bundler.test.ts` mitigate this. |

---

## 11. src/tools/schema.ts & params.ts

**Rating:** ✅ Excellent

**schema.ts** (~140 lines):
- `extractToolSchema()` pulls `name`, `description`, `input_schema` from a `Tool`.
- `normalizeSchema()` ensures top-level `type: "object"` and `properties`.
- `cleanSchemaForGemini()` recursively strips 20+ unsupported keywords (`$schema`, `additionalProperties`, `default`, etc.). Thorough.

**params.ts** (255 lines):
- `readStringParam`, `readNumberParam`, `readBooleanParam`, `readStringArrayParam`, `assertRequiredParams`.
- Supports camelCase/snake_case dual lookup — LLMs sometimes send either. Smart.
- Type coercion (string→number, string→boolean "true"/"false"/"1"/"0") handles common LLM output quirks.
- `ToolInputError` (400) and `ToolAuthorizationError` (403) with proper inheritance chain.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 17 | 🟢 Nit | `readStringParam` returns `undefined` for an all-whitespace string (after trimming), which is correct, but `readStringParam({name: "  "}, "name", {required: true})` throws for empty-after-trim. The error message says "required" but doesn't mention it was present-but-blank. Minor UX issue. |

---

## 12. src/tools/helpers.ts

**Rating:** ✅ Good

- ~100 lines. Four result constructors: `jsonResult`, `textResult`, `errorResult`, `imageResult`.
- `imageResult` handles path prefix (`MEDIA:` text block), extraText, and custom details.
- All return `ToolResult` — consistent with the type system.

**Issues:** None.

---

## 13. src/connectors/*

**Rating:** ✅ Good

**registry.ts** (219 lines):
- `ConnectorRegistry` with provider index and API transport index.
- `resolveAuth()` is a clean three-tier resolution: explicit key → envVars → convention (`<PROVIDER>_API_KEY`).
- `unregister()` properly cleans up both indexes.

**discovery.ts** (179 lines):
- `discoverExtensions()` scans `openclaw/extensions/` for `openclaw.plugin.json` manifests.
- Returns `ExtensionInfo[]` with channels/providers metadata.
- `listChannelExtensions()` and `listProviderExtensions()` are convenience filters.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 18 | 🟡 Minor | `resolveAuth` signature is `(provider: string, envVars?: string[], explicitKey?: string)` but the example in `examples/openai-connector/index.ts` calls `resolveAuth(openaiConnector)` passing a `Connector` object. This produces a TS compile error (confirmed: 3 errors in that file). |

---

## 14. src/plugins/*

**Rating:** ✅ Good

**loader.ts** (320 lines):
- `loadPlugins()` scans directories for `openclaw.plugin.json` manifests.
- Resolves entry points: `main` field → `package.json` main → conventional `index.js`/`index.ts`.
- Loads via `import()`, calls `register()` or `activate()` export.
- Builds `PluginApi` with active `registerTool`/`registerConnector` and 10 no-op stubs.
- Returns `LoadedPlugin[]` with collected tools, toolFactories, and connectors.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 19 | 🟡 Minor | `PluginApi.resolvePath()` returns input unchanged (no-op). If a plugin calls `api.resolvePath("./data.json")` expecting a resolved absolute path, it silently gets back the relative string. Could cause runtime failures in plugins that depend on this. Documented in `features.md` but easy to miss. |
| 20 | 🟢 Nit | No error logging when a plugin's entry point fails to load. The plugin is silently skipped (same pattern as bad-plugin test). A `logger` callback would help debugging. |

---

## 15. scripts/bundle-core-tools.mjs

**Rating:** ✅ Excellent

- 469 lines. Clean, well-documented build pipeline.
- Scans all ~3,700 openclaw `.ts` files to discover the complete import surface (avoids tree-shaking bias).
- Classifies packages: resolvable → bundle, always-external → skip, unknown → generate ESM stub.
- ESM stubs use real `class extends` for compatibility (not Proxy).
- Single esbuild pass with code-splitting → 23 entries + ~150 shared chunks.
- Generates `manifest.json` for runtime discovery.
- Properly guarded: only runs `main()` when executed directly, not when imported by tests.
- Cleans up `.build-tmp/` in a `finally` block.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 21 | 🟢 Nit | `ALWAYS_EXTERNAL` includes `undici` with a comment "Bundled with Node 18+" — but `undici` is not actually built-in to Node 18 (it was added to Node's internal modules but `require("undici")` isn't guaranteed). The exclusion is still correct (avoid bundling a large package) but the comment is misleading. |

---

## 16. Test helpers

**Rating:** ✅ Excellent

- Clean separation: `fixtures.ts` (static data), `registry.ts` (factory functions), `plugin.ts` (plugin loader helpers), `mock-server.ts` (lifecycle wrapper).
- `makeMockConnector()` accepts partial overrides — DRY and flexible.
- `fixtureToolRegistry()` vs `coreToolRegistry()` — explicit fast/slow paths.
- `withMockServer()` auto-registers `beforeAll`/`afterAll` hooks — ergonomic.
- Barrel re-export via `index.ts`.

**Issues:** None.

---

## 17. Unit tests — tools

**Rating:** ✅ Excellent

- **registry.test.ts** (~250 lines): Registration, lookup, resolution, profiles, catalog queries, mutation, execution. Good coverage of edge cases (duplicate register, unknown tool, factory error handling).
- **discovery.test.ts** (~130 lines): Catalog shape validation, section enumeration, include/exclude/group filtering.
- **schema.test.ts** (~200 lines): Schema extraction, normalization, Gemini cleaning with recursion, edge cases (missing properties, nested $ref).
- **params.test.ts** (215 lines): All four param readers + assertRequiredParams + error types. Tests camelCase/snake_case fallback, type coercion, edge cases (empty string, whitespace, null).
- **helpers.test.ts** (~120 lines): All four result constructors. Tests null handling, nested objects, image block ordering.

**Issues:** None — thorough and well-structured.

---

## 18. Unit tests — connectors

**Rating:** ✅ Good

- **registry.test.ts** (213 lines): Registration, lookup (by ID, provider, API), mutation (unregister, clear), `resolveAuth` with explicit/env/convention paths.
- Tests properly clean up `process.env` in `finally` blocks.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 22 | 🟢 Nit | No test for `resolveAuth` with an empty `envVars` array and no convention match — currently covered by the "returns undefined when nothing is available" test with `"totally-unknown-provider-xyz"`, but an explicit empty-array test would be clearer. |

---

## 19. Unit tests — plugins

**Rating:** ✅ Good

- **loader.test.ts** (~120 lines): Discovery, filtering (enabled/disabled), tool collection, connector collection, no-op compatibility (hook-compat-plugin), LoadedPlugin shape.
- Tests real plugin loading from `test/resources/plugins/`.
- `echo-plugin` exercises both `registerTool` and `registerConnector` — verifies streaming.
- `bad-plugin` (manifest only, no entry point) is correctly skipped.
- `hook-compat-plugin` calls all no-op methods — verifies they don't throw.

**Issues:** None.

---

## 20. Integration tests

**Rating:** ✅ Excellent

- **app.test.ts** (~190 lines): Full end-to-end with mock HTTP server.
- Tests text streaming (delta assembly, start/done events, stopReason).
- Tests tool call streaming (toolcall_start/delta/end, argument assembly).
- Tests error scenarios (429, 500, 401) — verifies graceful handling.
- Tests request capture (HTTP method, auth header, body shape, model ID, tools array).
- Tests scenario isolation (sequential setScenario calls).

**openai-mock/**: Full OpenAI-compatible mock server (336 lines) with SSE streaming, tool call chunking, non-streaming fallback, request capture. Well-typed with separate `types.ts`.

**testapp/**: Realistic consumer code (272 lines) that uses `createClawtools`, registers a connector, registers a tool, implements SSE parsing, and exposes a `query()` method. This effectively tests the library's public API from a consumer perspective.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 23 | 🟢 Nit | The testapp SSE reader doesn't handle `\r\n` line endings (only `\n`). Not a problem with the mock server, but real-world OpenAI uses `\r\n`. |

---

## 21. Build regression tests

**Rating:** ✅ Excellent

- **bundler.test.ts** (736 lines, 141 tests): Six sections covering source preconditions, import parser, ESM stub generator, TS file walker, bundle loading (including 5 config-gated tool tests), discovery integration, and regression anchors.
- Tests the bundler's exported functions directly (`parseAllImports`, `walkTs`, `generateEsmStub`).
- Tests actual bundle loading from `dist/core-tools/` — verifies each of the 23 tool factories produces a valid tool shape.
- Regression anchors pin catalog size (23), tool IDs, factory names, external packages, and catalog↔discovery consistency.
- Config-gated tests (added in commit 9c7eb86) verify memory tools need `config` and image tool needs `agentDir` + model config.

**Issues:** None — the most thorough test file in the project.

---

## 22. examples/

**Rating:** 🟡 Needs fixes

**openai-connector/** (3 files):
- Demonstrates a minimal OpenAI connector that streams a "Hello world!" response.
- Good README with usage instructions, key concepts, and extension guidance.
- Uses `workspace:*` dependency — only works inside the monorepo.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 24 | 🔴 Bug | `index.ts` line 63: `resolveAuth(openaiConnector)` passes a `Connector` object to a function expecting `string`. Three TS errors in this file. The example is broken and won't compile. Should be `resolveAuth("openai", openaiConnector.envVars)`. |
| 25 | 🟡 Minor | Line 64: `auth.apiKey` — `auth` is possibly `undefined` (return type is `ResolvedAuth | undefined`). Needs a null check or non-null assertion after the throw guard. |
| 26 | 🟡 Minor | The example imports from `../../src/types.js` and `../../src/connectors/index.js` (relative paths into `src/`). A real consumer would use `import from "clawtools"`. This makes the example misleading as a usage guide. |

---

## 23. docs/

**Rating:** ✅ Good overall

- **usage.md** (451 lines): Comprehensive usage guide covering tools, connectors, plugins, parameter helpers, and submodule imports. Code examples are accurate and match the actual API.
- **features.md**: Detailed feature parity table — 64 features tracked across 5 categories. Clear status legend (✅/🔌/🟡/❌). Summary stats: 55% accessible (24 implemented + 11 no-op out of 64).
- **feature_parity_detail.md** (369 lines): Deep gap analysis with expansion paths for each missing feature. Well-written and actionable.
- **issues.md** (139 lines): 5 known issues, all accurately documented (verified in commit 9c7eb86).
- **temp-connectorsmcp.md** (609 lines): Draft architecture doc for MCP integration.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 27 | 🟡 Minor | `temp-connectorsmcp.md` is a draft/temp file in the docs directory. Should either be moved to a planning directory or removed before release. |
| 28 | 🟢 Nit | `usage.md` line 126 references `readBooleanParam` in a code example but the import block doesn't include it (`readStringParam`, `readNumberParam`, `ToolInputError` are imported but not `readBooleanParam`). |

---

## 24. README & CONTRIBUTING

**Rating:** ✅ Good, with issues

**README.md**:
- Good structure: When to use, Installation, Quick Start, Features, Limitations, Architecture, License.
- Features section accurately describes all three subsystems.
- Limitations section is honest and comprehensive — lists exactly what's not supported.
- Architecture diagram matches actual directory layout.

**CONTRIBUTING.md**:
- Clear branch model, workflow, release process, and required GitHub setup.
- `npm run release:*` instructions match `package.json` scripts.

**CLAUDE.md**:
- Thorough agent instructions. Key Principles, Rules for Accessing `./openclaw`, Key Files, Agent Notes — all accurate.
- References empty `tests/` directory as "additional/legacy test workspace (may be empty)" — should be cleaned up.

**TODO.md**:
- Most items checked off. Three remaining: "Add user tool registration support (extensibility)", "Write unit tests", "Publish to npm". The first two are actually done (custom tool registration works, 312 tests exist) — the TODO is stale.

**Issues:**

| # | Severity | Finding |
|---|----------|---------|
| 29 | 🔴 Bug | CONTRIBUTING.md documents `main`/`dev` branch model but the repo uses `master`. All git instructions will fail. |
| 30 | 🟡 Minor | README.md line 5: "and and an advanced custom bundler" — duplicated "and". Also, "resilliant" → "resilient" (typo). |
| 31 | 🟡 Minor | TODO.md is stale — "Write unit tests" is unchecked but 312 tests exist. Should be updated or removed. |

---

## 25. Summary & Recommendations

### Overall Assessment

**clawtools is a well-engineered library with excellent test coverage and clear architecture.** The codebase is clean, well-typed, well-documented, and follows good ESM practices. The build pipeline (esbuild bundler with ESM stub generation) is genuinely novel and thoroughly tested. The test infrastructure (mock server, testapp, resource plugins) is production-quality.

### Statistics

| Metric | Value |
|--------|-------|
| Source lines (src/) | ~2,200 |
| Test lines (test/) | ~3,000 |
| Test:source ratio | ~1.4:1 |
| Test files | 9 |
| Test count | 312 |
| Runtime dependencies | 3 |
| Core tools bundled | 23 |
| Type coverage | strict mode, no `any` casts |

### Issue Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 4 | Branch name mismatch (`main` vs `master`) breaks CI, publish, release scripts, and CONTRIBUTING docs |
| 🟡 Minor | 12 | Stale TODO, temp doc file, example TS errors, missing imports in usage.md, silent error swallowing, undocumented profile behavior |
| 🟢 Nit | 7 | Naming suggestions, comment accuracy, minor UX improvements |

### Critical Fix: Branch Name

The single highest-impact fix is renaming `master` → `main` (or updating all references to `master`). This affects:
- `.github/workflows/ci.yml` (lines 14, 16)
- `.github/workflows/publish.yml` (lines 1, 4, 18, 27)
- `package.json` (lines 54–56, release scripts)
- `CONTRIBUTING.md` (throughout)

Until this is fixed, **CI will never trigger and releases cannot be published**.

### Priority Recommendations

1. **Fix branch name mismatch** — rename branch or update all refs. (Blocking)
2. **Fix examples/openai-connector/index.ts** — 3 TS compile errors. (User-facing)
3. **Remove empty `tests/` directory** — confusing alongside `test/`.
4. **Update TODO.md** — check off completed items or remove the file.
5. **Move `docs/temp-connectorsmcp.md`** — out of docs before release.
6. **Fix README.md typos** — "and and", "resilliant".
7. **Add `@see` / `@deprecated` hints** to `discoverCoreTools()` pointing to the async version.
8. **Document `resolveByProfile` "full" behavior** — tools with `profiles: ["full"]` appear in all profiles.
9. **Consider adding a factory error callback** to `ToolRegistry` for debuggability.
10. **Add `clearCache()` export** to `discovery.ts` for long-running process support.

