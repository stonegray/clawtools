# clawtools

**clawtools** is a platform-agnostic adapter for [OpenClaw](https://github.com/openclaw/openclaw)'s tool and connector systems. It lets you use OpenClaw-compatible tools, connectors, and plugins as a standalone library — without running the OpenClaw daemon, agent loop, or messaging infrastructure.

**100% OpenClaw compatibility:** clawtools builds directly against the latest OpenClaw source via git submodule and an advanced custom bundler. Every tool, connector, and plugin interface is compiled from the actual OpenClaw codebase — not stale copies or reimplementations. This guarantees compatibility with the latest OpenClaw releases and is resilient to upstream changes while avoiding bundling the full code of openclaw.

## When to use this library

- **Your project needs tools or access to LLM APIs** — use OpenClaw's battle-tested core tools (browse the web, write files, run shell commands) and built-in connectors (Anthropic, OpenAI, Google, Bedrock, …) in your own pipeline without the full OpenClaw stack
- **You want to experiment with OpenClaw plugins** — inspect tool schemas, execute tools directly, and develop against the registry outside the agent loop (any plugin that works in OpenClaw works here)

## Installation

```bash
npm install clawtools
```

Requires **Node.js ≥ 22**.

**Required runtime dependencies:** `@sinclair/typebox`, `ajv`, and `undici` are listed in
`dependencies` and must be present at runtime. They are kept *external* to the tool bundles
(not inlined) so that consumers can share a single installed copy and choose compatible
versions. If you see `Cannot find package '@sinclair/typebox'` (or `ajv`/`undici`) at runtime,
ensure these packages are installed in your project (`npm install @sinclair/typebox ajv undici`).

## Quick Start

```typescript
import { createClawtools, createNodeBridge } from "clawtools";
import { extractToolSchemas } from "clawtools/tools";

const ct = await createClawtools();
const root = process.cwd();

// Resolve tools — include root + bridge to enable read/write/edit
const tools = ct.tools.resolveAll({
  workspaceDir: root,
  root,
  bridge: createNodeBridge(root),
});

// Stream a response with tool use
const connector = ct.connectors.getByProvider("anthropic");
const model = connector.models.find(m => m.id === "claude-opus-4-6")!;

for await (const event of connector.stream(model, {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Hello!" }],
  tools: extractToolSchemas(tools),
}, { apiKey: process.env.ANTHROPIC_API_KEY })) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}
```

> For a complete agentic loop (stream → handle tool calls → feed results back → repeat), see
> [`examples/agentic/`](examples/agentic/) and [`docs/usage/messages.md`](docs/usage/messages.md).

## Package entry points

```
clawtools            → createClawtools, createClawtoolsSync, all registries and types
clawtools/tools      → ToolRegistry, discovery, result helpers, param readers, schema utils
clawtools/connectors → ConnectorRegistry, resolveAuth, discoverExtensions, builtins
clawtools/plugins    → loadPlugins
```

## Features

### Tool System
- **23 core tools** compiled directly from the OpenClaw submodule: filesystem (`read`, `write`, `edit`), runtime (`exec`), web (`web_search`, `web_fetch`), memory, sessions, browser, canvas, messaging, automation, media, and more
- Sync (`createClawtoolsSync`) and async (`createClawtools`) entry points — sync for catalog/metadata, async for executable tools backed by pre-built ESM bundles
- **`FsBridge` interface + `createNodeBridge(root)`** — plug any filesystem backend (local Node.js, sandboxed container, virtual FS) into the `read`/`write`/`edit` tools; `createNodeBridge` is the ready-to-use Node.js implementation
- Filter tools by **profile** (`minimal`, `coding`, `messaging`, `full`) or **group** (`group:fs`, `group:web`, …)
- Custom tool registration: direct `Tool` objects or lazy `ToolFactory` functions
- Parameter helpers with camelCase/snake_case fallback, type coercion, and `ToolInputError` / `ToolAuthorizationError`
- Result builders: `jsonResult`, `textResult`, `errorResult`, `imageResult`
- JSON Schema extraction with Gemini keyword sanitizer

### Connector System
- Built-in connectors for every provider in the `@mariozechner/pi-ai` catalog (Anthropic, OpenAI, Google, Amazon Bedrock, …) — loaded automatically by `createClawtools`
- `ConnectorRegistry` with lookup by ID, provider name, or API transport
- Uniform `AsyncIterable<StreamEvent>` streaming interface across all providers
- **Typed conversation history** — `UserMessage`, `AssistantMessage`, `ConversationMessage` types; `StreamContext.messages` is fully typed
- **Internal message format** — clawtools uses `role: "toolResult"` (not OpenAI's `role: "tool"` or Anthropic's nested `content` block); see [docs/usage/messages.md](docs/usage/messages.md)
- Auth resolution from explicit keys, environment variables, and `<PROVIDER>_API_KEY` conventions; per-connector env var table in [docs/usage/connectors.md](docs/usage/connectors.md)
- Extension discovery: scans `openclaw/extensions/` manifests for channel and provider plugins

### Plugin System
- Load any OpenClaw-compatible plugin package via `loadPlugins()`
- `openclaw.plugin.json` manifests with enable/disable filtering
- Both `register` and `activate` export patterns supported
- Collects `Tool[]`, `ToolFactory[]`, and `Connector[]` from loaded plugins
- 10 OpenClaw-only registration methods (hooks, channels, gateway, CLI, …) are **accepted as no-ops** so plugins load cleanly without errors

## Limitations

clawtools is intentionally minimal: it’s a compatibility layer, not a full OpenClaw runtime. Core behaviors such as auth/profile management, tool‑safety checks, plugin runtime helpers, and the gateway/session infrastructure are deliberately out of scope and simply not implemented. Plugins may still call those APIs, but the calls are ignored.

## Architecture

```
clawtools/
├── src/
│   ├── index.ts            # createClawtools, createClawtoolsSync, re-exports
│   ├── types.ts            # All type definitions (standalone, no openclaw dependency)
│   ├── tools/
│   │   ├── registry.ts     # ToolRegistry class
│   │   ├── discovery.ts    # Core tool discovery — bundles or source fallback
│   │   ├── node-bridge.ts  # createNodeBridge() — local Node.js FsBridge implementation
│   │   ├── helpers.ts      # jsonResult, textResult, errorResult, imageResult
│   │   ├── params.ts       # Parameter reading utilities
│   │   └── schema.ts       # JSON Schema extraction/normalization/Gemini cleaning
│   ├── connectors/
│   │   ├── registry.ts     # ConnectorRegistry class + resolveAuth
│   │   ├── discovery.ts    # Extension discovery + built-in connector loader
│   │   └── pi-ai-bridge.ts # Adapts @mariozechner/pi-ai providers → Connector (bundled)
│   └── plugins/
│       └── loader.ts       # OpenClaw-compatible plugin loader
├── examples/
│   ├── agentic/        # Complete agentic loop: stream → tool use → feed back
│   ├── connector/      # Built-in OpenAI connector + custom echo connector
│   └── tool/read-file/ # Call a tool directly, no LLM
└── openclaw/           # Git submodule (read-only)
```

### Design Principles

1. **100% source compatibility** — Every tool factory, connector, and plugin interface is compiled from the actual OpenClaw upstream source. Zero version drift by construction.
2. **Read-only submodule** — The `openclaw/` directory is never modified. Tool and connector implementations are deep-linked from it at build time into standalone ESM bundles.
3. **No domain logic** — This library is a compatibility layer; it adds no features specific to any single tool.
4. **Fully typed** — All types are reimplemented standalone with no runtime dependency on the openclaw package.
5. **Modular** — Import only what you need via subpath exports (`clawtools/tools`, `clawtools/connectors`, `clawtools/plugins`).
6. **Extensible** — Register custom tools, connectors, and plugins alongside OpenClaw's built-ins.

## License

MIT

> **This project was created entirely using AI.** Zero lines of code were written by a human. Models used during development include Opus 4.5, Opus 4.6, Raptor Mini, GPT 5.2, and Sonnet 3.6.
