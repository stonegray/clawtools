# 04 — Connector System Specification

> Formal specification of LLM provider connectors.
> Extracted from: `@mariozechner/pi-ai`, `src/agents/models-config.ts`, `src/agents/cli-backends.ts`

---

## 1. Provider Interface: `ApiProvider<TApi>`

Source: `@mariozechner/pi-ai`

### 1.1 Core Interface

```typescript
interface ApiProvider<TApi extends Api, TOptions extends StreamOptions = StreamOptions> {
  api: TApi;                                          // Transport discriminator string
  stream: StreamFunction<TApi, TOptions>;             // Full streaming function
  streamSimple: StreamFunction<TApi, SimpleStreamOptions>; // Simplified streaming function
}
```

### 1.2 Registration

```typescript
function registerApiProvider<TApi, TOptions>(
  provider: ApiProvider<TApi, TOptions>,
  sourceId?: string,
): void;

function getApiProvider(api: Api): ApiProviderInternal | undefined;
```

Providers are registered in a global in-memory registry keyed by the `api` string.

### 1.3 Known API Transports

```typescript
type KnownApi =
  | "openai-completions"          // OpenAI Chat Completions API
  | "openai-responses"            // OpenAI Responses API
  | "azure-openai-responses"      // Azure OpenAI Responses
  | "openai-codex-responses"      // OpenAI Codex Responses
  | "anthropic-messages"          // Anthropic Messages API
  | "bedrock-converse-stream"     // AWS Bedrock Converse
  | "google-generative-ai"        // Google Generative AI
  | "google-gemini-cli"           // Google Gemini CLI
  | "google-vertex";              // Google Vertex AI

type Api = KnownApi | (string & {});  // Extensible with custom strings
```

---

## 2. Model Descriptor: `Model<TApi>`

```typescript
interface Model<TApi extends Api> {
  id: string;                      // Model identifier (e.g., "claude-opus-4-6")
  name: string;                    // Display name
  api: TApi;                       // API transport to use
  provider: Provider;              // Provider name (e.g., "anthropic")
  baseUrl: string;                 // API base URL
  reasoning: boolean;              // Supports reasoning/thinking
  input: ("text" | "image")[];     // Supported input modalities
  cost: {
    input: number;                 // Cost per million input tokens
    output: number;                // Cost per million output tokens
    cacheRead: number;             // Cost per million cache read tokens
    cacheWrite: number;            // Cost per million cache write tokens
  };
  contextWindow: number;           // Max context window in tokens
  maxTokens: number;               // Max output tokens
  headers?: Record<string, string>; // Custom headers
  compat?: OpenAICompletionsCompat | OpenAIResponsesCompat; // Provider quirks
}
```

---

## 3. Streaming Interface

### 3.1 Stream Options

```typescript
interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  transport?: "sse" | "websocket" | "auto";
  cacheRetention?: "none" | "short" | "long";
  sessionId?: string;
  onPayload?: (payload: unknown) => void;
  headers?: Record<string, string>;
  maxRetryDelayMs?: number;
  metadata?: Record<string, unknown>;
}

interface SimpleStreamOptions extends StreamOptions {
  reasoning?: ThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
}

type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
```

### 3.2 Stream Context

```typescript
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}
```

### 3.3 Stream Function Signature

```typescript
type StreamFunction<TApi extends Api, TOptions extends StreamOptions> = (
  model: Model<TApi>,
  context: Context,
  options: TOptions,
) => AsyncIterable<AssistantMessageEvent>;
```

### 3.4 Stream Events: `AssistantMessageEvent`

```typescript
type AssistantMessageEvent =
  // Lifecycle
  | { type: "start";          partial: AssistantMessage }
  | { type: "done";           reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error";          reason: "aborted" | "error"; error: AssistantMessage }

  // Text content
  | { type: "text_start";     contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta";     contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end";       contentIndex: number; content: string; partial: AssistantMessage }

  // Thinking/reasoning content
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end";   contentIndex: number; content: string; partial: AssistantMessage }

  // Tool call content
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end";   contentIndex: number; toolCall: ToolCall; partial: AssistantMessage };
```

---

## 4. OpenAI Compatibility Layer

### 4.1 Compat Flags

```typescript
interface OpenAICompletionsCompat {
  supportsStore?: boolean;                    // Supports store parameter
  supportsDeveloperRole?: boolean;            // Supports developer role
  supportsReasoningEffort?: boolean;          // Supports reasoning_effort
  supportsUsageInStreaming?: boolean;          // Usage in stream chunks
  maxTokensField?: "max_completion_tokens" | "max_tokens";  // Which field to use
  requiresToolResultName?: boolean;           // Tool results need name field
  requiresAssistantAfterToolResult?: boolean; // Must have assistant after tool result
  requiresThinkingAsText?: boolean;           // Thinking content as text blocks
  requiresMistralToolIds?: boolean;           // Mistral-format tool IDs
  thinkingFormat?: "openai" | "zai" | "qwen"; // Thinking content format
  openRouterRouting?: { only?: string[]; order?: string[] };
  vercelGatewayRouting?: { only?: string[]; order?: string[] };
  supportsStrictMode?: boolean;               // Supports strict JSON Schema
}
```

