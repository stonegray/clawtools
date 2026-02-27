# clawtools — Usage Reference

Platform-agnostic adapter exposing OpenClaw tools and connectors to third-party software.

## What is clawtools?

clawtools wraps OpenClaw's tool and connector systems as a standalone NPM package. It lets any Node.js application:
- Discover and invoke OpenClaw's 25+ built-in agent tools (filesystem, shell, web, memory, sessions, browser, media, …)
- Stream LLM responses through any supported provider (Anthropic, OpenAI, Google, Bedrock, …)
- Load OpenClaw-compatible plugins that register custom tools and connectors
- Discover OpenClaw extensions (channel and provider plugins)

## Reference pages

- [Getting started](./getting-started.md)
- [Tools](./tools.md) — registry, discovery, resolveAll, context requirements, FsBridge
- [Connectors](./connectors.md) — streaming, StreamContext, connector auth table
- [Messages](./messages.md) — **clawtools message format** (UserMessage / AssistantMessage / ToolResultMessage)
- [Types](./types.md)
- [Plugins](./plugins.md)

## Package entry points

```
clawtools          → main API: createClawtools, createClawtoolsAsync, all registries and types
clawtools/tools    → ToolRegistry, discovery, result helpers, param readers, schema utils
clawtools/connectors → ConnectorRegistry, resolveAuth, discoverExtensions, builtins
clawtools/plugins  → loadPlugins
```

## Documents

| File | Contents |
|------|----------|
| [getting-started.md](./getting-started.md) | `createClawtools`, `createClawtoolsAsync`, `ClawtoolsOptions`, architecture |
| [tools.md](./tools.md) | `ToolRegistry` full API, discovery, core tool catalog, profiles, tool groups |
| [tool-helpers.md](./tool-helpers.md) | Result builders, parameter readers, schema utilities, error classes |
| [connectors.md](./connectors.md) | `ConnectorRegistry`, `resolveAuth`, built-in connectors, streaming |
| [messages.md](./messages.md) | **Message format** — `UserMessage`, `AssistantMessage`, `ToolResultMessage`, conversation history |
| [plugins.md](./plugins.md) | `loadPlugins`, `PluginDefinition`, `PluginApi`, authoring plugins |
| [types.md](./types.md) | Complete exported type reference |

## Minimal quick-start

```ts
import { createClawtoolsAsync, createNodeBridge } from "clawtools";
import { extractToolSchemas } from "clawtools/tools";

const ct = await createClawtoolsAsync();
const root = process.cwd();

// List all tools
for (const meta of ct.tools.list()) {
  console.log(`${meta.id} [${meta.sectionId}]: ${meta.description}`);
}

// Get executable tools — include root + bridge for read/write/edit tools
const tools = ct.tools.resolveAll({
  workspaceDir: root,
  root,
  bridge: createNodeBridge(root),
});

// Stream a response
const connector = ct.connectors.getByProvider("anthropic");
const model = connector.models!.find(m => m.id === "claude-opus-4-6")!;
for await (const event of connector.stream(model, {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Hello!" }],
  tools: extractToolSchemas(tools),
}, { apiKey: process.env.ANTHROPIC_API_KEY })) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}
```

> For a complete agentic loop with tool call handling, see [`examples/agentic/`](../../examples/agentic/) and [`messages.md`](./messages.md).

> **This project was created entirely using AI.** Zero lines of code were written by a human. Models used during development include Opus 4.5, Opus 4.6, Raptor Mini, GPT 5.2, and Sonnet 3.6.

