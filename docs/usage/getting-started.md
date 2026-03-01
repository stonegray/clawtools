# Getting Started

## Installation

```bash
npm install clawtools
```

Requires **Node.js ≥ 22**.

---

## Two entry functions

### `createClawtools(options?)` — sync, metadata-only

Returns immediately. Core tool factories are registered but **will not execute** — `resolveAll()` returns tools whose `execute` methods do nothing (the underlying modules have not been dynamically imported). Use this when you only need the catalog (names, descriptions, schemas, profiles).

```ts
import { createClawtools } from "clawtools";

const ct = createClawtools();

for (const meta of ct.tools.list()) {
  console.log(`${meta.id}: ${meta.description}`);
}
```

### `createClawtools(options?)` — async, fully executable

Awaits ESM dynamic imports for every core tool and (by default) all built-in LLM connectors. After awaiting, tools returned by `resolveAll()` have working `execute` methods and connectors have working `stream` methods.

```ts
import { createClawtools, createNodeBridge } from "clawtools";

const ct = await createClawtools();
const root = process.cwd();

const tools = ct.tools.resolveAll({
  workspaceDir: root,
  root,
  bridge: createNodeBridge(root),
});
console.log(`${tools.length} executable tools available`);
```

---

## `ClawtoolsOptions`

Both functions accept the same options object:

```ts
interface ClawtoolsOptions {
  // Path to the openclaw source tree or submodule root.
  // Defaults to ./openclaw relative to the package root.
  // Only relevant when running from source (no dist/core-tools/ bundle).
  openclawRoot?: string;

  // Tool discovery filters — see DiscoveryOptions in tools.md
  tools?: DiscoveryOptions;

  // Override the openclaw/extensions directory for extension scanning.
  extensionsDir?: string;

  // Skip auto-discovery of core OpenClaw tools.
  // Useful when you only want to register your own tools.
  skipCoreTools?: boolean;

  // Skip auto-registration of built-in LLM provider connectors.
  // Only applies to createClawtools(). Default: false (connectors ARE registered).
  skipBuiltinConnectors?: boolean;

  // If true, begin loading tools and connectors in the background but return
  // the Clawtools instance immediately without waiting.
  // Await ct.ready before calling resolveAll() or streaming.
  // Only applies to createClawtools(). Has no effect on createClawtoolsSync().
  lazy?: boolean;
}
```

**Example — load only specific tools, no connectors:**

```ts
const ct = await createClawtools({
  tools: { include: ["read", "write", "exec"] },
  skipBuiltinConnectors: true,
});
```

**Example — load all tools in the `fs` group:**

```ts
const ct = await createClawtools({
  tools: { include: ["group:fs"] },
});
```

**Example — background loading with `lazy: true`:**

Use `lazy: true` when you need catalog metadata (tool names, descriptions, schemas, connector names) immediately at startup but want to defer pulling in provider SDKs until they are actually needed:

```ts
const ct = await createClawtools({ lazy: true });

// Catalog is ready immediately — list tools, filter by profile, etc.
const meta = ct.tools.list();
console.log(`${meta.length} tools registered`);

// ... time passes, user triggers an action that needs execution ...

// Wait for background loading to finish before resolving/streaming.
await ct.ready;
const tools = ct.tools.resolveAll({
  root: process.cwd(),
  bridge: createNodeBridge(process.cwd()),
});
```

> **Note:** Calling `resolveAll()` or `connector.stream()` before `ct.ready` resolves may return stub tools that cannot execute or throw because provider SDKs have not finished loading.

---

## Return value: `Clawtools`

```ts
interface Clawtools {
  tools: ToolRegistry;           // see tools.md
  connectors: ConnectorRegistry; // see connectors.md
  extensions: ExtensionInfo[];   // discovered openclaw extension metadata
  ready: Promise<void>;          // resolves when all background loading is complete
}
```

`extensions` is always populated (no async required). Each entry describes a channel or provider plugin found in the openclaw extensions directory:

```ts
interface ExtensionInfo {
  id: string;
  name: string;
  description?: string;
  channels: string[];   // channel IDs (e.g., ["telegram"])
  providers: string[];  // provider IDs (e.g., ["copilot"])
  path: string;         // absolute path to the extension directory
  entryPoint?: string;  // absolute path to the entry point file
}
```

---

## Tool loading strategy

Core tool execution depends on pre-built bundles:

1. **Bundled tools** (production, after `npm run build`): `discoverCoreToolsAsync` loads `dist/core-tools/<tool>.js` bundles via the manifest at `dist/core-tools/manifest.json`. Works in any Node 22+ environment with no TypeScript runtime needed.

2. **Source fallback** (development): If no bundles exist but the openclaw git submodule is present, tools are loaded from `.ts` source files. Requires a TypeScript-capable runtime (vitest, tsx, ts-node, or Node 22+ with `--experimental-strip-types`).

If neither is available, tool metadata is still registered (catalog works) but `execute` returns nothing. `DiscoveryOptions.onLoadWarning` receives a descriptive message when tools cannot load.

> **Agentic loop?** See [`examples/agentic/`](../../examples/agentic/) for a complete stream → handle tool calls → feed results back → repeat loop, and [`docs/usage/messages.md`](./messages.md) for the message format you need to build the conversation history correctly.

---

## Using registries directly (without `createClawtools*`)

All registries can be constructed and populated manually:

```ts
import { ToolRegistry, ConnectorRegistry, discoverCoreToolsAsync } from "clawtools";

const tools = new ToolRegistry();
await discoverCoreToolsAsync(tools, { include: ["group:fs", "exec"] });

tools.register({
  name: "my_tool",
  description: "My custom tool",
  parameters: { type: "object", properties: { input: { type: "string" } } },
  execute: async (id, params) => ({ content: [{ type: "text", text: String(params.input) }] }),
});
```
