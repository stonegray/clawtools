# Usage Guide

How to use OpenClaw tools and connectors in your own application.

---

## Installation

```sh
npm install clawtools
```

clawtools has zero runtime dependencies. The `openclaw` submodule ships as part of the package and is referenced at runtime for core tool implementations.

---

## Quick Start

```ts
import { createClawtools } from "clawtools";

const ct = createClawtools();

// 23 core tools are available immediately
console.log(`${ct.tools.size} tools loaded`);

// Resolve all tools for an LLM context
const tools = ct.tools.resolveAll({ workspaceDir: "/my/project" });
```

`createClawtools()` is a convenience factory that creates both registries and auto-discovers all core tools. For more control, use the registries directly (see below).

---

## Tools

### Resolving tools for an LLM

The typical flow is: resolve tools → pass schemas to the LLM → execute the tool the LLM selects.

```ts
import { createClawtools, extractToolSchemas } from "clawtools";

const ct = createClawtools();

const ctx = {
  workspaceDir: "/my/project",
  agentId: "my-agent",
  sessionKey: "session-123",
};

// Resolve the tools you want for this request
const tools = ct.tools.resolveByProfile("coding", ctx);

// Convert to JSON Schema format for sending to an LLM
const schemas = extractToolSchemas(tools);

// schemas is now:
// [{ name: "read", description: "...", input_schema: { type: "object", ... } }, ...]
```

For providers that need Gemini-compatible schemas (no `additionalProperties`, `$schema`, etc.):

```ts
import { extractToolSchemas, cleanSchemaForGemini } from "clawtools";

const schemas = extractToolSchemas(tools).map((s) => ({
  ...s,
  input_schema: cleanSchemaForGemini(s.input_schema),
}));
```

### Executing a tool call

When the LLM returns a tool call, find the tool by name and call `execute()`:

```ts
// Incoming tool call from the LLM:
const toolCall = {
  id: "call_abc123",
  name: "read",
  arguments: { path: "src/index.ts" },
};

const tool = ct.tools.resolve(toolCall.name, ctx);

if (!tool) {
  throw new Error(`Unknown tool: ${toolCall.name}`);
}

const result = await tool.execute(
  toolCall.id,
  toolCall.arguments,
  AbortSignal.timeout(30_000),  // optional cancellation
);

// result.content is an array of ContentBlock (text or image)
// result.details has the structured payload if needed
console.log(result.content[0]); // { type: "text", text: "..." }
```

### Tool profiles

Use profiles to control which tools are available per use case:

| Profile | Tools included |
|---------|---------------|
| `"minimal"` | `session_status` only |
| `"coding"` | File I/O, exec, web, memory, sessions, media |
| `"messaging"` | Sessions, message tool |
| `"full"` | All 23 tools |

```ts
// Only coding-relevant tools for a code assistant
const codingTools = ct.tools.resolveByProfile("coding", ctx);

// All tools for an unrestricted agent
const allTools = ct.tools.resolveAll(ctx);
```

### Registering a custom tool

```ts
import { createClawtools, jsonResult, textResult, errorResult } from "clawtools";
import { readStringParam, readNumberParam, readBooleanParam, ToolInputError } from "clawtools/tools";

const ct = createClawtools();

ct.tools.register({
  name: "lookup_user",
  label: "Lookup User",
  description: "Look up a user by their ID and return their profile.",
  parameters: {
    type: "object",
    properties: {
      user_id: { type: "string", description: "The user's UUID" },
      include_activity: { type: "boolean", description: "Include recent activity" },
    },
    required: ["user_id"],
  },
  async execute(toolCallId, params, signal) {
    const userId = readStringParam(params, "userId", { required: true });
    const includeActivity = readBooleanParam(params, "includeActivity", false);

    try {
      const user = await db.users.findById(userId, { signal });
      if (!user) return errorResult("lookup_user", `User ${userId} not found`);

      return jsonResult({ user, activity: includeActivity ? await db.activity(userId) : null });
    } catch (err) {
      return errorResult("lookup_user", String(err));
    }
  },
});
```

