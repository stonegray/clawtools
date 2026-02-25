# 03 — Tool Packaging Format

> How tools are packaged, discovered, and distributed.
> Extracted from: `src/plugins/manifest.ts`, `src/plugins/discovery.ts`, `src/plugins/loader.ts`

---

## 1. Plugin Manifest: `openclaw.plugin.json`

### 1.1 Schema

```json
{
  "id": "string (required)",
  "name": "string (optional)",
  "description": "string (optional)",
  "version": "string (optional)",
  "kind": "memory | undefined",
  "configSchema": {
    "type": "object",
    "properties": { ... },
    "required": [ ... ]
  },
  "channels": ["string"],
  "providers": ["string"],
  "skills": ["string"],
  "uiHints": {
    "propertyName": {
      "label": "string",
      "help": "string",
      "tags": ["string"],
      "advanced": "boolean",
      "sensitive": "boolean",
      "placeholder": "string"
    }
  }
}
```

### 1.2 Required Fields

| Field          | Type                        | Description                    |
|----------------|-----------------------------|--------------------------------|
| `id`           | `string`                    | Unique plugin identifier       |
| `configSchema` | `Record<string, unknown>`   | JSON Schema for plugin config  |

### 1.3 Optional Fields

| Field         | Type                  | Description                      |
|---------------|-----------------------|----------------------------------|
| `name`        | `string`              | Human-readable display name      |
| `description` | `string`              | Plugin description               |
| `version`     | `string`              | Semantic version                 |
| `kind`        | `"memory"`            | Plugin kind (only "memory")      |
| `channels`    | `string[]`            | Channel IDs provided             |
| `providers`   | `string[]`            | LLM provider IDs provided        |
| `skills`      | `string[]`            | Skill names provided             |
| `uiHints`     | `Record<string, ...>` | Config UI rendering hints        |

---

## 2. Package.json Extension Field

The `package.json` can contain an `openclaw` key:

```json
{
  "name": "@openclaw/telegram",
  "version": "2026.2.23",
  "openclaw": {
    "extensions": ["src/index.ts"],
    "channel": {
      "id": "telegram",
      "label": "Telegram",
      "category": "messaging"
    },
    "install": {
      "source": "npm"
    }
  }
}
```

### 2.1 Fields

```typescript
type OpenClawPackageManifest = {
  extensions?: string[];              // Entry point paths
  channel?: PluginPackageChannel;     // Channel catalog metadata
  install?: PluginPackageInstall;     // Install source hints
};
```

---

## 3. Directory Structure

### 3.1 Minimal Plugin

```
my-plugin/
  openclaw.plugin.json     # Plugin manifest (required)
  src/
    index.ts               # Entry point
  package.json             # npm package metadata
```

### 3.2 Full Plugin Structure

```
my-plugin/
  openclaw.plugin.json     # Plugin manifest
  src/
    index.ts               # Entry point (register function)
    tools/
      my-tool.ts           # Tool implementation
    hooks/
      my-hook.ts           # Hook handler
  package.json
  tsconfig.json
  README.md
```

---

## 4. Entry Point Format

### 4.1 Function Export (Simplest)

```typescript
// src/index.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export default function register(api: OpenClawPluginApi) {
  api.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Does something useful",
    parameters: Type.Object({
      input: Type.String({ description: "Input text" }),
    }),
    execute: async (toolCallId, params) => {
      return {
        content: [{ type: "text", text: `Result: ${params.input}` }],
        details: { input: params.input },
      };
    },
  });
}
```

### 4.2 Definition Object Export

```typescript
// src/index.ts
import type { OpenClawPluginDefinition } from "openclaw/plugin-sdk";

const plugin: OpenClawPluginDefinition = {
  id: "my-plugin",
  name: "My Plugin",
  description: "Description",
  version: "1.0.0",
  register(api) {
    api.registerTool(myTool);
    api.registerHook("before_tool_call", myHookHandler);
  },
};

export default plugin;
```

