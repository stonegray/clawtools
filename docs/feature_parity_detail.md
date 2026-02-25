# Feature Parity Detail: Gap Analysis

> Last updated: 2025-07-17

This document provides detailed information on each feature gap between clawtools and native OpenClaw, intended to guide future expansion work.

---

## 1. Authentication & Credential Management

### 1.1 Auth Profile Rotation

**OpenClaw:** Full multi-profile credential store (`AuthProfileStore`) with per-profile cooldown tracking, round-robin rotation, per-agent ordering overrides, failure-reason classification (`auth_error`, `rate_limit`, `context_overflow`, `network`, `timeout`, `unknown`), and automatic disable-after-threshold logic.

```
maxRetries = 2 × baseIterations × profileCount
```

**clawtools:** Flat `resolveAuth()` function that checks:
1. Explicit API key argument
2. Environment variables from connector's `envVars` list
3. Convention: `<PROVIDER_UPPER>_API_KEY`

Returns the first match with no rotation, cooldown, or failure tracking.

**Gap:** No `ProfileUsageStats`, no `cooldownUntil`, no `disabledUntil`, no `failureCounts`, no per-agent `order` map, no `lastGood` tracking.

**Expansion path:** Add an `AuthProfileManager` class to `src/connectors/` that wraps multiple credentials per provider and implements round-robin with cooldown. This is pure logic with no OpenClaw runtime dependency.

---

### 1.2 OAuth Credential Flows

**OpenClaw:** `ProviderAuthMethod` supports 5 auth kinds:

| Kind | Flow | Extensions using it |
|------|------|-------------------|
| `api_key` | Direct key entry | Built-in providers |
| `token` | Static bearer token | — |
| `oauth` | Full PKCE OAuth with localhost callback | google-gemini-cli-auth |
| `device_code` | Device code flow (poll for approval) | qwen-portal-auth, minimax-portal-auth |
| `custom` | Arbitrary wizard flow | copilot-proxy |

Each flow uses `ProviderAuthContext` which provides:
- `prompter: WizardPrompter` — interactive terminal prompts
- `openUrl: (url: string) => Promise<void>` — open browser
- `oauth.createVpsAwareHandlers` — localhost callback server with VPS/SSH tunnel awareness
- `config`, `runtime`, `isRemote` — environment context

**clawtools:** No auth flow system. `AuthMode` type exists (`"api-key" | "oauth" | "token" | "mixed" | "aws-sdk" | "unknown"`) but is metadata-only.

**Gap:** No `ProviderPlugin`, no `ProviderAuthMethod`, no `WizardPrompter`, no `ProviderAuthContext`, no `createVpsAwareOAuthHandlers`.

**Expansion path:** For a headless library, the simplest approach is a callback-based `AuthFlowProvider` interface:

```typescript
interface AuthFlowProvider {
  promptApiKey(provider: string): Promise<string>;
  openUrl(url: string): Promise<void>;
  pollDeviceCode(verification_uri: string, user_code: string): Promise<string>;
  handleOAuthCallback(port: number): Promise<{ code: string; state: string }>;
}
```

This would let consumers supply their own UI (CLI prompts, web forms, Electron dialogs, etc.) without depending on OpenClaw's terminal-specific `WizardPrompter`.

---

### 1.3 OAuth Token Refresh

**OpenClaw:** `ProviderPlugin.refreshOAuth?: (cred: OAuthCredential) => Promise<OAuthCredential>` — per-provider refresh logic for expired OAuth tokens. The `OAuthCredential` type extends `@mariozechner/pi-ai`'s `OAuthCredentials` with `type: "oauth"`, `provider`, `clientId`, `email`.

**clawtools:** No credential types beyond `ResolvedAuth.apiKey`.

**Gap:** No `OAuthCredential`, no refresh lifecycle.

**Expansion path:** Define `OAuthCredential` and `TokenCredential` types in `src/types.ts`. Add optional `refreshCredential()` to `Connector` interface.

---

## 2. Copilot Proxy Extension