### Tool context

`ToolContext` is passed to factory-based tools on resolution. It carries per-request information:

```ts
const ctx = {
  workspaceDir: "/my/project",   // filesystem tools scope to this
  agentDir: "/my/agent-data",    // agent state directory
  agentId: "assistant",
  sessionKey: "sess-abc123",
  messageChannel: "api",
  sandboxed: false,
};

const tools = ct.tools.resolveAll(ctx);
```

Fields are all optional — omit what doesn't apply to your use case.

---

## Connectors

### Registering a connector

A connector provides a streaming interface to an LLM provider.

```ts
import { createClawtools, resolveAuth } from "clawtools";

const ct = createClawtools();

ct.connectors.register({
  id: "anthropic",
  label: "Anthropic Claude",
  provider: "anthropic",
  api: "anthropic-messages",
  envVars: ["ANTHROPIC_API_KEY"],
  models: [
    {
      id: "claude-opus-4-5",
      name: "Claude Opus 4.5",
      api: "anthropic-messages",
      provider: "anthropic",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 32768,
    },
  ],
  async *stream(model, context, options) {
    const response = await fetch(`${model.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      signal: options.signal,
      headers: {
        "x-api-key": options.apiKey ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: options.maxTokens ?? model.maxTokens,
        system: context.systemPrompt,
        messages: context.messages,
        tools: context.tools,
        stream: true,
      }),
    });

    // parse SSE and yield StreamEvents ...
  },
});

// Resolve auth for the provider
const auth = resolveAuth("anthropic", ["ANTHROPIC_API_KEY"]);
if (!auth) throw new Error("ANTHROPIC_API_KEY not set");

// Get the connector and stream
const connector = ct.connectors.getByProvider("anthropic");
const model = connector.models![0];

for await (const event of connector.stream(model, { messages: [...] }, { apiKey: auth.apiKey })) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  if (event.type === "done") break;
}
```

### Auth resolution

`resolveAuth` finds API keys with a three-level priority:

1. Explicit key passed as argument
2. Named environment variables from the connector's `envVars` list
3. Convention: `<PROVIDER_UPPER>_API_KEY`

```ts
import { resolveAuth } from "clawtools/connectors";

// Checks ANTHROPIC_API_KEY by convention
const auth = resolveAuth("anthropic");

// Checks custom env vars first, then falls back to convention
const auth2 = resolveAuth("my-provider", ["MY_PROVIDER_TOKEN", "MY_PROVIDER_KEY"]);

// Explicit key overrides everything
const auth3 = resolveAuth("my-provider", [], process.env.MY_KEY);

if (auth?.apiKey) {
  console.log(`Using key from ${auth.source}`); // e.g. "env:ANTHROPIC_API_KEY"
}
```

### Discovering OpenClaw extensions

OpenClaw ships with extensions for Telegram, Discord, Slack, Signal, iMessage, WhatsApp, provider auth wizards, and more. `discoverExtensions()` returns their metadata without loading them.

```ts
import { discoverExtensions, listChannelExtensions, listProviderExtensions } from "clawtools/connectors";

// All extensions
const all = discoverExtensions();
console.log(`${all.length} extensions found`);

// Filter by type
const channels = listChannelExtensions();    // Telegram, Discord, etc.
const providers = listProviderExtensions();  // Copilot proxy, Gemini CLI, etc.

for (const ext of channels) {
  console.log(`${ext.id}: channels=${ext.channels.join(", ")}`);
  // e.g. "telegram: channels=telegram"
}
```

---

## Plugins

### Loading OpenClaw-compatible plugins

Plugins can register additional tools and connectors. The loader reads `openclaw.plugin.json` manifests and calls the plugin's `register` or `activate` export.

```ts
import { loadPlugins } from "clawtools/plugins";
import { ToolRegistry } from "clawtools/tools";
import { ConnectorRegistry } from "clawtools/connectors";

