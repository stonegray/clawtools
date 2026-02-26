# next.md — Recommended test coverage

This document maps the full scope of clawtools against the existing suite and
identifies every missing test. Each item is a concrete, writable test — not a
vague area of concern.

---

## What's already covered

| File | Module covered |
|---|---|
| `tests-unit/tools/registry.test.ts` | `ToolRegistry` (all methods) |
| `tests-unit/tools/discovery.test.ts` | `getCoreToolCatalog`, `getCoreSections`, `discoverCoreTools` (filters, groups) |
| `tests-unit/tools/helpers.test.ts` | `jsonResult`, `textResult`, `errorResult`, `imageResult` |
| `tests-unit/tools/params.test.ts` | `readStringParam`, `readNumberParam`, `readBooleanParam`, `readStringArrayParam`, `assertRequiredParams`, `ToolInputError` |
| `tests-unit/tools/schema.test.ts` | `extractToolSchema`, `extractToolSchemas`, `normalizeSchema`, `cleanSchemaForGemini` |
| `tests-unit/connectors/registry.test.ts` | `ConnectorRegistry` (all methods), `resolveAuth` |
| `tests-unit/plugins/loader.test.ts` | `loadPlugins` — discovery, filtering, tool/connector collection, no-op compat |
| `tests-integration/app.test.ts` | Full request cycle: text/tool_call/error scenarios, request capture, scenario isolation |
| `test-build/bundler.test.ts` | Bundle script internals, source preconditions, bundle loading, discovery routing, regression anchors |

---

## Missing tests

Grouped by which new file they belong in.

---

### `tests-unit/connectors/bridge.test.ts`

Tests for `src/connectors/pi-ai-bridge.ts` — the event adapter and type
converters. These are pure functions with no network I/O and no mocks needed.

**`adaptEvents()` — event mapping**

- `start` → yields `{ type: "start" }`
- `text_delta` → yields `{ type: "text_delta", delta }`
- `text_end` → yields `{ type: "text_end", content }`
- `thinking_delta` → yields `{ type: "thinking_delta", delta }`
- `thinking_end` → yields `{ type: "thinking_end", content }`
- `toolcall_start` → yields `{ type: "toolcall_start" }`
- `toolcall_delta` → yields `{ type: "toolcall_delta", delta }`
- `toolcall_end` → yields `{ type: "toolcall_end", toolCall: { id, name, arguments } }`
- `done` (reason: "stop") → yields `{ type: "done", stopReason: "stop", usage: { inputTokens, outputTokens } }`
- `done` (reason: "length") → stopReason is "length"
- `done` (reason: "toolUse") → stopReason is "toolUse"
- `error` with `errorMessage` → yields `{ type: "error", error: errorMessage }`
- `error` without `errorMessage` → yields a non-empty error string (fallback)
- `text_start` → **no event emitted** (suppressed)
- `thinking_start` → **no event emitted** (suppressed)
- Usage is forwarded correctly: `inputTokens = message.usage.input`, `outputTokens = message.usage.output`
- Mixed sequence (start, text_delta×3, text_end, done) comes out in the right order with the right count

**`toDescriptor()` — pi-ai Model → clawtools ModelDescriptor**

- All fields (id, name, api, provider, baseUrl, reasoning, input, cost, contextWindow, maxTokens, headers) survive the round-trip
- `compat` field survives as opaque `Record<string, unknown>`
- Optional fields (headers, compat) are `undefined` when absent on the source

**`toModel()` — clawtools ModelDescriptor → pi-ai Model**

- A fully-populated descriptor round-trips losslessly
- A minimal descriptor (`{ id, api, provider }`) gets sensible defaults for baseUrl, input, cost, contextWindow, maxTokens, reasoning

**`toContext()` — clawtools StreamContext → pi-ai Context**

- `systemPrompt` is passed through
- `messages` array is passed through unchanged
- `tools`: `input_schema` is renamed to `parameters`; other fields (name, description) are unchanged
- A context with no tools → `tools` is `undefined` in the output (not empty array)

---

### `tests-unit/connectors/discovery.test.ts`

Tests for `discoverBuiltinConnectorsAsync()` against the built bundle.

- Returns an array (skip if bundle absent — `skipIf(!existsSync(bundlePath))`)
- Returns exactly 22 connectors (regression anchor — update when pi-ai adds providers)
- Every returned item has: `id`, `label`, `provider`, `api`, `models`, `stream`
- Every `id` starts with `"builtin/"` followed by the provider name
- `stream` is a function on every connector
- Provider names include: `anthropic`, `openai`, `google`, `amazon-bedrock`, `github-copilot`, `groq`, `mistral`, `xai`, `openrouter`
- `getByProvider("anthropic")` returns a connector with ≥1 model
- `getByProvider("openai")` returns a connector with ≥1 model
- A second call to `discoverBuiltinConnectorsAsync()` returns independent arrays (no shared state)
- Falls back gracefully when bundle is absent (returns `[]`, does not throw)

