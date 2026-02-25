# clawtools

**clawtools** is a platform-agnostic adapter for [OpenClaw](https://github.com/openclaw/openclaw)'s tool and connector systems. It lets you use OpenClaw-compatible tools, connectors, and plugins as a standalone library — without running the OpenClaw daemon, agent loop, or messaging infrastructure.

**100% OpenClaw compatibility:** clawtools builds directly against the latest OpenClaw source via git submodule and and an advanced custom bundler. Every tool, connector, and plugin interface is compiled from the actual OpenClaw codebase — not stale copies or reimplementations. This guarantees compatibility with the latest OpenClaw releases and is resilliant to upstream changes while avoiding bundling the full code of openclaw.

## When to use this library

- **Your project needs tools or access to LLM APIs** — use OpenClaw's battle tested core tools (browser the web, write files) and connectors (openai, copilot, anthropic) in your own pipeline without the full OpenClaw stack
- **You want to experiment with openclaw plugins** — inspect tool schemas, execute tools directly, and develop against the registry outside the agent loop. (any plugin that works in OpenClaw works here)

## Installation

```bash
npm install clawtools
```

## Quick Start

The simplest usage is creating a `Clawtools` instance and querying its catalog:

```typescript
import { createClawtools } from "clawtools";

const ct = createClawtools();

console.log("tools:");
for (const t of ct.tools.list()) console.log(t.id);

console.log("connectors:");
for (const c of ct.connectors.list()) console.log(c.id);
```

From there you can resolve tools, register custom tools/connectors, or load plugins.

> See the [documentation](docs/usage.md) and the `examples/` directory for fuller
> quick‑starts (OpenAI connector, plugin loader, tool runner, etc.).


## Features

### Tool System
- **23 core tools** via lazy factories from the openclaw submodule
- Custom tool registration with direct and factory patterns
- Parameter helpers with snake_case fallback and type coercion
- Result helpers: `jsonResult`, `textResult`, `errorResult`, `imageResult`
- JSON Schema extraction with Gemini sanitizer
- `ToolContext` interface compatible with OpenClaw plugins

### Connector System
- `ConnectorRegistry` compatible with OpenClaw's `registerApiProvider`
- Discovers 36+ extensions by scanning `openclaw/extensions/` manifests
- Auth resolution from explicit keys, environment variables, and naming conventions (`<PROVIDER>_API_KEY`)
- Streaming interface (`AsyncIterable<StreamEvent>`) compatible with OpenClaw's API
- `ModelDescriptor` as a typed, compatible subset of `ModelDefinitionConfig`

### Plugin System
- Load any OpenClaw plugin package via `loadPlugins()`
- Supports `openclaw.plugin.json` manifests and conventional entry points
- Both `register` and `activate` export patterns
- Enable/disable filtering via `PluginLoaderOptions`
- Collects tools and connectors from loaded plugins

## Limitations

clawtools is a compatibility adapter, not a runtime. The following OpenClaw features are **not supported**:

**Auth & credentials**
- No auth profile rotation, per-profile cooldown, or round-robin selection
- No OAuth credential refresh or token lifecycle management
- No device code auth flow or interactive provider auth wizard

**Tool safety**
- No tool loop detection (repeat/poll/ping-pong guards)
- No exec approval via JSONL socket
- No per-sender tool allow/deny policies

**Plugin features**
- No plugin config schema validation (`configSchema` / `safeParse`)
- No plugin runtime helpers (media, events, TTS, memory)
- No logger injection or plugin config resolution from global config
- Requires pre-compiled JS — no jiti/TypeScript dynamic imports

**OpenClaw-only infrastructure (not exposed)**
- Hook system (26 lifecycle hooks), channel adapters (16 types), gateway RPC server
- Session persistence, agent loop, LLM streaming runtime
- Docker/browser sandbox, image sanitization pipeline
- Full `OpenClawConfig` system, multi-node clustering

> Plugin calls to `registerHook`, `registerHttpHandler`, `registerHttpRoute`, `registerChannel`, `registerGatewayMethod`, `registerCli`, `registerService`, `registerProvider`, `registerCommand`, and `on` are **accepted but silently discarded**. Plugins load without errors, but these registrations have no effect.

## Architecture

```
clawtools/
├── src/
│   ├── index.ts            # Main entry + createClawtools()
│   ├── types.ts            # All type definitions
│   ├── tools/
│   │   ├── registry.ts     # ToolRegistry class
│   │   ├── discovery.ts    # Core tool discovery from openclaw
│   │   ├── helpers.ts      # jsonResult, textResult, errorResult
│   │   ├── params.ts       # Parameter reading utilities
│   │   └── schema.ts       # JSON Schema extraction/normalization
│   ├── connectors/
│   │   ├── registry.ts     # ConnectorRegistry class
│   │   └── discovery.ts    # Extension discovery from openclaw
│   └── plugins/
│       └── loader.ts       # OpenClaw-compatible plugin loader
└── openclaw/               # Git submodule (read-only)
```

### Design Principles

1. **100% source compatibility** — clawtools builds directly from the OpenClaw git submodule. Every tool factory, connector, and plugin interface is compiled from the actual upstream source — not copies. This guarantees zero version drift.
2. **Read-only submodule** — The `openclaw/` directory is never modified. Only tool/connector implementations are deep-linked from it.
3. **No domain logic** — This library is a compatibility layer; it adds no features specific to any single tool.
4. **Fully typed** — All types are reimplemented standalone (no dependency on openclaw's type system).
5. **Modular** — Import only what you need via subpath exports.
6. **Extensible** — Register custom tools, connectors, and plugins alongside openclaw's built-ins.

## License

MIT