**OpenClaw extension:** `copilot-proxy` — a `custom` auth provider that:
1. Prompts user for a Copilot LLM proxy base URL
2. Accepts optional model list (comma-separated)
3. Auto-discovers models from `/v1/models` endpoint
4. Sets a placeholder API key (`"copilot-proxy"`)
5. Registers as provider `"copilot-proxy"` with `openai-completions` API

**clawtools:** The `copilot-proxy` extension is discovered (appears in the 36 extensions list) but cannot be loaded because `registerProvider` is a no-op. Its tools and connectors would need to be accessed natively.

**Gap:** Cannot execute the custom auth flow or register the provider's model catalog.

**Expansion path:** If `registerProvider` becomes active, the copilot-proxy plugin could be loaded. The auth flow would need the `AuthFlowProvider` interface from §1.2.

---

## 3. Model Compatibility Flags

**OpenClaw:** `ModelCompatConfig` with 13 provider-specific behavior flags:

| Flag | Purpose |
|------|---------|
| `supportsStore` | OpenAI store/project fields |
| `supportsDeveloperRole` | Developer role in messages |
| `supportsReasoningEffort` | Reasoning level control |
| `supportsUsageInStreaming` | Usage stats in stream chunks |
| `supportsStrictMode` | JSON schema strict mode |
| `maxTokensField` | `"max_completion_tokens"` vs `"max_tokens"` |
| `thinkingFormat` | `"openai"` / `"zai"` / `"qwen"` |
| `requiresToolResultName` | Tool result needs `name` field |
| `requiresAssistantAfterToolResult` | Insert assistant message after tool result |
| `requiresThinkingAsText` | Emit thinking as text content |
| `requiresMistralToolIds` | Mistral-specific tool call IDs |
| `noSystemPromptGuard` | Skip system prompt injection |
| `noToolCallIdGuard` | Skip tool call ID enforcement |

**clawtools:** `ModelDescriptor.compat` is typed as `Record<string, unknown>` — the data is passthrough but not typed.

**Gap:** No `ModelCompatConfig` type, no runtime behavior adjustment based on flags.

**Expansion path:** Define `ModelCompatConfig` interface in `src/types.ts`. Consumers can use it for their own stream implementations.

---

## 4. Model Catalog Pipeline

**OpenClaw resolution chain:**
1. `models.json` config → `mode: "merge" | "replace"`
2. Plugin-registered providers (`registerProvider`) inject models
3. Bedrock auto-discovery adds AWS models
4. `before_model_resolve` hook can override per-run
5. Gateway `resolveModel` materializes final `Model` object

**clawtools:** Static `ModelDescriptor[]` on `Connector.models`. No pipeline.

**Gap:** No merge/replace logic, no dynamic discovery, no hook-based override.

**Expansion path:** This is largely a configuration concern. A `ModelResolver` class could chain multiple model sources (static config, connector models, discovered models) into a unified catalog.

---

## 5. Hook System

**OpenClaw:** 26 named lifecycle hooks across 7 categories:

| Category | Hooks | Can modify? |
|----------|-------|-------------|
| **Agent** | `before_model_resolve`, `before_prompt_build`, `before_agent_start`, `llm_input`, `llm_output`, `agent_end` | ✅ First 3 return results |
| **Session** | `before_compaction`, `after_compaction`, `before_reset`, `session_start`, `session_end` | Observe only |
| **Message** | `message_received`, `message_sending`, `message_sent` | ✅ `message_sending` can cancel |
| **Tool** | `before_tool_call`, `after_tool_call`, `tool_result_persist`, `before_message_write` | ✅ Can block/mutate |
| **Subagent** | `subagent_spawning`, `subagent_delivery_target`, `subagent_spawned`, `subagent_ended` | ✅ First 2 return results |
| **Gateway** | `gateway_start`, `gateway_stop` | Observe only |

Each hook has typed event and (optional) result types, priority ordering, and plugin source tracking.

**clawtools:** `registerHook` and `on` are no-op. No hook dispatch.

**Gap:** Full hook system.

