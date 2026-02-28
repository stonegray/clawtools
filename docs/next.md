# clawtools Integration Review

*Written from the perspective of implementing Clawfice's `ClawtoolsAdapter` — the bridge between clawtools' connector discovery and Clawfice's provider/model registry. All friction points below are grounded in real code; references to specific adapter lines are to [`packages/core/src/connectors/clawtools-adapter.ts`](../packages/core/src/connectors/clawtools-adapter.ts).*

---

## Summary

clawtools is broadly well-designed and the abstractions are sound. The `Connector` interface, the `StreamEvent` discriminated union, and `resolveAuth` are all pleasant to work with once you understand them. The library clearly evolved incrementally though — there are a few rough edges where the surface area grew faster than the ergonomic glue holding it together.

The single most impactful change would be making async the default naming convention and making the high-level facade (`createClawtools()`) the *only* path a connector integrator needs. Right now it's the documented entry point but it doesn't fully close the loop, so integrators fall through to lower-level APIs they shouldn't need to touch. Sync variants should be explicitly named (e.g., `createClawtoolsSync()`).

---

## 0. Breaking Change: Async-by-Default Naming Convention

### Overview

The clawtools library should adopt the industry standard **async-by-default naming convention**: functions that are asynchronous are *not* suffixed with `Async`, while synchronous versions are explicitly suffixed with `Sync`. This is a breaking change affecting the entire public API, but it significantly improves ergonomics and aligns with Node.js/browser standards.

### Current State

The library currently names async functions with the `Async` suffix:

```ts
// Current (problematic)
const ct = await createClawtoolsAsync();
const connectors = await discoverBuiltinConnectorsAsync();
const auth = await resolveAuth(mode, options);

// Hypothetical sync equivalents (if they existed)
const ct = createClawtoolsAsync_Sync();  // awkward
const connectors = discoverBuiltinConnectorsAsync_Sync();  // unreadable
```

### Proposed Naming

Rename all async functions to drop the `Async` suffix, and add `Sync` suffix only to synchronous variants:

```ts
// After migration (correct)
const ct = await createClawtools();
const connectors = await discoverBuiltinConnectors();
const auth = await resolveAuth(mode, options);

// Sync equivalents where applicable
const ct = createClawtoolsSync();
const connectors = discoverBuiltinConnectorsSync();
```

### Functions Affected

This change impacts all public async APIs in clawtools:

**Core facade:**
- `createClawtoolsAsync()` → `createClawtools()`
- `createClawtoolsSync()` (new, if sync variant needed)

**Connector discovery:**
- `discoverBuiltinConnectorsAsync()` → `discoverBuiltinConnectors()`
- `discoverBuiltinConnectorsSync()` (new, if sync variant exists)

**Auth resolution:**
- `resolveAuth()` (already correct — async but no suffix)
- `resolveAuthSync()` (if sync variant exists — currently not suffixed, may need clarification)

**Streaming:**
- `Connector.stream()` (already correct — returns AsyncIterable)

**Extensions:**
- Any extension discovery methods following the same pattern

### Migration Path

#### For clawtools Maintainers

1. **Phase 1**: Add new functions with correct names alongside old ones:
   ```ts
   export async function createClawtools() { /* ... */ }
   /** @deprecated Use createClawtools() instead */
   export async function createClawtoolsAsync() { return createClawtools(); }
   ```

2. **Phase 2**: Update all documentation, examples, and JSDoc to reference the new names.

3. **Phase 3**: Release as a major version (v2.0.0) and remove deprecated functions two releases later (v3.0.0).

#### For Clawfice

1. **Immediate**: Update [clawtools-adapter.ts](../packages/core/src/connectors/clawtools-adapter.ts) to use new function names.
2. **Follow-up**: After clawtools v2.0 is released with both old and new names, update imports and calls throughout the codebase.
3. **Final**: When ready to drop support for clawtools v1.x, remove all `Async` suffix calls entirely.

### Rationale

- **Industry standard**: Modern Node.js/TypeScript libraries (e.g., `fs.promises`, `node-fetch`, most popular npm packages) use async-by-default naming.
- **Reduces clutter**: Async is the norm in 2026; the exception (sync) should be marked, not the default.
- **Better IDE autocomplete**: Searching for `createClawtools` returns both `createClawtools()` and `createClawtoolsSync()`, making discovery intuitive.
- **Shorter call sites**: Removes unnecessary four-letter suffix from 90% of real-world usage.
- **Aligns with section §1**: Once the facade properly exposes `Connector[]` as iterable, the entry point becomes `await createClawtools()` — which is much cleaner than `await createClawtoolsAsync()`.

