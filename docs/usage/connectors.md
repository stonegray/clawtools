# Connector System

Connectors are adapters for LLM provider streaming APIs. Each connector wraps a specific API transport (Anthropic Messages, OpenAI Responses, Google Generative AI, etc.) and exposes a uniform `stream()` method.

## Import paths

```ts
import { ConnectorRegistry, resolveAuth, discoverBuiltinConnectors } from "clawtools";
import { ConnectorRegistry, resolveAuth } from "clawtools/connectors";
```

---

## `ConnectorRegistry`

### Registration

#### `registry.register(connector)`

Register a connector. The registry indexes it by `connector.id`, `connector.provider`, and `connector.api`.

```ts
registry.register({
  id: "my-provider",
  label: "My Provider",
  provider: "my-provider",
  api: "openai-completions",
  envVars: ["MY_PROVIDER_API_KEY"],
  models: [
    {
      id: "my-model-v1",
      name: "My Model v1",
      api: "openai-completions",
      provider: "my-provider",
    },
  ],
  async *stream(model, context, options) {
    yield { type: "start" };
    yield { type: "text_delta", delta: "Hello!" };
    yield { type: "text_end", content: "Hello!" };
    yield { type: "done", stopReason: "stop" };
  },
});
```

#### `registry.unregister(id)` → `boolean`

Remove a connector by ID. Returns `true` if it existed.

#### `registry.clear()`

Remove all connectors.

---

### Lookup

#### `registry.get(id)` → `Connector | undefined`

Get a connector by its unique ID.

#### `registry.getByProvider(provider)` → `Connector | undefined`

Get a connector by provider name (e.g., `"anthropic"`, `"openai"`). Returns the most-recently registered connector for that provider.

```ts
const connector = registry.getByProvider("anthropic");
```

#### `registry.getByApi(api)` → `Connector[]`

Get all connectors for a given API transport string (e.g., `"anthropic-messages"`).

#### `registry.list()` → `Connector[]`

List all registered connectors.

#### `registry.listProviders()` → `string[]`

List all registered provider names.

#### `registry.has(id)` → `boolean`

Check whether a connector is registered.

#### `registry.size` → `number`

---

## Built-in connectors

Built-in connectors are backed by `@mariozechner/pi-ai` and cover every provider in that catalog. Load them via `createClawtools()` (done automatically unless `skipBuiltinConnectors: true`) or manually:

```ts
import { discoverBuiltinConnectors, ConnectorRegistry } from "clawtools";

const registry = new ConnectorRegistry();
const builtins = await discoverBuiltinConnectors();
for (const connector of builtins) registry.register(connector);

console.log(registry.listProviders());
// e.g. ["anthropic", "openai", "google", "amazon-bedrock", ...]
```

Built-in connector IDs follow the pattern `builtin/<provider>` (e.g., `builtin/anthropic`).

Each built-in connector's `models` array contains fully populated `ModelDescriptor` objects with cost, context window, and capability data from pi-ai's catalog.

---

## Streaming

### `connector.stream(model, context, options)` → `AsyncIterable<StreamEvent>`

Stream a response from the LLM. Yields `StreamEvent` objects as they arrive.

```ts
const connector = ct.connectors.getByProvider("anthropic");
const model = connector.models!.find(m => m.id === "claude-opus-4-6")!;

for await (const event of connector.stream(model, {
  systemPrompt: "You are a helpful assistant.",
  messages: [
    { role: "user", content: "What is 2 + 2?" },
  ],
  tools: extractToolSchemas(resolvedTools),
}, {
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 1024,
  temperature: 0.7,
})) {
  switch (event.type) {
    case "text_delta":    process.stdout.write(event.delta); break;
    case "toolcall_end":  handleToolCall(event.toolCall); break;
    case "done":          console.log("\nDone:", event.stopReason, event.usage); break;
    case "error":         throw new Error(event.error); break;
  }
}
```

### `StreamContext`

```ts
import type { UserMessage, AssistantMessage, ToolResultMessage } from "clawtools";

interface StreamContext {
  systemPrompt?: string;
  messages: Array<UserMessage | AssistantMessage | ToolResultMessage>; // typed conversation history
  tools?: Array<{ name: string; description: string; input_schema: unknown }>;
}
```

`ToolResultMessage` (with `role: "toolResult"`) is how you feed tool execution results back into the next turn. See [messages.md](./messages.md) for the full message format.

Tools in `StreamContext.tools` use `input_schema` (not `parameters`). Use `extractToolSchemas()` from `clawtools/tools` to produce this from `Tool[]` objects.

### `StreamOptions`

```ts
interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  headers?: Record<string, string>;
}
```

### `StreamEvent` union

| `type` | Additional fields | Description |
|--------|-------------------|-------------|
| `"start"` | — | LLM has started responding |
| `"text_delta"` | `delta: string` | Incremental text chunk |
| `"text_end"` | `content: string` | Full accumulated text block finished |
| `"thinking_delta"` | `delta: string` | Incremental reasoning/thinking chunk |
| `"thinking_end"` | `content: string` | Full thinking block finished |
| `"toolcall_start"` | — | LLM is beginning a tool call |
| `"toolcall_delta"` | `delta: string` | Incremental JSON argument chunk |
| `"toolcall_end"` | `toolCall: { id, name, arguments }` | Complete tool call with parsed args |
| `"done"` | `stopReason`, `usage?` | Stream complete |
| `"error"` | `error: string` | Provider-level error |

**`done.stopReason`** is one of: `"stop"` (natural end), `"toolUse"` (stopped to call a tool), `"length"` (max tokens reached), `"error"`.

