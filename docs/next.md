# Improvement Backlog

> Generated: 2026-02-27. Up to 60 distinct findings across bugs, type-safety, API
> consistency, documentation accuracy, test coverage, and style.
> Severity legend: 🔴 critical · 🟠 major · 🟡 moderate · 🟢 minor

---

## 🔴 Critical Bugs

- [x] **1. Release scripts push to wrong branch.**
  `release:patch/minor/major` in `package.json` all push to `main`; the repo default branch is
  `master`. Every release script fails on the push step. Also affects the PR instructions in
  `CONTRIBUTING.md`.
  > **Investigated**: No `master` branch exists; repo uses `main` + `dev`. Scripts already correctly target `main`. No change needed.

- [x] **2. `ConnectorRegistry` leaks stale `apiIndex` entries on ID overwrite.**
  `src/connectors/registry.ts` — when a connector is re-registered with the same ID but a
  different `api` transport, the old transport entry is never removed. `getByApi()` returns
  entries from both the old and new transports indefinitely.

- [x] **3. `ConnectorRegistry` leaks stale `providerIndex` entries on ID overwrite.**
  Same re-registration path — the old `provider` name continues to resolve to the overwritten
  connector. `getByProvider()` returns the old name after overwrite.

- [x] **4. Gemini schema cleaning omits `"google-gemini-cli"` transport.**
  `src/shared/schema-compat.ts` strips incompatible keywords for `"google"`,
  `"google-generative-ai"`, and `"google-vertex"` but not for `"google-gemini-cli"`. Schemas
  sent to that transport silently retain `minLength`, `pattern`, etc., and may fail
  provider-side validation.

- [x] **5. SSE buffer corruption on final decoded chunk.**
  In the example OpenAI connector, `buffer = lines.pop()!` should be
  `buffer = lines.pop() ?? ""`. `Array.pop()` returns `undefined` on an empty array; the
  next decode iteration concatenates `"undefined" + decoded`, producing corrupted input.

- [x] **6. `profile: "full"` tools appear in every profile query.**
  `src/tools/catalog.ts` — tools registered with `profile: "full"` are included by the
  filter for every profile string (`"coding"`, `"writing"`, etc.), not only when `"full"` is
  explicitly requested. The behavior is undocumented and untested.

---

## 🟠 Type-Safety Issues

- [x] **7. Contradictory `!` assertion + `.filter(Boolean)` in `getByApi()`.**
  `src/connectors/registry.ts` — the non-null assertion `!` and the `.filter(Boolean)` safety
  net are mutually exclusive. Replace with a typed predicate:
  `.filter((c): c is Connector => c !== undefined)`.

- [x] **8. `normalizeToObjectSchema` returns original object by reference on fast-path.**
  `src/shared/schema-compat.ts` — when the schema is already `type: "object"`, the function
  returns the original reference, allowing callers to mutate the stored tool schema in place.
  Should return a shallow copy on all paths.

- [x] **9. `normalizeToObjectSchema` spreads inapplicable string/number keywords into wrapped object schema.**
  A source schema `{ type: "string", minLength: 1 }` becomes
  `{ type: "object", minLength: 1, properties: {} }`. Constraints that are only meaningful
  for the original type should be stripped from the wrapped result.

- [x] **10. Unsafe `as Record<string, unknown>` cast on `properties`.**
  `src/shared/schema-compat.ts` — if `properties` is a non-object primitive (e.g. `true`),
  the cast silently passes TypeScript but produces a wrong downstream value.

- [x] **11. Unsafe `(raw as number)` cast in `params.ts` number coercion.**
  `src/tools/params.ts` — allows booleans, arrays, and objects through the compile-time check.
  The runtime `typeof num !== "number"` guard catches it eventually, but the cast is
  semantically unsound.

- [x] **12. `BooleanParamOptions` not exported from public barrel.**
  Defined in `src/tools/params.ts`, documented in `docs/usage/tools.md`, but missing from
  `src/tools/index.ts` and the top-level `src/index.ts`. Consumers cannot import the type
  from `"clawtools"`.

- [x] **13. `StringParamOptions` and `NumberParamOptions` missing from top-level barrel.**
  Both are re-exported from `src/tools/index.ts` but not from `src/index.ts`. Consumers must
  reach into a sub-path to type their options objects.

- [x] **14. `UsageCost` has all fields required, forcing connectors to synthesize zeros.**
  `src/types.ts` — making cost fields optional would better model "cost unknown" vs "cost is
  zero" and remove the need for synthetic-zero defaults in connectors.

- [x] **15. Inline anonymous usage-info type on `StreamDeltaMessage` should be a named export.**
  Extending usage data (e.g. cache tokens, reasoning tokens) requires callers to duplicate the
  inline shape. A named `UsageInfo` export would allow typed extension.

- [x] **16. `messages as any[]` cast in pi-ai connector bypasses all message-shape validation.**
  `src/connectors/` — a malformed tool-result message produces a silent provider error with no
  diagnostic path. Even a basic runtime shape check at the boundary would help.

