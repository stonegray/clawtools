# 11 — Compatibility Checklist

> Requirements checklist for a complete OpenClaw-compatible reimplementation.

---

## 1. Tool System Compatibility

### 1.1 Tool Interface

- [ ] Tool definition uses `AgentTool<TParams, TDetails>` shape
- [ ] `name: string` — unique tool identifier
- [ ] `description: string` — natural-language description for LLM
- [ ] `parameters: TObject` — `@sinclair/typebox` schema
- [ ] `execute(id, args, signal?) → Promise<ToolResult<TDetails>>` signature
- [ ] `ToolResult.content` is `Array<TextContent | ImageContent>`
- [ ] `ToolResult.details` is generic typed payload (opaque to LLM)
- [ ] Error results use `isError: true` on `ToolResultMessage`

### 1.2 Schema Generation

- [ ] Typebox `Type.Object(...)` compiles to JSON Schema draft-07
- [ ] No `Type.Union` in tool input schemas
- [ ] String enums use `Type.Unsafe<...>({ enum: [...] })`
- [ ] `Type.Optional(...)` instead of `... | null`
- [ ] No `anyOf`/`oneOf`/`allOf` in top-level schema
- [ ] No raw `format` property name in schemas
- [ ] Gemini: strip `default`, `$schema`, `examples` from schema
- [ ] Google: strip reserved keywords from property names

### 1.3 Tool Catalog

- [ ] Support profile-based tool selection (`minimal`, `coding`, `messaging`, `full`)
- [ ] Support `group:<name>` tool references
- [ ] Support individual tool `allow` / `deny` lists
- [ ] Support `ownerOnly` flag on tools (authorization gate)

### 1.4 Tool Execution

- [ ] Parameter access uses both `camelCase` and `snake_case` fallback
- [ ] JSON string parameters are auto-parsed to objects
- [ ] Number strings are auto-coerced to numbers
- [ ] Boolean strings ("true"/"false") are auto-coerced
- [ ] `AbortSignal` is propagated to tool execution
- [ ] Tool timeout enforcement (configurable)

---

## 2. Message Format Compatibility

### 2.1 Message Types

- [ ] `UserMessage` with `role: "user"`, string or content blocks
- [ ] `AssistantMessage` with `role: "assistant"`, content blocks, usage, stopReason
- [ ] `ToolResultMessage` with `role: "toolResult"`, toolCallId, content, isError

### 2.2 Content Block Types

- [ ] `TextContent` — `{ type: "text", text: string }`
- [ ] `ThinkingContent` — `{ type: "thinking", thinking: string }`
- [ ] `ImageContent` — `{ type: "image", data: string, mimeType: string }`
- [ ] `ToolCall` — `{ type: "toolCall", id, name, arguments }`

### 2.3 Usage Tracking

- [ ] `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`
- [ ] `cost.input`, `cost.output`, `cost.cacheRead`, `cost.cacheWrite`, `cost.total`
- [ ] Multi-turn aggregation: sum tokens; sum costs

### 2.4 Stop Reasons

- [ ] `"stop"` — normal completion
- [ ] `"toolUse"` — tool call requested
- [ ] `"length"` — max tokens reached
- [ ] `"error"` — provider error
- [ ] `"aborted"` — user cancellation

---

## 3. Streaming Compatibility

### 3.1 Stream Events

- [ ] `start` event with partial assistant message
- [ ] `text_delta` events for incremental text
- [ ] `thinking_delta` events for incremental thinking
- [ ] `toolcall_start/delta/end` events for tool call streaming
- [ ] `done` event with final assistant message
- [ ] `error` event for stream errors

### 3.2 Tool Call Streaming

- [ ] Tool call arguments accumulate via `toolcall_delta` events
- [ ] `toolcall_end` contains fully parsed `ToolCall` object
- [ ] Multiple tool calls in single response supported

---

## 4. Provider Compatibility

### 4.1 Provider Interface

- [ ] `ApiProvider<TApi>` with `streamSimple` method
- [ ] `Model<TApi>` descriptor with `id`, `api`, `provider`, `contextWindow`, `maxTokens`
- [ ] `StreamOptions` with `systemPrompt`, `messages`, `tools`, model settings
- [ ] Streaming yields `AssistantMessageEvent` union type

### 4.2 Authentication

- [ ] API key from env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
- [ ] API key from auth profile store
- [ ] API key from config file
- [ ] Auth profile rotation on failure
- [ ] Cooldown tracking per profile

