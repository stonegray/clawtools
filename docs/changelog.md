# Changelog

All notable changes to clawtools are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.2.0] — 2026-03-01

53 commits, 64 files changed, 4 144 insertions, 1 389 deletions.
Test suite: 552 tests across 21 files (up from ~307 at v0.1.0).

## [Unreleased]

*No changes yet.*

### Added

- **Debug connector** (`builtin/clawfice-debug`) — 8 deterministic models for
  testing (echo, parrot, silent, upper-parrot, tagged-parrot, sys-echo,
  inspect-echo, thinking-stream).
- **Message types** — `UserMessage`, `AssistantMessage`, `ToolResultMessage`
  exported from `clawtools`; `StreamContext.messages` accepts the union.
- **`serializeModel()` / `deserializeModel()`** — lossless camelCase↔snake_case
  conversion for persisting `ModelDescriptor` to databases or REST APIs.
- **`extractToolSchema()` / `extractToolSchemas()`** — convert resolved tools
  into LLM-consumable function-call schemas with Gemini compatibility cleaning.
- **`resolveAuth()` discriminated union** — `ResolvedAuth` now distinguishes
  `api-key` vs future auth modes; `apiKey` is required when `mode === "api-key"`.
- **`ConnectorRegistry` iterable** — `for (const c of registry)` works via
  `Symbol.iterator`.
- **`Connector.models` required** — required now, plus optional `listModels()` for
  dynamic catalogs.
- **`onError` callback** — `resolveAll()`/`resolveByProfile()`/`resolve()` accept
  an `onError` handler for factory failures.
- **Stream event JSDoc** — every variant documented; `toolcall_start` and
  `toolcall_delta` gain optional `id` field.
- **Abort signal support** — `StreamOptions.signal` cancels mid-stream.


### Changed

- **Async-by-default naming** — `createClawtools()` is now the primary async
  entry point (was `createClawtoolsAsync()`); the sync variant is
  `createClawtoolsSync()`. Old names remain as deprecated aliases.
- **`discoverBuiltinConnectors()`** — renamed from
  `discoverBuiltinConnectorsAsync()`; result is memoized after first call.
- **Dependencies updated** — vitest 3→4, eslint 9→10, typescript 5.7→5.9,
  @types/node 22→24, @aws-sdk/client-bedrock 3.998→3.1000,
  @mariozechner/pi-* 0.55.0→0.55.3.
- **Node.js baseline** — engines ≥20 → **≥22**; CI matrix [20, 22, 25] →
  **[22, 24]**; build/publish use Node 24.
- **tsconfig target** — ES2022 → **ES2024** (unlocks `Object.groupBy`,
  `Promise.withResolvers`, `Set` methods, etc.).
- **`baseUrl` removed** from `tsconfig.json` and `tsconfig.test.json`
  (deprecated in TS 7.0, unnecessary with `paths`).
- **`release:*` scripts** still reference `origin main` (correct — matches
  the remote default branch).

### Fixed

- **137 TypeScript diagnostics** resolved across src/ and test/.
- **Connector re-registration** — stale `apiIndex` and `providerIndex` entries
  are now cleaned up when overwriting a connector.
- **SSE buffer corruption** — empty `Array.pop()` no longer injects `undefined`
  into the SSE buffer.
- **Gemini schema cleaning** — `google-gemini-cli` added to the provider list
  that triggers `additionalProperties` removal.
- **`image` tool discovery** — phantom `apply_patch` and `process` entries
  removed from `CORE_TOOL_GROUPS`.
- **Tool profile filtering** — `"full"` profile tools now only appear when
  the `"full"` profile is explicitly requested.
- **pi-ai connector robustness** — shape validation with warnings for
  unexpected event shapes from upstream providers.
- **`ToolSection` labels** — `listBySection()` now includes section labels.
- **`onError` in discoverCoreTools** — replaced dead
  `createLazyToolFactory`/`requireModule` code with direct factory imports.
- **Test timeouts** — JIT warmup timeouts raised from 60s to 180s; vitest 4
  `it()` call signature updated.

### Removed

- **`examples/openai-connector/`** — stale duplicate; superseded by
  `examples/connector/openai/`.
- **`docs/planning/temp-connectorsmcp.md`**, **`docs/temp-mcporter.md`** —
  scratch planning files deleted.
