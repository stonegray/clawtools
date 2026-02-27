# Plugin System

clawtools can load OpenClaw-compatible plugins from the filesystem. Plugins register tools and connectors via a standard API surface.

## Import path

```ts
import { loadPlugins } from "clawtools/plugins";
import { loadPlugins } from "clawtools";
```

---

## `loadPlugins(options)` → `Promise<LoadedPlugin[]>`

Scan directories for plugin packages, load their entry points, call their `register`/`activate` function, and collect all registrations.

```ts
import { loadPlugins } from "clawtools/plugins";

const plugins = await loadPlugins({
  searchPaths: ["./my-plugins", "~/.openclaw/extensions"],
  logger: console,
});

for (const plugin of plugins) {
  console.log(`${plugin.id}: ${plugin.tools.length} tools, ${plugin.connectors.length} connectors`);

  // Register tools into your registry
  for (const tool of plugin.tools) {
    toolRegistry.register(tool);
  }
  for (const { factory, names, optional } of plugin.toolFactories) {
    // Register factories with a generated meta or your own meta
    toolRegistry.registerFactory(factory, {
      id: names?.[0] ?? `${plugin.id}-factory`,
      label: names?.[0] ?? plugin.name,
      description: plugin.description ?? "",
      sectionId: "plugin",
      profiles: ["full"],
      source: "plugin",
      pluginId: plugin.id,
    });
  }
  for (const connector of plugin.connectors) {
    connectorRegistry.register(connector);
  }
}
```

### `PluginLoaderOptions`

```ts
interface PluginLoaderOptions {
  // Directories to scan. Each should contain plugin subdirectories with openclaw.plugin.json.
  searchPaths: string[];

  // If set, only these plugin IDs are loaded.
  enabledPlugins?: string[];

  // Plugin IDs to skip entirely.
  disabledPlugins?: string[];

  // Logger for diagnostics.
  logger?: {
    info:  (msg: string) => void;
    warn:  (msg: string) => void;
    error: (msg: string) => void;
  };
}
```

### `LoadedPlugin`

```ts
interface LoadedPlugin {
  id: string;
  name: string;
  description?: string;
  version?: string;
  source: string;        // absolute path to the loaded entry point

  // Directly registered tools
  tools: Tool[];

  // Factory registrations
  toolFactories: Array<{
    factory: ToolFactory;
    names?: string[];    // tool names the factory is expected to produce
    optional?: boolean;
  }>;

  // Registered connectors
  connectors: Connector[];
}
```

---

## Plugin discovery

A plugin is discovered when a directory contains `openclaw.plugin.json` at its root.

### `PluginManifest` (`openclaw.plugin.json`)

```ts
interface PluginManifest {
  id: string;           // required — unique plugin identifier
  name?: string;
  description?: string;
  version?: string;
  kind?: "memory";
  configSchema?: Record<string, unknown>;
  channels?: string[];  // channel IDs provided by this plugin
  providers?: string[]; // provider IDs provided by this plugin
  skills?: string[];
}
```

**Example `openclaw.plugin.json`:**
```json
{
  "id": "my-tools-plugin",
  "name": "My Tools Plugin",
  "description": "Adds custom tools to OpenClaw",
  "version": "1.0.0"
}
```

### Entry point resolution

The loader looks for an entry point in this order:
1. `package.json` → `openclaw.extensions[0]` field (relative path)
2. `index.ts`
3. `index.js`
4. `src/index.ts`
5. `src/index.js`
6. `index.mts`
7. `index.mjs`

> **Note:** The loader does **not** use a TypeScript runtime (no jiti). Entry points must be pre-compiled JavaScript unless you are running under Node 22+ with `--experimental-strip-types`, tsx, or ts-node.

---

## Writing a plugin

A plugin exports a `register` (or `activate`) function, or exports it as the default export.

### Named export pattern

```ts
// my-plugin/index.js
import { jsonResult } from "clawtools/tools";

export function register(api) {
  api.registerTool({
    name: "my_tool",
    description: "A tool provided by my plugin",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      required: ["input"],
    },
    execute: async (id, params) => jsonResult({ echo: params.input }),
  });
}
```

### Default export function pattern

```ts
// my-plugin/index.js
export default function(api) {
  api.registerTool({ /* ... */ });
}
```

### Object with `register` or `activate` field

```ts
// my-plugin/index.js
export default {
  register(api) {
    api.registerTool({ /* ... */ });
  },
};
```

### Export resolution order

When the loader imports a plugin entry point it determines the registration
function using the following priority (applied to `default ?? module`):

1. **`default` export checked first** (`mod.default`):
   - A function → used directly as the register function.
   - An object with a `register` method → that method is called.
   - An object with an `activate` method → that method is called.
2. **Named exports as fallback** (when no `default` is present, the module
   namespace object is used):
   - A named `register` function → used as the register function.
   - A named `activate` function → used as the register function.

> **Note:** A bare named `plugin` export (e.g. `export const plugin = { register: fn }`)
> is **not** recognised by the loader. If you use this pattern alongside a `default`
> export, the `default` export takes precedence and the `plugin` export is silently
> ignored. Always use one of the four supported patterns listed above.

### Registering a tool factory

```ts
export function register(api) {
  api.registerTool(
    (ctx) => {
      if (!ctx.workspaceDir) return null;
      return {
        name: "workspace_read",
        description: "Read a file from the workspace",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        execute: async (id, params) => {
          const fs = await import("node:fs/promises");
          const data = await fs.readFile(`${ctx.workspaceDir}/${params.path}`, "utf-8");
          return { content: [{ type: "text", text: data }] };
        },
      };
    },
    { name: "workspace_read" },
  );
}
```

---

## `PluginApi` surface

The `api` object passed to `register`/`activate` exposes these methods:

### Active (registrations are collected)

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerTool` | `(tool \| factory, opts?)` | Register a Tool or ToolFactory. `opts.name`, `opts.names`, `opts.optional` |
| `registerConnector` | `(connector)` | Register a Connector |

`api.id` and `api.name` reflect the plugin's identity from its manifest.

### No-op stubs (OpenClaw compatibility — silently ignored by clawtools)

These methods are accepted without throwing so that plugins written for the full OpenClaw runtime load cleanly through clawtools. Their registrations are discarded.

| Method | Notes |
|--------|-------|
| `registerHook(events, handler, opts?)` | Lifecycle hooks require the OpenClaw runtime |
| `registerHttpHandler(handler)` | Requires the OpenClaw gateway server |
| `registerHttpRoute({ path, handler })` | Requires the OpenClaw gateway server |
| `registerChannel(registration)` | Requires the OpenClaw messaging runtime |
| `registerGatewayMethod(method, handler)` | Requires the OpenClaw gateway server |
| `registerCli(registrar, opts?)` | Requires the OpenClaw CLI runtime |
| `registerService({ id, start, stop? })` | Requires the OpenClaw service lifecycle manager |
| `registerProvider(provider)` | Requires the OpenClaw auth wizard system |
| `registerCommand({ name, description, handler })` | Requires the OpenClaw command router |
| `resolvePath(input)` | Returns `input` unchanged (no plugin directory context in clawtools) |
| `on(hookName, handler, opts?)` | No-op — alternative to `registerHook` |

---

## `PluginDefinition` type

For TypeScript plugin authors who want type safety on their plugin export:

```ts
import type { PluginDefinition } from "clawtools";

const myPlugin: PluginDefinition = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",

  register(api) {
    api.registerTool({
      name: "ping",
      description: "Returns pong",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
    });
  },
};

export default myPlugin;
```