### 4.2 Usage

These flags are set on the `Model.compat` field and inform the transport layer how to format requests and parse responses for OpenAI-compatible providers.

---

## 5. Authentication Model

### 5.1 Auth Resolution

```typescript
type ResolvedProviderAuth = {
  apiKey?: string;           // API key for this call
  profileId?: string;        // Auth profile ID
  source: string;            // Resolution source (e.g., "env:ANTHROPIC_API_KEY")
  mode: ModelAuthMode;       // Auth mechanism
};

type ModelAuthMode =
  | "api-key"     // Static API key
  | "oauth"       // OAuth token (may refresh)
  | "token"       // Static token
  | "mixed"       // Multiple auth types
  | "aws-sdk"     // AWS credential chain
  | "unknown";
```

### 5.2 Auth Resolution Chain

```
1. Auth Profile Store (~/.openclaw/agents/<agentId>/auth/)
   └── Multiple profiles per provider, priority-ordered
2. Environment Variables
   └── ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, etc.
3. Config-embedded credentials
   └── config.auth.providers.<provider>.apiKey
4. Dynamic key resolution (getApiKey callback)
   └── For short-lived OAuth tokens (GitHub Copilot)
5. AWS SDK credential chain
   └── For Bedrock: ~/.aws/credentials, IAM roles, etc.
```

### 5.3 Auth Profile Rotation

```
profiles: [profile_a, profile_b, profile_c]
     │
     ├── Try profile_a → 401 → mark failed, cooldown 60s
     ├── Try profile_b → 429 → mark rate-limited, cooldown 30s
     ├── Try profile_c → 200 → success, record last-used
     │
     └── Next request: try profile_c first (last successful)
```

- **Cooldown**: Failed profiles are temporarily disabled
- **Expiry**: Cooldowns auto-expire after configured duration
- **Max retries**: Scale with profile count (2× base × profile count)

### 5.4 Provider Auth Plugin Registration

```typescript
type ProviderPlugin = {
  id: string;                    // Provider identifier
  label: string;                 // Display name
  docsPath?: string;             // Documentation path
  aliases?: string[];            // Alternative names
  envVars?: string[];            // Environment variable names
  models?: ModelProviderConfig;  // Model catalog
  auth: ProviderAuthMethod[];    // Auth methods
  formatApiKey?: (cred: AuthProfileCredential) => string;
  refreshOAuth?: (cred: OAuthCredential) => Promise<OAuthCredential>;
};

type ProviderAuthMethod = {
  id: string;                    // Auth method ID
  label: string;                 // Display name
  hint?: string;                 // User hint
  kind: ProviderAuthKind;        // "oauth" | "api_key" | "token" | "device_code" | "custom"
  run: (ctx: ProviderAuthContext) => Promise<ProviderAuthResult>;
};
```

---

## 6. Model Selection Flow

### 6.1 Defaults

```typescript
const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_CONTEXT_TOKENS = 200_000;
```

### 6.2 Resolution Chain

```
1. User config → config.models.default: "provider/model-id"
2. Plugin hook → before_model_resolve → { modelOverride, providerOverride }
3. Legacy hook → before_agent_start → model/provider override
4. Session override → sessionEntry.modelOverride
5. CLI flag → --model "provider/model-id"
6. Default → anthropic/claude-opus-4-6
```

### 6.3 Model Discovery Pipeline

```
resolveModel(provider, modelId)
    │
    ├── Catalog lookup (models.json)
    │     └── Provider-specific model catalog
    ├── Inline models (config.models.providers.<provider>.models)
    ├── Forward-compat fallback (new model ID, known provider)
    ├── OpenRouter passthrough (any model ID)
    └── Generic provider fallback (baseUrl + default api)
```

### 6.4 Provider ID Normalization

| Input           | Normalized        |
|-----------------|-------------------|
| `z.ai`          | `zai`             |
| `bytedance`     | `volcengine`      |
| `qwen`          | `qwen-portal`     |
| `deepseek-v3`   | `deepseek`        |
| `ollama-local`  | `ollama`          |
| `github`        | `github-copilot`  |

---

## 7. Models Configuration File

### 7.1 Generated File

Location: `~/.openclaw/agents/<agentId>/models.json`

Auto-generated by `writeModelsConfig()` from auth profiles and config.

