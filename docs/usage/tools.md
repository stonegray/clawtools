# Tool System

## Import paths

```ts
// From the main entry point:
import { ToolRegistry, discoverCoreTools, discoverCoreToolsAsync, getCoreToolCatalog, getCoreSections } from "clawtools";

// From the tools sub-path:
import { ToolRegistry, discoverCoreTools, discoverCoreToolsAsync } from "clawtools/tools";
```

---

## `ToolRegistry`

Central catalog and resolver. Both `createClawtools` and `createClawtoolsAsync` expose an already-populated instance at `ct.tools`.

### Registration

#### `registry.register(tool, meta?)`

Register a fully-instantiated `Tool` object. `meta` overrides any derived metadata.

```ts
registry.register({
  name: "greet",
  description: "Say hello to someone",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Who to greet" } },
    required: ["name"],
  },
  execute: async (toolCallId, params) => ({
    content: [{ type: "text", text: `Hello, ${params.name}!` }],
  }),
});
```

#### `registry.registerFactory(factory, meta)`

Register a `ToolFactory` — a function called lazily with a `ToolContext` when tools are resolved. Enables deferred, context-aware tool creation. `meta.id` is required.

```ts
registry.registerFactory(
  (ctx) => ({
    name: "workspace_info",
    description: "Returns the workspace directory",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: [{ type: "text", text: ctx.workspaceDir ?? "(none)" }],
    }),
  }),
  {
    id: "workspace_info",
    label: "Workspace Info",
    description: "Returns the workspace directory",
    sectionId: "custom",
    profiles: ["full"],
    source: "core",
  },
);
```

If a factory throws during resolution, that tool is silently skipped (the rest of the registry is unaffected).

---

### Resolution

#### `registry.resolveAll(ctx?)` → `Tool[]`

Resolve all registered tools for the given context. Factories receive `ctx`; direct tools are returned as-is.

```ts
const tools = registry.resolveAll({
  workspaceDir: "/my/project",
  agentDir: "/my/project/.agent",
  sandboxed: false,
});
```

#### `registry.resolveByProfile(profile, ctx?)` → `Tool[]`

Resolve only tools whose metadata lists the given profile. The `"full"` profile always returns everything.

```ts
const codingTools = registry.resolveByProfile("coding", { workspaceDir: "/proj" });
```

#### `registry.resolve(name, ctx?)` → `Tool | undefined`

Resolve a single tool by canonical name.

```ts
const readTool = registry.resolve("read", { workspaceDir: "/proj" });
```

---

### Catalog queries (no factory invocation)

#### `registry.list()` → `ToolMeta[]`

List metadata for all registered tools without resolving factories.

```ts
for (const meta of registry.list()) {
  console.log(meta.id, meta.sectionId, meta.profiles, meta.description);
}
```

#### `registry.listBySection()` → `Array<ToolSection & { tools: ToolMeta[] }>`

List metadata grouped by section ID.

```ts
for (const section of registry.listBySection()) {
  console.log(`\n## ${section.label}`);
  for (const tool of section.tools) console.log(`  ${tool.id}: ${tool.description}`);
}
```

#### `registry.has(name)` → `boolean`

Check whether a tool is registered.

#### `registry.unregister(name)` → `boolean`

Remove a tool by name. Returns `true` if it existed.

#### `registry.clear()`

Remove all tools.

#### `registry.size` → `number`

Number of registered tools.

---

## Discovery functions

### `discoverCoreTools(registry, options?)`

**Synchronous.** Registers all core OpenClaw tools as metadata-only lazy factories. Tools resolve to `null` at call time (no async imports). Use for catalog listing only.

### `discoverCoreToolsAsync(registry, options?)` → `Promise<void>`

**Async.** Loads pre-built bundles (or source fallback) and registers fully executable factories. This is what `createClawtoolsAsync` uses internally.

### `getCoreToolCatalog()` → `ToolMeta[]`

Return the full tool catalog metadata without touching any registry.

### `getCoreSections()` → `ToolSection[]`

Return the ordered list of tool sections.

---

## `DiscoveryOptions`

```ts
interface DiscoveryOptions {
  // Override openclaw source root (source-fallback mode only).
  openclawRoot?: string;

  // Whitelist of tool IDs or group references. If omitted, all tools are included.
  include?: string[];

  // Tool IDs to exclude.
  exclude?: string[];