**Expansion path:** Most hooks are tightly coupled to OpenClaw's runtime (sessions, agent loop, gateway). For clawtools, a subset of tool-related hooks would be independently useful:
- `before_tool_call` — pre-invocation filtering/mutation
- `after_tool_call` — post-invocation logging/telemetry
- `tool_result_persist` — result transformation

These could be implemented as a lightweight `HookRegistry` with typed handlers.

---

## 6. Channel Plugin System

**OpenClaw:** Full adapter-based channel contract. `ChannelPlugin` implements up to 20 named adapter interfaces:

| Adapter | Purpose |
|---------|---------|
| `config` | Account resolution |
| `configSchema` | Config validation |
| `setup` | Initial setup flow |
| `pairing` | Account pairing |
| `security` | Authorization |
| `groups` | Group/channel management |
| `mentions` | @-mention handling |
| `outbound` | Message sending |
| `status` | Health/probe |
| `gateway` | Gateway integration |
| `auth` | Channel-level auth |
| `elevated` | Privilege escalation |
| `commands` | Channel commands |
| `streaming` | Stream editing |
| `threading` | Thread management |
| `messaging` | Core message processing |
| `agentPrompt` | System prompt injection |
| `directory` | Contact/channel directory |
| `resolver` | Entity resolution |
| `actions` | Message actions |
| `heartbeat` | Health monitoring |
| `agentTools` | Channel-specific tools |

Supported channels: Telegram, Discord, Slack, Signal, iMessage, WhatsApp, LINE, Web, email, etc.

**clawtools:** No channel abstraction. `Connector` is for LLM streaming only.

**Gap:** Entire channel system. This is the largest single gap.

**Expansion path:** Channels are deeply integrated with OpenClaw's messaging runtime (message queuing, debouncing, routing, dock lifecycle). Exposing them would require either:
1. A minimal message-routing runtime within clawtools, or
2. A thin adapter that delegates to OpenClaw's channel dock

Option 2 is more realistic but breaks the "platform-agnostic" design goal.

---

## 7. Sandbox & Security

### 7.1 Docker Sandbox

**OpenClaw:** Full container isolation via `DockerSandboxConfig`:
- Custom image, read-only rootfs, network mode
- Seccomp/AppArmor profiles
- PID/memory/CPU limits
- Bind mounts with reserved-path guards
- DNS configuration
- Three `dangerously*` escape hatches

**clawtools:** No sandbox concept. Tools execute in the host process.

**Gap:** No container isolation, no resource limits, no filesystem guards.

**Expansion path:** Sandbox config types could be defined for consumers who implement their own isolation. The actual container orchestration is out of scope for an adapter library.

### 7.2 Exec Approval

**OpenClaw:** Multi-mode tool execution policy:
- `mode: "auto" | "approve-once" | "approve-always" | "deny"`
- JSONL socket protocol for real-time approval requests
- Pattern-based command allowlists
- Safe-bin policy (stdin-only binaries with denied-flag validation)
- Interactive approval prompting

**clawtools:** No execution policy. All tools run unconditionally.

**Gap:** No approval flow, no command allowlists, no safe-bin policy.

**Expansion path:** A `ToolPolicy` interface could be added to `ToolRegistry` to gate execution:

```typescript
interface ToolPolicy {
  shouldExecute(toolName: string, params: Record<string, unknown>): Promise<"allow" | "deny" | "prompt">;
}
```

### 7.3 Image Sanitization

**OpenClaw:** Automatic image processing before LLM submission:
- Max dimension: 1200px (resize)
- Max size: 5MB (reject)
- Format conversion where needed

**clawtools:** Images pass through as-is in `ImageContent` blocks.

**Gap:** No automatic sanitization.

**Expansion path:** A `sanitizeImage()` utility in `src/tools/helpers.ts` could handle resize/format with optional sharp or canvas dependencies.

---

## 8. Service & CLI Registration

### 8.1 Background Services

**OpenClaw:** `OpenClawPluginService` with `start(ctx)`/`stop(ctx)` lifecycle. Services get a `stateDir` for persistence and a `PluginLogger`.

**clawtools:** No-op. `registerService()` is accepted but discarded.

**Gap:** No service host.