---

## 🟠 API & Behavior Inconsistencies

- [x] **17. `loadCoreToolsSync` documented as returning "non-functional tools"; actually returns empty arrays.**
  JSDoc says factories return non-functional tools. In practice, sync factories return `null`
  so `createTool()` returns `[]`. Callers who check `registry.size` vs `createTool()` length
  see different counts, which is confusing without an accurate explanation.

- [x] **18. Failed bundle loads still register a null-returning factory ("ghost registration").**
  `src/tools/catalog.ts` — when a bundle fails to load, `registry.register()` is still called
  with a null-returning factory. The warning says "N tools could not be loaded" but all N
  remain in `getCoreToolCatalog()`. Should either skip registration on failure or document
  the ghost-registration behavior explicitly.

- [x] **19. `resolvePluginPath` is a no-op.**
  `src/plugins/index.ts` — the function returns its input unchanged. Plugins expecting an
  absolute-path back receive the relative string, then resolve it against their own CWD rather
  than the plugin root. The JSDoc footnotes this, but the silent mismatch with OpenClaw's
  behavior is a common footgun.

- [x] **20. `readFile` throws `ENOENT` while `exists` returns `null` — inconsistent error contract.**
  The `FileBridge` interface should specify whether `readFile` throws or returns null for
  missing paths. Currently callers must handle two error modes from the same bridge.

- [x] **21. `writeFile` auto-creates parent directories but the `FileBridge` interface doesn't document it.**
  Custom bridge implementers have no indication they should match this behavior, causing
  inconsistent semantics across implementations.

- [x] **22. Plugin module export preference (default vs `plugin` named export) is undocumented.**
  When both exports are present, the loader silently prefers the named `plugin` export. The
  precedence should be documented in `docs/usage/plugins.md` and in the loader JSDoc.

- [x] **23. Pi-ai connector: empty `models` array on a provider silently produces `undefined` model ID.**
  `src/connectors/` — `getByModel()` can then incorrectly match this connector. A zero-model
  provider should emit a warning.

- [x] **24. Pi-ai connector error handler relies on field name `ev.error` by exact string.**
  If the upstream `@mariozechner/pi-ai` package renames the field, the fallback string
  silently takes over with no diagnostic. Should assert or log the unexpected shape.

- [x] **25. No named type alias for the full message-history union.**
  Consumers who store chat history (including `ToolResultMessage`) cannot type the array
  without casting or manually duplicating the union. A `ContextMessage` or `HistoryMessage`
  export would close this gap.

---

## 🟡 Documentation Errors

- [ ] **26. Tool count "25" is wrong in three places — actual count is 23.**
  `README.md`, `docs/features.md`, and `docs/usage/tools.md` all say "25 core tools". The
  catalog source, `getCoreToolCatalog()`, and the unit test assertion all confirm 23.

- [ ] **27. Tool-groups table lists `apply_patch` and `process` which are not in the catalog.**
  `docs/usage/tools.md` — `group:fs` is documented as `[read, write, edit, apply_patch]` and
  `group:runtime` as `[exec, process]`. The actual group maps in source are `[read, write, edit]`
  and `[exec]`. A source comment explicitly excludes `apply_patch` and `process`.

- [ ] **28. `ToolResultMessage.details` field documented but does not exist in the type.**
  `docs/usage/messages.md` — the field table includes `details: unknown`. The actual interface
  in `src/types.ts` has no `details` field; any user code setting it is rejected by TypeScript.

- [ ] **29. Node.js minimum version contradicted between `package.json` and README.**
  `package.json` declares `"engines": { "node": ">=20.0.0" }`. `README.md` says "Node 18+".
  The CI matrix also tests Node 18, contradicting the engine requirement.

- [ ] **30. Plugin entry-point resolution order documented in wrong sequence.**
  `docs/usage/plugins.md` lists `index.ts → index.js → main → src/index.js → index.mts → index.mjs`.
  Actual code order is `index.ts → index.js → index.mts → index.mjs → main → src/index.js`.
  For plugins with `index.mts`, the docs describe the wrong resolution path.

- [ ] **31. `expandGroups` JSDoc example includes `apply_patch` in `group:fs`.**
  `src/tools/catalog.ts` — the JSDoc example shows `"group:fs" → ["read","write","edit","apply_patch"]`;
  the actual expansion is `["read","write","edit"]`.

- [ ] **32. `onFactoryError` callback has no `@param` JSDoc on any of the three methods that accept it.**
  The parameter is documented in `docs/usage/tools.md` but is undocumented in the source
  signatures of `register()`, `loadCoreTools()`, and `loadCoreToolsSync()`.

- [ ] **33. Module-level JSDoc example calls `createTool()` without a `FileBridge`.**
  The example silently produces empty arrays for all fs tools with no indication to the reader
  that `FileBridge` is required.

- [ ] **34. `loadCoreToolsSync` lacks a `@see` tag pointing to the async variant.**
  Users relying on IDE hover see no indication that an async option exists.