### 4.3 Provider-Specific

- [ ] Anthropic: native messages API, thinking blocks, text/thinking signatures
- [ ] OpenAI: chat completions API, function calling format
- [ ] Google: Generative AI API, schema keyword stripping
- [ ] Ollama: local model support
- [ ] OpenAI-compatible: generic compat layer with compat flags

---

## 5. Plugin Compatibility

### 5.1 Manifest

- [ ] `openclaw.plugin.json` manifest file
- [ ] Required field: `id`
- [ ] Optional: `name`, `description`, `version`, `main`, `configSchema`
- [ ] Entry point resolution: `main` → `index.ts` → `index.js`

### 5.2 Plugin API

- [ ] `registerTool(tool | factory, opts?)` — register agent tools
- [ ] `registerHook(event, handler, opts?)` — register lifecycle hooks
- [ ] `registerChannel(registration)` — register messaging channels
- [ ] `registerProvider(provider)` — register LLM providers
- [ ] `registerService(service)` — register background services
- [ ] `registerCommand(command)` — register slash commands
- [ ] `registerHttpHandler(handler)` — register HTTP handlers
- [ ] `registerHttpRoute({ path, handler })` — register path-based HTTP routes
- [ ] `registerGatewayMethod(method, handler)` — register gateway RPC methods
- [ ] `registerCli(registrar)` — register CLI commands

### 5.3 Plugin Loading

- [ ] Discovery: config → workspace → global → bundled
- [ ] Higher-priority origin wins on ID collision
- [ ] jiti for TypeScript loading (no compilation step)
- [ ] `openclaw/plugin-sdk` alias resolution
- [ ] Config validation via JSON Schema / Zod / custom `safeParse`
- [ ] Security: path escape detection, symlink validation
- [ ] Memory slot resolution (only one `kind: "memory"` plugin)
- [ ] Enable state resolution (global → allow list → per-plugin → default)

### 5.4 Hooks

- [ ] 25 hook names (see spec 06)
- [ ] Priority-based ordering (higher = first)
- [ ] Parallel, sequential, and synchronous dispatch modes
- [ ] Modifying hooks return override values
- [ ] Observability hooks return void
- [ ] `before_tool_call` can block tool execution

---

## 6. State Persistence Compatibility

### 6.1 Session Store

- [ ] JSON file at `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- [ ] Session key → `SessionEntry` mapping
- [ ] Atomic writes (temp → rename)
- [ ] TTL-based caching (45s default)
- [ ] File mtime invalidation

### 6.2 Transcripts

- [ ] JSONL format at `~/.openclaw/agents/<agentId>/sessions/<id>.jsonl`
- [ ] One `AgentMessage` per line
- [ ] Chronological append
- [ ] Compaction support (summary + recent window)

### 6.3 Configuration

- [ ] JSON5 format at `~/.openclaw/openclaw.json`
- [ ] `${ENV_VAR}` substitution
- [ ] `$include` directive
- [ ] Merge-patch overlays
- [ ] Zod validation

---

## 7. Runtime Compatibility

### 7.1 Agent Loop

- [ ] Turn-based loop: LLM call → tool execution → repeat
- [ ] Auto-loop on `stopReason: "toolUse"`
- [ ] Stop on `"stop"`, `"length"`, `"error"`, `"aborted"`
- [ ] Max turns limit (configurable, default 20)
- [ ] Steering message injection during tool execution
- [ ] Follow-up message continuation

### 7.2 Error Recovery

- [ ] Context overflow → compaction → retry
- [ ] Auth failure → profile rotation → retry
- [ ] Rate limit → cooldown → retry
- [ ] Thinking unsupported → downgrade → retry
- [ ] Abort signal → immediate termination

### 7.3 Session Serialization

- [ ] Per-session queue (one active run per session key)
- [ ] Optional global queue
- [ ] Queue ordering preserves message arrival order

---

## 8. Testing Validation

### 8.1 Minimum Test Coverage

- [ ] Tool schema generation matches JSON Schema draft-07
- [ ] Tool execution returns valid `ToolResult`
- [ ] Error results set `isError: true`
- [ ] Agent loop terminates on `"stop"` reason
- [ ] Agent loop continues on `"toolUse"` reason
- [ ] Plugin manifest loading succeeds
- [ ] Plugin registration populates registry
- [ ] Session store round-trip (write → read)
- [ ] JSONL transcript round-trip (append → read)
- [ ] Stream events reconstruct complete assistant message