---

### `tests-unit/index.test.ts`

Tests for `createClawtools()` and `createClawtoolsAsync()`.

**`createClawtools()` (sync)**

- Returns an object with `tools` (ToolRegistry), `connectors` (ConnectorRegistry), `extensions` (array)
- `tools.size` is 23 by default (all core tools registered in catalog)
- `tools.size` is 0 when `skipCoreTools: true`
- `connectors.size` is 0 (sync factory never loads built-in connectors)
- `extensions` is an array (empty when openclaw submodule is absent)
- Calling it twice returns independent registries

**`createClawtoolsAsync()` (async)**

- Returns same shape as `createClawtools()`
- `connectors.size` is 22 after awaiting (built-in connectors auto-registered)
- `connectors.size` is 0 when `skipBuiltinConnectors: true`
- `tools.size` is 23 by default
- `tools.size` is 0 when `skipCoreTools: true` (connectors still loads)
- `connectors.getByProvider("anthropic")` returns a live connector with working `stream`
- Calling it with both `skipCoreTools` and `skipBuiltinConnectors` true produces empty registries

---

### `tests-unit/connectors/extension-discovery.test.ts`

Tests for `discoverExtensions`, `getExtensionPath`, `listChannelExtensions`,
`listProviderExtensions`.

- `discoverExtensions("/nonexistent/path")` returns `[]` without throwing
- `discoverExtensions(TEST_PLUGINS_DIR)` finds the test resource plugins
- Each result has: `id`, `name`, `path`, `channels` (array), `providers` (array), `entryPoint?`
- A manifest with no `channels` key → `channels: []`
- A directory without `openclaw.plugin.json` is skipped
- A directory with malformed JSON in `openclaw.plugin.json` is skipped (no throw)
- `getExtensionPath(id, dir)` returns the correct absolute path for a known ID
- `getExtensionPath("nonexistent", dir)` returns `undefined`
- `listChannelExtensions(dir)` returns only extensions that declare channels
- `listProviderExtensions(dir)` returns only extensions that declare providers

---

### `tests-unit/plugins/loader-edge-cases.test.ts`

Edge cases and gaps not covered in the existing `loader.test.ts`.

- Plugin with `activate()` instead of `register()` — both entry-point names should work
- Plugin that registers a tool factory (not a direct tool) — factory is in `toolFactories`
- `registerTool` with `names` option — factory appears once per name in `toolFactories`
- Multiple `searchPaths` — plugins in both paths are discovered
- Same plugin ID in two search paths — loaded once (first wins, or last wins — document the actual behaviour)
- Plugin where entry point `import()` throws — loader skips it without crashing the rest
- `api.resolvePath("./foo")` returns a string (regression against no-op returning undefined)
- `LoadedPlugin.version` is populated from the manifest when present
- `LoadedPlugin.description` is populated from the manifest when present

---

### `tests-unit/tools/schema-edge-cases.test.ts`

Gaps in the existing `schema.test.ts`.

- `normalizeSchema` with a TypeBox-generated schema object — output has `type: "object"`
- `cleanSchemaForGemini` strips `$schema` key
- `cleanSchemaForGemini` strips `additionalProperties`
- `cleanSchemaForGemini` strips `$defs` / `definitions`
- `cleanSchemaForGemini` does nothing to a schema that's already clean
- `extractToolSchemas([])` returns empty array
- `extractToolSchemas` with `"google-vertex"` provider applies Gemini cleaning

---

### `tests-unit/tools/error-types.test.ts`

- `ToolInputError` is an instance of `Error`
- `ToolInputError.name` is `"ToolInputError"`
- `ToolAuthorizationError` is an instance of `Error`
- `ToolAuthorizationError.name` is `"ToolAuthorizationError"`
- A thrown `ToolAuthorizationError` is catchable as `Error`
- `ToolAuthorizationError` and `ToolInputError` are distinguishable with `instanceof`

---

### `tests-integration/abort.test.ts`

- Create an `AbortController`; call `query(prompt, controller.signal)`; abort after the first event arrives
- The async generator stops iterating (no "iterator not closed" warning)
- The Promise returned by `query()` resolves (does not reject) after abort
- The collected events stop mid-stream (no `done` event because the stream was cut)
- Aborting before the request is sent → `query()` resolves with an error event or empty event list, no throw

---

### `tests-integration/multi-turn.test.ts`

- Send a first query → collect text response
- Use the response to build a second query (user message + assistant reply as history)
- Verify the second request's `messages` array contains all turns in order: `user`, `assistant`, `user`
- Verify the assistant turn content matches the text from the first response

---