### 4.3 Supported Export Patterns

The loader resolves exports in this order:

1. `module.default` if it exists
2. The module itself

If the resolved value is:
- A **function** → treated as `register` function
- An **object** → treated as `OpenClawPluginDefinition`
  - Looks for `.register` or `.activate` method

---

## 5. Discovery Locations

### 5.1 Priority Order

| Priority | Origin       | Location                                   |
|----------|-------------|---------------------------------------------|
| 1        | `config`    | Paths in `config.plugins.loadPaths`          |
| 2        | `workspace` | `./extensions/` relative to workspace        |
| 3        | `global`    | `~/.openclaw/extensions/`                    |
| 4        | `bundled`   | Built-in extensions shipped with package     |

Higher priority wins when the same plugin ID is found in multiple locations.

### 5.2 File Discovery

For each location, the discovery system scans:

1. **Direct files**: `.ts`, `.js`, `.mts`, `.cjs`, `.mjs`, `.cts`
2. **Directories**: Checks `package.json` → `openclaw.extensions` field
3. **Fallback**: Looks for `src/index.ts` or `index.ts` in directories

### 5.3 Security Checks

Before accepting a candidate:

- **Symlink escape**: Source must stay inside plugin root after `realpath()`
- **World-writable**: Path must not have world-writable permissions
- **Ownership**: On non-bundled plugins, file UID must match current user or root

---

## 6. Module Loading

### 6.1 Jiti Loader

OpenClaw uses `jiti` for TypeScript-aware dynamic imports:

```typescript
const jiti = createJiti(import.meta.url, {
  alias: {
    "openclaw/plugin-sdk": resolvePluginSdkAlias(),
    "openclaw/plugin-sdk/account-id": resolvePluginSdkAccountIdAlias(),
  },
});

const module = await jiti.import(candidate.source);
```

### 6.2 Alias Resolution

The `openclaw/plugin-sdk` import is aliased to:
- **Development**: `src/plugin-sdk/index.ts`
- **Production**: `dist/plugin-sdk/index.js`

The alias is resolved by walking up from the current file to find the `src/` or `dist/` directory.

---

## 7. Config Validation

### 7.1 JSON Schema Validation

Plugin config is validated against the manifest's `configSchema`:

```typescript
function validatePluginConfig(params: {
  schema?: Record<string, unknown>;  // JSON Schema from manifest
  cacheKey?: string;
  value?: unknown;                   // Plugin config from OpenClaw config
}): { ok: boolean; value?: Record<string, unknown>; errors?: string[] }
```

### 7.2 Config Source

Plugin config comes from the main OpenClaw config file:

```json5
// ~/.openclaw/openclaw.json
{
  "plugins": {
    "entries": {
      "my-plugin": {
        "enabled": true,
        "apiKey": "sk-..."
      }
    }
  }
}
```

---

## 8. Distribution Methods

### 8.1 Bundled (Built-in)

Ships with the `openclaw` npm package in the `extensions/` directory.

### 8.2 npm Package

```bash
cd ~/.openclaw/extensions/
npm install @openclaw/my-plugin
```

### 8.3 Local / Git

```bash
cd ~/.openclaw/extensions/
git clone https://github.com/user/my-openclaw-plugin
cd my-openclaw-plugin && npm install --omit=dev
```

### 8.4 Config Path

```json5
{
  "plugins": {
    "loadPaths": ["/path/to/my-plugin"]
  }
}
```

---

## 9. Dependencies

### 9.1 Plugin Dependencies

- Runtime deps must be in `dependencies` (not `devDependencies`)
- `openclaw` should be in `peerDependencies` or `devDependencies`
- **Never** use `workspace:*` in `dependencies` (breaks npm install)
- The `openclaw/plugin-sdk` import is resolved via jiti alias at runtime

### 9.2 Installation

Plugin installation runs:
```bash
npm install --omit=dev
```

This installs only production dependencies.
