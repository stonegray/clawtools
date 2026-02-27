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

#### `registry.resolveAll(ctx?, onError?)` → `Tool[]`

Resolve all registered tools for the given context. Factories receive `ctx`; direct tools are returned as-is.

> **Important:** Factories that throw or return `null` are **silently skipped** — the rest of the registry is unaffected and no error is raised. If a tool section you expect is missing from the result, the most likely cause is a missing or wrong context field (see the [Context requirements per section](#context-requirements-per-section) table below).

Pass an `onError` callback to observe factory errors instead of having them silently swallowed:

```ts
const tools = registry.resolveAll(
  {
    workspaceDir: "/my/project",
    agentDir: "/my/project/.agent",
    sandboxed: false,
  },
  (meta, err) => console.warn(`[clawtools] ${meta.id} factory failed:`, err),
);
```

#### Context requirements per section

| Section | Required context fields | Notes |
|---------|------------------------|-------|
| `fs` — read / write / edit | `root`, `bridge` | Both are **required**. Without them the factory returns `null` and the tools are silently dropped. Use `createNodeBridge(root)` for local Node.js. |
| `runtime` — exec | _(none required)_ | `workspaceDir` used as default `cwd`; `sessionKey` / `agentId` enable session notifications. |
| `web` — web_search / web_fetch | _(none required)_ | Use their own config / env vars for API keys. |
| `memory` — memory_search / memory_get | `agentDir` | Memory files are stored under `agentDir`. |
| `sessions` — sessions_\* | `sessionKey`, `agentId`, `messageChannel` | Inter-session messaging. |
| `ui` — browser / canvas | _(none required for local)_ | Sandboxed browser requires a full openclaw sandbox context. |
| All others | _(none required)_ | Created with defaults; optional context fields may be used. |
```

#### `registry.resolveByProfile(profile, ctx?, onError?)` → `Tool[]`

Resolve only tools whose metadata lists the given profile. The `"full"` profile always returns everything.

```ts
const codingTools = registry.resolveByProfile("coding", { workspaceDir: "/proj" });

// With error observer:
const codingTools = registry.resolveByProfile(
  "coding",
  { workspaceDir: "/proj" },
  (meta, err) => console.warn(`${meta.id} failed:`, err),
);
```

#### `registry.resolve(name, ctx?, onError?)` → `Tool | undefined`

Resolve a single tool by canonical name.

```ts
const readTool = registry.resolve("read", { workspaceDir: "/proj" });

// With error observer:
const readTool = registry.resolve(
  "read",
  { root: "/proj", bridge: createNodeBridge("/proj") },
  (meta, err) => console.warn(`${meta.id} failed:`, err),
);
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
| `group:fs` | `read`, `write`, `edit` |
| `group:runtime` | `exec` |
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

All 23 built-in tools, their sections, profiles, and descriptions:

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
  toolCallId: string,         // ID for this call
  params: Record<string, unknown>,  // arguments from the LLM
  signal?: AbortSignal,       // optional cancellation
  onUpdate?: ToolUpdateCallback,    // optional streaming progress callback
): Promise<ToolResult>
```

In an **agentic loop**, use the `id` from the `toolcall_end` event — the LLM assigns it, and feeding back a mismatched ID will break conversation history:

```ts
// Inside a toolcall_end handler:
const result = await tool.execute(
  event.toolCall.id,          // ← use the LLM-assigned id, NOT crypto.randomUUID()
  event.toolCall.arguments,
);
```

For **standalone / testing** use, `crypto.randomUUID()` is fine:

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
  root?: string;                      // fs root for read/write/edit tools (defaults to workspaceDir)
  bridge?: FsBridge;                  // fs implementation for read/write/edit tools
}
```

Omit any fields you don't need; all are optional.

> `root` and `bridge` are required to enable the `fs` tool section (read / write / edit). Without them those tools are silently skipped. See [FsBridge](#fsbridge) below.

---

## FsBridge

The `fs` tool section (`read`, `write`, `edit`) requires a file-system bridge. The bridge abstracts the underlying storage so that tools can work against a local directory, a sandboxed container, a virtual file system, or any other backend.

### `createNodeBridge(root)` — local Node.js bridge

For local Node.js usage, import `createNodeBridge` and pass it in the context:

```ts
import { createClawtoolsAsync } from "clawtools";
import { createNodeBridge } from "clawtools/tools";

const ct = await createClawtoolsAsync();
const root = process.cwd();

const tools = ct.tools.resolveAll({
  workspaceDir: root,
  root,
  bridge: createNodeBridge(root),
});

// read/write/edit tools are now fully operational
const readTool = tools.find(t => t.name === "read")!;
const result = await readTool.execute(crypto.randomUUID(), { path: "README.md" });
```

### Custom bridge

To implement a custom bridge (container, virtual fs, remote storage, …), satisfy the `FsBridge` interface:

```ts
import type { FsBridge, FsStat } from "clawtools";

const myBridge: FsBridge = {
  async stat({ filePath, cwd }): Promise<FsStat | null> {
    // Return null if the path does not exist.
    return { type: "file", size: 42, mtimeMs: Date.now() };
  },
  async readFile({ filePath, cwd }): Promise<Buffer> {
    return Buffer.from("file contents");
  },
  async mkdirp({ filePath, cwd }): Promise<void> {
    // Create directory and all parents.
  },
  async writeFile({ filePath, cwd, data }): Promise<void> {
    // data is string | Buffer.
  },
};
```

Passes `root` and `bridge` together:

```ts
const tools = ct.tools.resolveAll({
  workspaceDir: "/sandbox/workspace",
  root: "/sandbox/workspace",
  bridge: myBridge,
});
```

Use `extractToolSchemas` to convert resolved tools into the format LLM APIs expect:

```ts
import { extractToolSchemas } from "clawtools/tools";

const schemas = extractToolSchemas(tools);
// → [{ name, description, input_schema }]

// Provider-specific cleaning (strips Gemini-incompatible JSON Schema keywords):
const geminiSchemas = extractToolSchemas(tools, "google");
```