**`done.usage`**: `{ inputTokens: number, outputTokens: number }` (when provided by the LLM).

**`toolcall_end.toolCall`**: `{ id: string, name: string, arguments: Record<string, unknown> }` — the `arguments` are already parsed from JSON.

---

## `resolveAuth(provider, envVars?, explicitKey?)` → `ResolvedAuth | undefined`

Resolve API key credentials for a provider. Priority order:
1. `explicitKey` (if provided)
2. Any environment variable listed in `envVars`
3. Conventional `<PROVIDER>_API_KEY` environment variable (e.g., `ANTHROPIC_API_KEY`)

```ts
import { resolveAuth } from "clawtools/connectors";

const auth = resolveAuth("anthropic");
if (auth) {
  console.log(auth.apiKey);   // the resolved key
  console.log(auth.source);   // e.g., "env:ANTHROPIC_API_KEY" or "explicit"
  console.log(auth.mode);     // "api-key"
}

// Custom env vars
const auth2 = resolveAuth("my-provider", ["MY_CUSTOM_KEY", "FALLBACK_KEY"]);

// Explicit key
const auth3 = resolveAuth("openai", undefined, "sk-my-hardcoded-key");
```

`ResolvedAuth`:
```ts
interface ResolvedAuth {
  apiKey?: string;
  profileId?: string;
  source?: string;    // where the key came from
  mode: AuthMode;     // "api-key" | "oauth" | "token" | "mixed" | "aws-sdk" | "unknown"
}
```

## Connector credentials

Each built-in connector auto-discovers credentials from well-known environment variables.
For connectors that do **not** have a mapped env var, you must pass the key explicitly via
`options.apiKey` (or `StreamOptions.apiKey`).

| Provider | Auto-discover env var(s) | Notes |
|----------|--------------------------|-------|
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` | OAuth token takes precedence |
| `openai` | `OPENAI_API_KEY` | |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY` | |
| `google` | `GEMINI_API_KEY` | |
| `google-vertex` | ADC credentials file (`gcloud auth application-default login`) + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` | No API key |
| `amazon-bedrock` | `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, ECS/IRSA credential env vars | No API key |
| `github-copilot` | `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` | |
| `groq` | `GROQ_API_KEY` | |
| `cerebras` | `CEREBRAS_API_KEY` | |
| `xai` | `XAI_API_KEY` | |
| `openrouter` | `OPENROUTER_API_KEY` | |
| `vercel-ai-gateway` | `AI_GATEWAY_API_KEY` | |
| `zai` | `ZAI_API_KEY` | |
| `mistral` | `MISTRAL_API_KEY` | |
| `minimax` | `MINIMAX_API_KEY` | |
| `minimax-cn` | `MINIMAX_CN_API_KEY` | |
| `huggingface` | `HF_TOKEN` | |
| `opencode` | `OPENCODE_API_KEY` | |
| `kimi-coding` | `KIMI_API_KEY` | |
| `google-antigravity`, `google-gemini-cli`, `openai-codex` | _(none)_ | Pass `apiKey` explicitly or use `resolveAuth()` |

For providers with no env var mapping, pass the key explicitly:

```ts
for await (const event of connector.stream(model, context, {
  apiKey: "sk-my-key",  // required for providers with no env var
})) {
  // ...
}
```

Or use `resolveAuth()` to centralise credential resolution:

```ts
import { resolveAuth } from "clawtools/connectors";

const auth = resolveAuth("groq");
// uses GROQ_API_KEY from env — returns undefined if not set

for await (const event of connector.stream(model, context, {
  apiKey: auth?.apiKey,
})) {
  // ...
}
```

---

## Writing a custom connector

```ts
import type { Connector } from "clawtools";

const myConnector: Connector = {
  id: "my-llm",
  label: "My LLM",
  provider: "my-llm",
  api: "openai-completions",  // or any KnownApi or custom string
  envVars: ["MY_LLM_API_KEY"],
  models: [
    {
      id: "my-model-v1",
      name: "My Model v1",
      api: "openai-completions",
      provider: "my-llm",
      contextWindow: 128_000,
      maxTokens: 4_096,
    },
  ],

  async *stream(model, context, options) {
    const apiKey = options.apiKey ?? process.env.MY_LLM_API_KEY;
    // ... call your API ...
    yield { type: "start" };
    // yield incremental events ...
    yield { type: "done", stopReason: "stop", usage: { inputTokens: 100, outputTokens: 50 } };
  },
};
```

---

## Extension discovery

Discover channel and provider extensions from the openclaw extensions directory:

```ts
import {
  discoverExtensions,
  getExtensionPath,
  listChannelExtensions,
  listProviderExtensions,
} from "clawtools/connectors";

// All extensions
const extensions = discoverExtensions();
// Override directory: discoverExtensions("/custom/path")

// Extensions with channels
const channelIds = listChannelExtensions();   // e.g., ["telegram", "discord"]

// Extensions with providers
const providerIds = listProviderExtensions(); // e.g., ["copilot"]

// Get path to a specific extension
const path = getExtensionPath("telegram");    // absolute path or undefined
```

See [getting-started.md](./getting-started.md) for the `ExtensionInfo` type.

### Known API transport strings (`KnownApi`)

```
"openai-completions"
"openai-responses"
"azure-openai-responses"
"openai-codex-responses"
"anthropic-messages"
"bedrock-converse-stream"
"google-generative-ai"
"google-gemini-cli"
"google-vertex"
```

Custom strings are also accepted (`Api = KnownApi | (string & {})`).