### `tests-integration/tool-roundtrip.test.ts`

Full agent loop: LLM requests a tool, app executes it, sends result back for a
final text response. This is the core use-case of agentic tool use.

**Setup:** The mock server is configured with two sequential scenarios:
1. `tool_call` scenario → LLM requests `echo` with `{ message: "ping" }`
2. `text` scenario → LLM replies "Got your ping"

**Test cases:**

- First query → `toolcall_end` event is emitted with `{ name: "echo", args: { message: "ping" } }`
- The app executes the tool and receives `{ content: [{ type: "text", text: ... }] }`
- Second query (with tool result in messages) → text response "Got your ping"
- The tool result message sent to the server has `role: "tool"` (or `"toolResult"`)
- The tool result message includes the tool call ID from the first response
- `toolCount` in `AppResult` reflects the number of registered tools

---

### `tests-integration/stream-invariants.test.ts`

Protocol invariants that must hold across all scenario types.

- `start` is always the first event when the request succeeds
- `done` is always the last event
- No events appear after `done`
- No `done` appears more than once
- `toolcall_end` always comes before `done` when `stopReason === "toolUse"`
- `text_end` content matches the concatenation of all preceding `text_delta` events
- Event sequence for text: `start → text_delta×N → text_end → done`
- Event sequence for tool call: `start → toolcall_start → toolcall_delta×N → toolcall_end → done`

---

### `test-build/connector-bundle.test.ts`

Build regression tests for `dist/core-connectors/builtins.js`.

- Bundle file exists at the expected path (skip if not built)
- `getBuiltinConnectors` is exported from the bundle
- Returns exactly 22 connectors (regression anchor — update if pi-ai adds providers)
- Expected provider names: `anthropic`, `openai`, `google`, `amazon-bedrock`, `github-copilot`, `google-gemini-cli`, `google-vertex`, `groq`, `mistral`, `xai`, `cerebras`, `openrouter`, `vercel-ai-gateway`, `huggingface`, `zai`, `minimax`, `minimax-cn`, `kimi-coding`, `opencode`, `openai-codex`, `azure-openai-responses`, `google-antigravity`
- `anthropic` has ≥20 models (regression anchor — update if pi-ai drops models)
- `openai` has ≥30 models
- `openrouter` has ≥100 models (it aggregates many providers)
- Every connector has `id`, `label`, `provider`, `api`, `models`, `stream`
- Every `stream` field is a function
- No two connectors share the same `id`
- `adaptEvents` smoke test: feed a synthetic sequence of pi-ai events through the adapter and confirm the output matches the expected `StreamEvent` array (tests the bundle actually wires up correctly end-to-end)

---

## Priority order

| Priority | File | Why |
|---|---|---|
| 1 | `tests-unit/connectors/bridge.test.ts` | Core logic of the provider integration — pure functions, zero setup, high leverage |
| 2 | `tests-unit/index.test.ts` | The public entry-point API; consumers call `createClawtoolsAsync()` first |
| 3 | `test-build/connector-bundle.test.ts` | Regression anchor for the 22-provider catalog — catches pi-ai upstream changes |
| 4 | `tests-integration/stream-invariants.test.ts` | Protocol guarantees that consumers depend on |
| 5 | `tests-unit/connectors/discovery.test.ts` | Verifies the bundle loading path works end-to-end |
| 6 | `tests-integration/tool-roundtrip.test.ts` | The core agentic use-case |
| 7 | `tests-integration/abort.test.ts` | Safety — abort leaks cause real hangs in production |
| 8 | `tests-unit/tools/error-types.test.ts` | Cheap, documents important consumer-facing behaviour |
| 9 | `tests-unit/connectors/extension-discovery.test.ts` | Edge cases that would fail silently today |
| 10 | `tests-unit/plugins/loader-edge-cases.test.ts` | Compat gaps that real openclaw plugins will hit |
| 11 | `tests-integration/multi-turn.test.ts` | Required for any real chat application |
| 12 | `tests-unit/tools/schema-edge-cases.test.ts` | Fills gaps in existing coverage |

---

## Notes on test helpers

Several of the above will need new helpers. Likely additions to `test/helpers/`:

- A **pi-ai event builder** for `bridge.test.ts` — a function that returns a synthetic `AssistantMessageEvent` for each type. `makePiAiEvent(type, overrides?)`. Avoids repeating the verbose mock shape in every test.

- A **multi-turn query** helper for `testapp` — extend `AppResult` and `query()` to accept an initial `messages` array so multi-turn tests can prepopulate history without reimplementing the state machine.

- A **stream collector** — `collectStream(connector, model, context, options)` that drives a connector and returns `{ events, text, toolCalls }`. Useful in `stream-invariants.test.ts` and `tool-roundtrip.test.ts` without depending on `testapp`.