### Breaking Change Severity

**Severity**: HIGH  
**Scope**: All code importing from clawtools  
**Mitigation**: Deprecation window of 1-2 major versions with both names available

---

## 1. The Facade Doesn't Close the Loop

### What Exists

```ts
const ct = await createClawtools();
ct.tools      // ToolRegistry
ct.connectors // ConnectorRegistry
ct.extensions // ExtensionInfo[]
```

### The Problem

The documented entry point is `createClawtools()`, but when you actually need to register each connector as a streaming handler — which is the primary use case for anyone building an LLM-routing layer — you can't easily get there from `ct`. You end up doing this:

```ts
// What you want:
for (const connector of ct.connectors) { ... }

// What you actually get:
ct.connectors  // ConnectorRegistry instance
ct.connectors.list()  // Connector[]  ← this exists but isn't obvious
```

`ConnectorRegistry.list()` does exist and does return `Connector[]`, so this works:

```ts
const ct = await createClawtools();
for (const c of ct.connectors.list()) { /* register c */ }
```

But it's not shown in any example, and the instinct of every integrator will be to look for something like `ct.connectorList` or `for (const c of ct.connectors)`. As a result the Clawfice adapter bypasses `createClawtoolsAsync()` entirely and calls `discoverBuiltinConnectorsAsync()` directly — meaning the facade has zero adoption in the one place it should be indispensable.

### Recommendation

Either:

- Make `ConnectorRegistry` iterable (`[Symbol.iterator]` → delegates to `.list()`), or
- Add a `ct.connectorList: Connector[]` convenience accessor, or
- Add a real "register all connectors with a router" example using `ct.connectors.list()` to the JSDoc

The fix is small. The iteration pattern is the missing link between the facade and real-world connector integration.

---

## 2. `discoverBuiltinConnectorsAsync()` Called Twice

Because `createClawtools()` wasn't usable as described above, the Clawfice adapter calls `discoverBuiltinConnectors()` in two separate top-level functions:

- `loadClawtoolsProviders()` — builds metadata for the provider registry
- `loadClawtoolsCompletionHandlers()` — builds per-connector streaming handlers

These are called independently by two different parts of the bootstrap sequence, so there's no clean way to share one result without restructuring the callers. Each call does its own network/filesystem discovery work. In practice this is fine for startup but it's wasteful, and it's an artificial problem — if the facade exposed a stable cached `Connector[]`, both callers would just read from it.

### Recommendation

`discoverBuiltinConnectors()` should cache its result on first call (or at least note in the JSDoc that calling it twice is safe/cheap). Alternatively, once the facade iteration issue above is fixed, a single `createClawtools()` call can serve both callers.

---

## 3. camelCase vs. snake_case Impedance Mismatch

`ModelDescriptor` uses camelCase throughout:

```ts
interface ModelDescriptor {
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;    // ← camelCase
    cacheWrite: number;   // ← camelCase
  };
}
```

Clawfice stores models in SQLite with snake_case column names (`context_window`, `max_tokens`, `base_url`, `cache_read`, `cache_write`), which is standard for SQL. The result is a full bidirectional mapping block that every integrator who touches a database or a REST API will have to write from scratch — it's currently ~20 lines in the adapter:

```ts
// clawtools → Clawfice  (lines 42-57 of the adapter)
context_window: m.contextWindow ?? 0,
max_tokens: m.maxTokens ?? 0,
base_url: m.baseUrl ?? defaultBaseUrl,
cost: {
    cache_read: m.cost?.cacheRead ?? 0,
    cache_write: m.cost?.cacheWrite ?? 0,
},

// Clawfice → clawtools  (lines 127-143, when calling stream())
contextWindow: model.context_window,
maxTokens: model.max_tokens,
baseUrl: model.base_url,
cost: {
    cacheRead: model.cost.cache_read,
    cacheWrite: model.cost.cache_write,
},
```

This doubles the surface area of `ModelDescriptor` in every consumer.

### Recommendation

Pick one convention and stick to it. For a TypeScript library targeting the Node.js/web ecosystem, camelCase is natural and correct — so no change needed there. But do add a `toJSON()` method on `ModelDescriptor` (or a `serializeModel()` utility) that emits snake_case, since JSON APIs and databases will almost always need it. Alternatively, accept that integrators will map it and document the canonical mapping in one place so every user doesn't reinvent it.