  // Called when a tool module cannot be loaded.
  onLoadWarning?: (message: string) => void;
}
```

---

## Tool profiles

Profiles are preset collections of tools for different agent use-cases:

| Profile | Description |
|---------|-------------|
| `"minimal"` | Smallest practical set — only `session_status` |
| `"coding"` | Full coding agent: fs, runtime, web (search+fetch), memory, sessions, browser, image |
| `"messaging"` | Messaging agents: sessions (list/history/send/spawn/status), message |
| `"full"` | Everything — all tools regardless of profile |

Use `registry.resolveByProfile("coding", ctx)` to get only coding tools.

---

## Tool groups

Groups are named aliases for sets of tool IDs, usable in `DiscoveryOptions.include` / `exclude`:

| Group | Tool IDs |
|-------|----------|
| `group:fs` | `read`, `write`, `edit`, `apply_patch` |
| `group:runtime` | `exec`, `process` |
| `group:web` | `web_search`, `web_fetch` |
| `group:memory` | `memory_search`, `memory_get` |
| `group:sessions` | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `subagents`, `session_status` |
| `group:ui` | `browser`, `canvas` |
| `group:messaging` | `message` |
| `group:automation` | `cron`, `gateway` |
| `group:nodes` | `nodes` |
| `group:agents` | `agents_list` |
| `group:media` | `image`, `tts` |

---

## Core tool catalog

All 25 built-in tools, their sections, profiles, and descriptions:

### Section: `fs` — Files

| ID | Label | Description | Profiles |
|----|-------|-------------|----------|
| `read` | read | Read file contents | `coding` |
| `write` | write | Create or overwrite files | `coding` |
| `edit` | edit | Make precise edits | `coding` |

### Section: `runtime` — Runtime

| ID | Label | Description | Profiles |
|----|-------|-------------|----------|
| `exec` | exec | Run shell commands | `coding` |

### Section: `web` — Web

| ID | Label | Description | Profiles | OpenClaw group |
|----|-------|-------------|----------|----------------|
| `web_search` | web_search | Search the web | _(none)_ | ✓ |
| `web_fetch` | web_fetch | Fetch web content | _(none)_ | ✓ |

### Section: `memory` — Memory

| ID | Label | Description | Profiles | OpenClaw group |
|----|-------|-------------|----------|----------------|
| `memory_search` | memory_search | Semantic memory search | `coding` | ✓ |
| `memory_get` | memory_get | Read memory files | `coding` | ✓ |

### Section: `sessions` — Sessions

| ID | Label | Description | Profiles | OpenClaw group |
|----|-------|-------------|----------|----------------|
| `sessions_list` | sessions_list | List active sessions | `coding`, `messaging` | ✓ |
| `sessions_history` | sessions_history | View session history | `coding`, `messaging` | ✓ |
| `sessions_send` | sessions_send | Send messages to a session | `coding`, `messaging` | ✓ |
| `sessions_spawn` | sessions_spawn | Spawn a sub-agent session | `coding` | ✓ |
| `subagents` | subagents | Manage sub-agent sessions | `coding` | ✓ |
| `session_status` | session_status | View session status and model info | `minimal`, `coding`, `messaging` | ✓ |

### Section: `ui` — UI

| ID | Label | Description | Profiles |
|----|-------|-------------|----------|
| `browser` | browser | Control a headless browser | `coding` |
| `canvas` | canvas | Render canvas visualizations | `coding` |

### Section: `messaging` — Messaging

| ID | Label | Description | Profiles |
|----|-------|-------------|----------|
| `message` | message | Send messages across channels | `messaging` |

### Section: `automation` — Automation

| ID | Label | Description | Profiles |
|----|-------|-------------|----------|
| `cron` | cron | Schedule recurring tasks | _(none)_ |
| `gateway` | gateway | Gateway management | _(none)_ |

### Section: `nodes` — Nodes

| ID | Label | Description | Profiles |
|----|-------|-------------|----------|
| `nodes` | nodes | Manage cluster nodes | _(none)_ |

### Section: `agents` — Agents

| ID | Label | Description | Profiles |
|----|-------|-------------|----------|
| `agents_list` | agents_list | List configured agents | _(none)_ |

### Section: `media` — Media

| ID | Label | Description | Profiles |
|----|-------|-------------|----------|
| `image` | image | Generate and process images | `coding` |
| `tts` | tts | Text-to-speech synthesis | _(none)_ |

> Tools with no profiles listed are not included by any named profile. Use `"full"` or `include` them explicitly.

---

## Invoking a tool

Tools resolved from the registry have this signature:

```ts
tool.execute(
  toolCallId: string,         // unique ID for this call (use crypto.randomUUID())
  params: Record<string, unknown>,  // arguments from the LLM
  signal?: AbortSignal,       // optional cancellation
  onUpdate?: ToolUpdateCallback,    // optional streaming progress callback
): Promise<ToolResult>
```

```ts
const result = await tool.execute(
  crypto.randomUUID(),
  { path: "src/index.ts" },
);

for (const block of result.content) {
  if (block.type === "text") console.log(block.text);
  if (block.type === "image") console.log(`[image ${block.mimeType}]`);
}

// Structured data (if provided by the tool)
if (result.details) console.log(result.details);
```

### Progressive updates via `onUpdate`

Long-running tools may call `onUpdate` with partial results before the final return. The final `ToolResult` is always the authoritative complete result.

```ts
const result = await tool.execute(
  crypto.randomUUID(),
  params,
  undefined,
  (partial) => {
    for (const block of partial.content ?? []) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  },
);
```

---

## `ToolContext`

Passed to tool factories during resolution and available to tool implementations:

```ts
interface ToolContext {
  config?: Record<string, unknown>;   // application configuration
  workspaceDir?: string;              // workspace/project directory
  agentDir?: string;                  // agent data directory
  agentId?: string;                   // agent identifier
  sessionKey?: string;                // current session key
  messageChannel?: string;            // channel the message arrived on
  agentAccountId?: string;            // agent account identifier
  sandboxed?: boolean;                // whether running in a sandbox
}
```

Omit any fields you don't need; all are optional.

---

## Schema extraction for LLM submission

Use `extractToolSchemas` to convert resolved tools into the format LLM APIs expect:

```ts
import { extractToolSchemas } from "clawtools/tools";

const schemas = extractToolSchemas(tools);
// → [{ name, description, input_schema }]

// Provider-specific cleaning (strips Gemini-incompatible JSON Schema keywords):
const geminiSchemas = extractToolSchemas(tools, "google");
```