### 7.2 Format

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://api.anthropic.com",
      "api": "anthropic-messages",
      "models": [
        {
          "id": "claude-opus-4-6",
          "name": "Claude Opus 4.6",
          "reasoning": true,
          "input": ["text", "image"],
          "cost": {
            "input": 15,
            "output": 75,
            "cacheRead": 1.5,
            "cacheWrite": 18.75
          },
          "contextWindow": 200000,
          "maxTokens": 32768
        }
      ]
    },
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "api": "openai-completions",
      "models": [...]
    }
  }
}
```

### 7.3 Provider Config Type

```typescript
type ProviderConfig = {
  baseUrl?: string;
  api?: string;        // e.g., "openai-completions", "anthropic-messages"
  models?: ModelDefinitionConfig[];
};

type ModelDefinitionConfig = {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: OpenAICompletionsCompat;
};
```

---

## 8. CLI Backend Architecture

For CLI-based LLM backends (e.g., Claude CLI, Codex CLI):

```typescript
type CliBackendConfig = {
  command: string;                  // Binary name (e.g., "claude", "codex")
  args: string[];                   // Fresh invocation args
  resumeArgs: string[];             // Resume session args ({sessionId} placeholder)
  output: "json" | "jsonl";        // Output format
  resumeOutput?: "json" | "jsonl" | "text";
  input: "arg";                     // Input delivery mode
  modelArg?: string;                // Model selection flag (e.g., "--model")
  modelAliases?: Record<string, string>;
  sessionArg?: string;              // Session continuation flag
  sessionMode?: "always" | "existing";
  sessionIdFields?: string[];       // JSON fields for session ID extraction
  systemPromptArg?: string;         // System prompt flag
  systemPromptMode?: "append";      // How to combine system prompts
  systemPromptWhen?: "first";       // When to include system prompt
  imageArg?: string;                // Image input flag
  imageMode?: "repeat";             // How to handle multiple images
  clearEnv?: string[];              // Env vars to clear
  env?: Record<string, string>;     // Env vars to set
  reliability?: {
    watchdog: {
      fresh: { startTimeoutMs: number; idleTimeoutMs: number };
      resume: { startTimeoutMs: number; idleTimeoutMs: number };
    };
  };
  serialize?: boolean;              // Serialize concurrent requests
};
```

---

## 9. Retry & Rate Limit Handling

### 9.1 Retry Categories

| Error Type           | Action                        |
|----------------------|-------------------------------|
| Auth error (401)     | Rotate to next auth profile   |
| Rate limit (429)     | Cooldown current profile, retry |
| Context overflow     | Compact session, retry        |
| Thinking unsupported | Downgrade thinking level, retry |
| Network error        | Exponential backoff, retry    |
| Timeout              | Return error                  |

### 9.2 Max Retry Iterations

```
maxRetries = 2 × baseIterations × profileCount
```

Where `baseIterations` varies by error type:
- Auth errors: 1 per profile
- Rate limits: 2 per profile
- Context overflow: 3 (with compaction between)

---

## 10. Capability Negotiation

### 10.1 Model Capabilities

Capabilities are encoded in the `Model` type:

```typescript
{
  reasoning: true,           // Supports thinking/reasoning content
  input: ["text", "image"],  // Input modalities
  contextWindow: 200000,     // Context size
  maxTokens: 32768,          // Max output
}
```

### 10.2 Provider Quirks

Provider-specific behaviors are encoded in `compat` flags:

```typescript
// Example: Mistral provider
compat: {
  requiresMistralToolIds: true,
  requiresAssistantAfterToolResult: true,
  maxTokensField: "max_tokens",
}
```

### 10.3 Runtime Capability Detection

The embedded runner adjusts behavior based on:

1. **Model reasoning support** → Include/exclude thinking budget
2. **Provider compat flags** → Adjust request format
3. **Context window size** → Scale tool output budgets
4. **Vision support** → Include/exclude image tools

---

## 11. Example: Custom Connector Implementation

```typescript
import { registerApiProvider } from "@mariozechner/pi-ai";

registerApiProvider({
  api: "my-custom-api",
  stream: async function* (model, context, options) {
    const response = await fetch(model.baseUrl + "/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        messages: context.messages,
        tools: context.tools,
        stream: true,
      }),
      signal: options.signal,
    });

    // Parse SSE stream and yield AssistantMessageEvent objects
    for await (const chunk of parseSSE(response.body)) {
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: chunk.text,
        partial: buildPartialMessage(chunk),
      };
    }

    yield {
      type: "done",
      reason: "stop",
      message: buildFinalMessage(),
    };
  },
  streamSimple: async function* (model, context, options) {
    // Simplified version that handles reasoning level
    yield* this.stream(model, context, options);
  },
});
```