---

## 4. `StreamEvent` Variant Completeness: Undocumented Invariants

The `StreamEvent` union currently has 10 variants:

```
start | text_delta | text_end | thinking_delta | thinking_end |
toolcall_start | toolcall_delta | toolcall_end | done | error
```

The Clawfice adapter only handles four of them (`text_delta`, `thinking_delta`, `done`, `error`) and silently ignores the rest. This isn't wrong — the `default: break` is correct defensive code — but it raises questions that the types alone can't answer:

- Is `done` always the last event emitted? Or can `error` come after `done`?
- Are `text_end` and `thinking_end` (which carry the full accumulated content) always emitted, or only for certain providers? Are they useful, or just informational?
- What's the intended consumer pattern for `toolcall_start` / `toolcall_delta` / `toolcall_end`? Are integrators expected to collect tool calls from the stream, or does the `done` event (with `stopReason: "toolUse"`) indicate tool use and the caller then re-invokes with tool results?
- If `usage` is absent on `done`, does that mean the provider doesn't support it, or that it wasn't requested?

None of these have obvious answers from the type definitions. The Clawfice adapter defaults `inputTokens`/`outputTokens` to zero when `usage` is missing (`event.usage?.inputTokens ?? 0`), which is silently wrong for any provider that does populate usage.

### Recommendation

Add a "Stream Protocol" section to the docs covering:
1. Guaranteed vs. provider-dependent events
2. Whether `text_end` / `thinking_end` are redundant with delta accumulation (they appear to be — confirm this)
3. The intended tool-use loop pattern with a full example
4. Which built-in providers populate `usage` on `done`

The `done` event's `usage` field should also not be optional for providers that support it — consider using a conditional type or a provider capability flag.

---

## 5. `toolcall_end` Has No Tool Call ID in `toolcall_start`

Looking at the stream event types:

```ts
{ type: "toolcall_start" }            // ← no ID
{ type: "toolcall_delta"; delta: string }
{ type: "toolcall_end"; toolCall: { id, name, arguments } }
```