**Expansion path:** A minimal `ServiceManager` that calls `start()`/`stop()` with a provided state directory would be straightforward. The main design question is who owns the process lifecycle.

### 8.2 CLI Extension

**OpenClaw:** Plugins register Commander.js subcommands via `registerCli(registrar)`. The registrar receives the Commander program instance and can add arbitrary subcommands.

**clawtools:** No-op. clawtools is a library, not a CLI.

**Gap:** No Commander.js integration.

**Expansion path:** This is fundamentally out of scope for an adapter library. If a consumer wants CLI, they can build it on top of clawtools.

---

## 9. Plugin Runtime Helpers (`PluginRuntime`)

**OpenClaw:** `PluginRuntime` is a massive helper object injected into every plugin via `api.runtime`. It provides:

| Category | Methods |
|----------|---------|
| **Events** | `emit()`, `on()`, `off()` |
| **Media** | `detectMime()`, `imageResize()`, `toJpeg()`, `svgToPng()` |
| **TTS** | `ttsGenerate()`, `ttsPlayback()` |
| **Memory** | `memorySearch()`, `memoryGet()`, `memoryStore()` |
| **Channel helpers** | Per-channel send/monitor/probe/directory/pairing for Discord, Slack, Telegram, Signal, iMessage, WhatsApp, LINE |
| **Session** | `getSession()`, `listSessions()` |
| **Config** | `getConfig()`, `updateConfig()` |

**clawtools:** No `runtime` property on `PluginApi`.

**Gap:** Entire plugin runtime helper surface.

**Expansion path:** Selectively expose utility methods that don't depend on the OpenClaw runtime:
- `detectMime()` — pure function, can be reimplemented
- `imageResize()` / `toJpeg()` — require sharp/canvas dependency
- Event emitter — could use Node's `EventEmitter`

Channel helpers, session management, and config I/O are tightly coupled to OpenClaw.

---

## 10. `KnownApi` Transport Coverage

**OpenClaw's `ModelApi`:**
```
"openai-completions" | "openai-responses" | "anthropic-messages"
| "google-generative-ai" | "github-copilot" | "bedrock-converse-stream" | "ollama"
```

**clawtools `KnownApi`:**
```
"openai-completions" | "openai-responses" | "azure-openai-responses"
| "openai-codex-responses" | "anthropic-messages" | "bedrock-converse-stream"
| "google-generative-ai" | "google-gemini-cli" | "google-vertex"
```

| Transport | clawtools | OpenClaw |
|-----------|-----------|----------|
| `openai-completions` | ✅ | ✅ |
| `openai-responses` | ✅ | ✅ |
| `azure-openai-responses` | ✅ | ❓ |
| `openai-codex-responses` | ✅ | ❓ |
| `anthropic-messages` | ✅ | ✅ |
| `bedrock-converse-stream` | ✅ | ✅ |
| `google-generative-ai` | ✅ | ✅ |
| `google-gemini-cli` | ✅ | ❓ |
| `google-vertex` | ✅ | ❓ |
| `github-copilot` | ❌ | ✅ |
| `ollama` | ❌ | ✅ |

**Gap:** `github-copilot` and `ollama` transports not in `KnownApi`.

**Expansion path:** Add to the `KnownApi` union type. The `Api` type already accepts `string & {}` so unknown transports work at runtime.

---

## Priority Recommendation

For future expansion, ordered by impact and feasibility:

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Auth profile rotation | Low | High — enables production multi-key usage |
| 2 | `ModelCompatConfig` type | Low | Medium — typed compat flags for stream implementations |
| 3 | Tool execution policy | Low | Medium — safety gate for tool invocation |
| 4 | `KnownApi` additions | Trivial | Low — add `github-copilot`, `ollama` |
| 5 | Tool hooks (before/after) | Medium | Medium — pre/post invocation interception |
| 6 | Auth flow provider interface | Medium | High — enables OAuth/device-code in consumer apps |
| 7 | Image sanitization utility | Medium | Low — convenience for image tool results |
| 8 | Service lifecycle manager | Medium | Low — useful for plugin authors |
| 9 | Channel adapters | Very high | High — but conflicts with platform-agnostic goal |