- [ ] **35. `loadCoreToolsSync` JSDoc says factories are "registered lazily" — they are not.**
  The sync path registers null-returning factories immediately. "Lazily" implies
  deferred-but-eventual execution; should say "registered as catalog stubs" or similar.

- [ ] **36. `TODO.md` has completed tasks still marked unchecked.**
  "Add user tool registration" and "Write unit tests" are both implemented but remain as
  `[ ]` items in the file.

- [ ] **37. Duplicated word in `docs/features.md`.**
  "and and an advanced custom bundler" → "and an advanced custom bundler".

- [ ] **38. Typo in `docs/features.md`.**
  "resilliant" → "resilient".

- [ ] **39. Example model ID inconsistency between `examples/agentic/index.ts` and README.**
  The agentic example uses `claude-opus-4-5`; the README Quick Start uses `claude-opus-4-6`.
  Pick one canonical model ID across all examples.

- [ ] **40. Existing `docs/review.md` incorrectly states "Zero runtime dependencies".**
  `@sinclair/typebox`, `ajv`, and `undici` are listed in `dependencies` (not `devDependencies`)
  and will be installed by consumers.

- [ ] **41. Existing `docs/review.md` states `engines: ">=18"`; actual field is `">=20.0.0"`.**

---

## 🟡 Test Gaps

- [ ] **42. `lazy: true` option on `loadCoreTools` has no test coverage.**
  No test verifies that `createTool()` returns `[]` before loading completes and is populated
  after the load resolves.

- [ ] **43. `onFactoryError` positive path is untested.**
  Only the silent-skip behavior is tested. No test verifies the callback is actually invoked
  with the correct tool ID and error object when a factory throws.

- [ ] **44. `loadCoreToolsSync` core invariant (null-factory → empty `createTool()`) is untested.**
  The most important behavioral guarantee of the sync path has no direct assertion.

- [ ] **45. Magic number `23` in discovery test has no explanatory comment.**
  A failure says only "expected 22 to equal 23" with no indication of which tool changed.
  At minimum add a comment; ideally snapshot the tool ID list.

- [ ] **46. `profile: "full"` wildcard behavior (bug #6) has zero test coverage.**
  No test verifies whether `"full"` tools appear or don't appear in non-`"full"` profile
  queries, so the bug can regress silently.

- [ ] **47. No test re-registers a connector with the same ID but a different `api` transport.**
  The stale `apiIndex` bug (#2) is completely uncovered by the existing connector tests.

- [ ] **48. No test re-registers a connector with the same ID but a different `provider` name.**
  The stale `providerIndex` bug (#3) is uncovered.

- [ ] **49. `thinking_delta` / `thinking_end` streaming events have no test coverage.**
  No mock scenario in the invariants suite produces thinking-block events.

- [ ] **50. Multi-tool-call streams are never tested.**
  Only single `toolcall_start…end` blocks are exercised; multiple sequential tool calls in
  one stream are not.

- [ ] **51. Abort test does not verify the abort `reason` / `cause` is propagated.**
  The test asserts rejection but never checks that the cause value is the one passed to
  `AbortController.abort()`.

- [ ] **52. `loadCoreTools` source-path fallback is never unit-tested in isolation.**
  The fallback from the dist bundle path to the TypeScript source path is only exercised
  transitively through integration/e2e tests, many of which are skipped without a build.

- [ ] **53. `vitest.config.ts` `e2e` include pattern matches no files.**
  The pattern points to a directory that contains no test files, producing misleading
  coverage output and a confusing test-suite structure.

---

## 🟢 Style, Naming & Minor Issues

- [ ] **54. `moduleCache` and `loadedModules` in `catalog.ts` are ambiguously named.**
  Could be confused with Node's built-in module registry. `sourceModuleCache` /
  `bundleModuleCache` would be clearer.

- [ ] **55. Destructured `_catalogFactory` in `loadCoreTools` is never used.**
  Should be omitted from the destructuring pattern entirely.

- [ ] **56. Audit `dependencies` vs `devDependencies` for `@sinclair/typebox`, `ajv`, `undici`.**
  All three are marked `external` in the bundle config. Confirm whether they should remain
  in `dependencies` (consumers must install them) or move to `devDependencies` with a peer
  dependency declaration.

- [ ] **57. No `lint` script in `package.json` despite `eslint-disable` comments in source.**
  Either add a linter config + `"lint"` script, or remove the stale disable comments.

- [ ] **58. `"verbatimModuleSyntax": false` in `tsconfig.json`.**
  For a strict ESM-only TypeScript 5.7+ project, `"verbatimModuleSyntax": true` is
  recommended to prevent accidentally-erased type imports.

- [ ] **59. Blank-string error message is identical to missing-parameter error in `params.ts`.**
  LLMs often send whitespace-only strings. Distinguishing "parameter was blank after trimming"
  from "parameter was absent" aids debugging significantly.

- [ ] **60. `"full"` overloads both a profile identifier and a wildcard flag.**
  A dedicated `includeAll: true` boolean on the registry filter method would be clearer than
  overloading the profile string value to mean two different things.