If multiple tool calls can be in-flight in the same stream (as in Claude's parallel tool calls), the `toolcall_start` event carries no identifier, making it impossible to correlate which delta belongs to which call. The full resolved `toolCall` only appears at `toolcall_end`.

This means streaming tool call rendering (showing the user "thinking → tool X is running") is impossible without buffering everything until `toolcall_end`. You can accumulate deltas in order, but you can't label them. This seems intentional for simplicity, but it's a real limitation for agentic UIs.

### Recommendation

Add an optional `id` field to `toolcall_start` and `toolcall_delta` so multi-tool-call streams can be correctly correlated for streaming display. This is a non-breaking change (optional field).

---

## 6. `StreamContext.tools[].input_schema` Is Untyped

```ts
interface StreamContext {
  tools?: Array<{
    name: string;
    description: string;
    input_schema: unknown;   // ← untyped
  }>;
}
```

`input_schema` is passed directly through to the LLM provider (it's a JSON Schema object). Making it `unknown` forces every caller to cast. The Clawfice adapter passes `input_schema: {}` (an empty schema) because it doesn't yet map tool schemas, but even if it did it would need an explicit cast.

### Recommendation

Type it as `Record<string, unknown>` at minimum, or define a `JsonSchema` interface matching the common subset (type, properties, required, description, etc.). The latter is more work but makes tool definitions self-documenting.

---

## 7. `ResolvedAuth.apiKey` Optionality Is Surprising

```ts
interface ResolvedAuth {
  apiKey?: string;       // ← optional even on "success"
  profileId?: string;
  source?: string;
  mode: AuthMode;        // e.g. "apiKey" | "aws-sdk" | "none"
}
```

`resolveAuth()` returns `ResolvedAuth | undefined`. The outer `undefined` means "we couldn't resolve anything". But even when it returns an object, `apiKey` is optional. For `mode: "apiKey"` this seems like it should be present — but for `mode: "aws-sdk"` or `mode: "none"` there's no key. This makes the common case (just get me the API key) require double-optional chaining:

```ts
const apiKey = dbKey ?? ctAuth?.apiKey;  // apiKey is string | undefined
```

This is handled correctly in the adapter, but only because the downstream `stream()` call tolerates an undefined `apiKey` when env vars are present. A new integrator would reasonably expect that a non-null `resolveAuth()` result means auth succeeded.

### Recommendation

Document in the JSDoc of `resolveAuth()` what each `mode` value means for `apiKey`:
- `"apiKey"` → `apiKey` is always present (or consider making this a type assertion with a narrowed return type)
- `"aws-sdk"` → `apiKey` is always absent, credentials come from the SDK
- `"none"` → no auth needed

A narrowed return type by `mode` (discriminated union on `mode`) would make this self-documenting:

```ts
type ResolvedAuth =
  | { mode: "apiKey"; apiKey: string; source: string }
  | { mode: "aws-sdk"; profileId?: string }
  | { mode: "none" };
```

---

## 8. `Connector.models` Is Optional But Never Actually Absent

```ts
interface Connector {
  models?: ModelDescriptor[];  // ← optional
}
```

In practice, every built-in connector ships with a `models` array. The optional makes every consumer write `c.models ?? []`. If there's a case where `models` is intentionally absent (e.g., a connector that fetches its model list dynamically), that should be documented and there should be a method to query it: `await connector.getModels()`.

### Recommendation

Either make `models` required (it's clearly intended to be populated), or keep it optional but add an async `listModels()` method for connectors that fetch their list dynamically. The current state makes callers guess at which situation applies.

---

## 9. No AbortSignal Guidance

`StreamOptions.signal?: AbortSignal` exists, which is great — it means the underlying HTTP/fetch/SSE can be cancelled. But there's no documentation on how it fits into the stream loop or what happens to the async iterator on abort (does it throw? return cleanly?).

The Clawfice adapter doesn't wire it up at all, leaving completion requests uncancellable from the user's perspective. This isn't a clawtools bug, but clear documentation and an example (especially for long agentic runs where cancellation matters) would have made it easy to implement.

### Recommendation

Add one JSDoc example on `StreamOptions.signal` showing the pattern:

```ts
const controller = new AbortController();
const stream = connector.stream(model, context, { signal: controller.signal });
// ... later
controller.abort();
```

And document what the stream emits when aborted: does it emit `{ type: "error", ... }`, `{ type: "done", stopReason: "error" }`, or just end silently?

---

## 10. Minor: `done.stopReason: "error"` Overlaps With `error` Event

The `done` event has `stopReason: "stop" | "toolUse" | "length" | "error"`. There's also a separate `{ type: "error", error: string }` event. This creates two different ways a stream can signal failure:

1. `{ type: "error", error: "..." }` — stream-level exception
2. `{ type: "done", stopReason: "error" }` — provider-level error termination (no message)

The Clawfice adapter throws on `type: "error"` but has no special handling for `stopReason: "error"` on `done`. The distinction between these two error modes is unclear.

### Recommendation

If `done` with `stopReason: "error"` is a valid terminal state that carries no additional error information, document that it should be treated as an empty result with no error thrown. If it should always be accompanied by a preceding `error` event, document that invariant.

---

## Overall Verdict

The library is in good shape. The connector abstraction is clean, the auth resolution is practical, and the stream event model is expressive. The pain points above are all fixable without a breaking API change:

| Priority | Issue | Effort |
|---|---|---|
| High | Async-by-default naming: rename `*Async` functions to drop suffix; add `*Sync` variants (§1, §2) | Small |
| High | Facade doesn't expose `Connector[]` ergonomically (§1) | Small |
| High | camelCase `ModelDescriptor` forces manual mapping (§3) | Medium (utility function) |
| Medium | Double `discoverBuiltinConnectors()` calls (§2) | Small (caching) |
| Medium | Stream protocol not documented (§4) | Documentation |
| Medium | `ResolvedAuth` discriminated union (§7) | Small |
| Low | `toolcall_start` missing ID (§5) | Non-breaking addition |
| Low | `input_schema: unknown` (§6) | Small type change |
| Low | `Connector.models` optionality (§8) | Clarify intent |
| Low | AbortSignal guidance (§9) | Documentation |
| Low | `done.stopReason: "error"` vs `error` event (§10) | Documentation |

The single highest-leverage change is **adopting async-by-default naming** (`createClawtools()` instead of `createClawtoolsAsync()`) and making the connector iteration story obvious from the facade. If that one gap is closed, the facade becomes genuinely useful as a unified entry point and most of the "double discovery" problem disappears automatically.