const tools = new ToolRegistry();
const connectors = new ConnectorRegistry();

const plugins = await loadPlugins({
  searchPaths: [
    "./my-plugins",
    `${process.env.HOME}/.openclaw/extensions`,
  ],
  enabledPlugins: ["my-memory-plugin"],  // opt-in list (omit to enable all)
  disabledPlugins: ["noisy-plugin"],     // explicit exclusions
  logger: console,
});

for (const plugin of plugins) {
  // Register all tools the plugin provided
  for (const tool of plugin.tools) {
    tools.register(tool, { source: "plugin", pluginId: plugin.id });
  }

  // Register factories (deferred creation)
  for (const { factory, names, optional } of plugin.toolFactories) {
    const meta = {
      id: names?.[0] ?? plugin.id,
      label: names?.[0] ?? plugin.name,
      description: plugin.description ?? "",
      sectionId: "plugin",
      profiles: ["full"] as const,
      source: "plugin" as const,
      pluginId: plugin.id,
    };
    tools.registerFactory(factory, meta);
  }

  // Register connectors
  for (const connector of plugin.connectors) {
    connectors.register(connector);
  }
}
```

### Writing a plugin

Plugins export a `register` (or `activate`) function that receives a `PluginApi`. Tools and connectors are the actively handled registrations; all other OpenClaw-specific calls (`registerHook`, `registerChannel`, etc.) are silently accepted for compatibility.

```ts
// my-plugin/index.ts
import type { PluginApi } from "clawtools";

export function register(api: PluginApi) {
  // Register a tool
  api.registerTool({
    name: "my_tool",
    description: "Does something useful",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      required: ["input"],
    },
    async execute(id, params) {
      return { content: [{ type: "text", text: `Got: ${params.input}` }] };
    },
  });

  // Register a connector
  api.registerConnector({
    id: "my-llm",
    label: "My LLM",
    provider: "my-provider",
    api: "openai-completions",
    envVars: ["MY_LLM_API_KEY"],
    async *stream(model, context, options) {
      yield { type: "text_delta", delta: "hello" };
      yield { type: "done", stopReason: "stop" };
    },
  });

  // These are no-ops in clawtools but won't throw,
  // so plugins written for OpenClaw load cleanly:
  api.registerHook("session_start", async (event, ctx) => { /* ... */ });
}
```

The `openclaw.plugin.json` manifest:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Adds my_tool and my-llm connector",
  "version": "1.0.0"
}
```

---

## Parameter Helpers

When writing `execute` functions, use the parameter helpers to safely extract and coerce inputs:

```ts
import {
  readStringParam,
  readNumberParam,
  readBooleanParam,
  readStringArrayParam,
  assertRequiredParams,
  ToolInputError,
} from "clawtools/tools";

async function execute(id: string, params: Record<string, unknown>) {
  // Required string — throws ToolInputError if missing
  const path = readStringParam(params, "path", { required: true });

  // Optional number with integer coercion
  const limit = readNumberParam(params, "limit", { integer: true }) ?? 100;

  // Boolean with default
  const verbose = readBooleanParam(params, "verbose", false);

  // String array
  const tags = readStringArrayParam(params, "tags");

  // Both camelCase and snake_case are accepted:
  // readStringParam(params, "workDir") matches "workDir" or "work_dir"
}
```

---

## Sub-module Imports

Import only what you need to keep bundles lean:

```ts
// Full library (re-exports everything)
import { createClawtools, ToolRegistry, resolveAuth } from "clawtools";

// Tool system only
import { ToolRegistry, discoverCoreTools, jsonResult } from "clawtools/tools";

// Connector system only
import { ConnectorRegistry, resolveAuth, discoverExtensions } from "clawtools/connectors";

// Plugin loader only
import { loadPlugins } from "clawtools/plugins";
```
