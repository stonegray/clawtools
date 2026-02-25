# 00 — OpenClaw Architecture Overview

> Formal runtime specification extracted from source code.
> Date: 2026-02-24 | Source: `openclaw@2026.2.23-beta.1`

---

## 1. System Identity

OpenClaw is a **multi-channel AI gateway** with extensible messaging integrations. It provides:

- A CLI (`openclaw`) for agent management, onboarding, and messaging
- A gateway server that routes messages between channels and LLM agents
- A plugin system for extending channels, providers, tools, hooks, and services
- An embedded agent runtime that manages the LLM ↔ tool execution loop
- Session persistence for stateful multi-turn conversations

---

## 2. Technology Stack

| Component         | Technology                                      |
|-------------------|-------------------------------------------------|
| Language          | TypeScript (ESM, strict mode)                   |
| Runtime           | Node.js 22+ (Bun supported for dev)             |
| Package Manager   | pnpm (workspace monorepo)                       |
| Build             | tsdown → `dist/`                                |
| Test              | Vitest + V8 coverage                            |
| Lint/Format       | Oxlint + Oxfmt                                  |
| CLI Framework     | Commander + @clack/prompts                      |
| LLM Transport     | `@mariozechner/pi-ai`                           |
| Agent Loop        | `@mariozechner/pi-agent-core`                   |
| Tool Schemas      | `@sinclair/typebox` (compiles to JSON Schema)   |
| Plugin Loader     | `jiti` (TypeScript-aware ESM dynamic import)    |
| Config Format     | JSON5 (with env var substitution, includes)     |

---

## 3. Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     CLI / Gateway                       │
│  (Commander program, HTTP server, channel monitors)     │
├─────────────────────────────────────────────────────────┤
│                    Plugin Registry                      │
│  (Discovery, loading, activation, hook dispatch)        │
├──────────────┬──────────────┬───────────────────────────┤
│   Channels   │   Providers  │        Tools              │
│  (Telegram,  │  (Anthropic, │  (exec, read, write,      │
│   Discord,   │   OpenAI,    │   web_fetch, memory, ...)  │
│   Slack, …)  │   Google, …) │                           │
├──────────────┴──────────────┴───────────────────────────┤
│              Embedded Agent Runtime                     │
│  (Session mgmt, LLM loop, tool dispatch, streaming)    │
├─────────────────────────────────────────────────────────┤
│                  pi-agent-core                          │
│  (Turn-based agent loop, event emitter, tool executor)  │
├─────────────────────────────────────────────────────────┤
│                      pi-ai                              │
│  (LLM API providers, streaming, model registry)        │
├─────────────────────────────────────────────────────────┤
│              State & Persistence                        │
│  (Session store, JSONL transcripts, config, auth)       │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Core Module Map

### 4.1 Source Layout (`src/`)

| Directory          | Responsibility                                        |
|--------------------|-------------------------------------------------------|
| `src/cli/`         | CLI wiring, Commander program, dependency injection   |
| `src/commands/`    | CLI command implementations                           |
| `src/agents/`      | Agent runtime, tools, LLM loop, system prompt         |
| `src/plugins/`     | Plugin discovery, loading, registry, hooks             |
| `src/plugin-sdk/`  | Public API surface for plugin authors                 |
| `src/providers/`   | Provider-specific auth, model catalogs                |
| `src/config/`      | Config loading, validation, session store              |
| `src/channels/`    | Channel abstraction layer, plugin types                |
| `src/gateway/`     | HTTP gateway server, RPC methods                      |
| `src/routing/`     | Message routing, session key derivation                |
| `src/hooks/`       | Internal hook system                                  |
| `src/infra/`       | Utilities: ports, binaries, env, errors                |
| `src/media/`       | Media pipeline: MIME detection, image processing      |
| `src/security/`    | Path scanning, symlink escape detection                |

### 4.2 Extensions (`extensions/`)

Each extension is a workspace package containing a `ChannelPlugin` or `ProviderPlugin` implementation:

```
extensions/
  telegram/       # Telegram bot integration
  discord/        # Discord bot integration
  slack/          # Slack app integration
  signal/         # Signal messenger
  matrix/         # Matrix protocol
  msteams/        # Microsoft Teams
  whatsapp/       # WhatsApp Web
  bluebubbles/    # iMessage via BlueBubbles
  memory-lancedb/ # LanceDB memory backend
  copilot-proxy/  # GitHub Copilot proxy provider
  voice-call/     # Voice call channel
  ...             # 30+ extensions total
```

---

## 5. Key Subsystem Interactions

### 5.1 Message Flow (Channel → Agent → Channel)

```
Channel Monitor          Gateway           Embedded Runtime         LLM Provider
     │                     │                      │                      │
     │──inbound message──▶│                      │                      │
     │                     │──resolve route──▶    │                      │
     │                     │──enqueue run───▶     │                      │
     │                     │                      │──load session──▶     │
     │                     │                      │──build tools───▶     │
     │                     │                      │──build prompt──▶     │
     │                     │                      │──stream()──────────▶│
     │                     │                      │◀──text_delta────────│
     │                     │                      │◀──toolcall_end─────│
     │                     │                      │──execute tool──▶     │
     │                     │                      │──stream()──────────▶│
     │                     │                      │◀──done──────────────│
     │                     │                      │──save session──▶     │
     │                     │◀──reply payloads────│                      │
     │◀──send reply───────│                      │                      │
```

### 5.2 Tool Execution Cycle

```
Agent Loop (pi-agent-core)
     │
     ├── LLM returns stopReason="toolUse"
     │     └── AssistantMessage.content includes ToolCall[]
     │
     ├── For each ToolCall:
     │     ├── Emit "tool_execution_start"
     │     ├── Run before_tool_call hook (may block)
     │     ├── Call tool.execute(toolCallId, params, signal)
     │     ├── Run after_tool_call hook
     │     ├── Create ToolResultMessage
     │     ├── Emit "tool_execution_end"
     │     └── Append to session messages
     │
     └── Re-invoke LLM with updated messages
           └── Repeat until stopReason="stop" or "length"
```

### 5.3 Plugin Loading Sequence

```
loadOpenClawPlugins()
     │
     ├── normalizePluginsConfig()
     ├── Check cache → return if hit
     ├── clearPluginCommands()
     ├── createPluginRuntime()
     ├── createPluginRegistry()
     ├── discoverOpenClawPlugins()
     │     ├── Scan config paths (origin: "config")
     │     ├── Scan workspace extensions (origin: "workspace")
     │     ├── Scan global extensions (origin: "global")
     │     └── Scan bundled extensions (origin: "bundled")
     ├── loadPluginManifestRegistry()
     │
     ├── For each candidate:
     │     ├── Check manifest → skip if missing
     │     ├── Resolve enable state
     │     ├── Security: path escape check
     │     ├── Load module via jiti
     │     ├── Resolve export (default or register function)
     │     ├── Validate plugin config against JSON Schema
     │     └── Call register(api)
     │           ├── api.registerTool(...)
     │           ├── api.registerHook(...)
     │           ├── api.registerChannel(...)
     │           ├── api.registerProvider(...)
     │           └── api.registerService(...)
     │
     ├── setActivePluginRegistry(registry)
     └── initializeGlobalHookRunner(registry)
```

---

## 6. Core Dependencies (npm)

| Package                          | Role                                    |
|----------------------------------|-----------------------------------------|
| `@mariozechner/pi-ai`           | LLM API streaming, model registry       |
| `@mariozechner/pi-agent-core`   | Agent loop, tool execution, events       |
| `@mariozechner/pi-coding-agent` | Coding tools (read, write, edit)         |
| `@sinclair/typebox`             | JSON Schema generation for tool params   |
| `jiti`                          | TypeScript-aware dynamic import          |
| `commander`                     | CLI framework                            |
| `@clack/prompts`               | Interactive CLI prompts                  |
| `json5`                         | Config file parsing                      |

---

## 7. Entry Points

| Entry                  | Purpose                          |
|------------------------|----------------------------------|
| `openclaw.mjs`         | CLI binary (thin loader)         |
| `src/index.ts`         | Main entry (CLI + exports)       |
| `src/cli/program.ts`   | Commander program builder        |
| `dist/index.js`        | Built output entry               |
| `dist/plugin-sdk/`     | Plugin SDK exports               |

---

## 8. Key Interfaces Reference

| Interface / Type          | Location                              | Role                              |
|---------------------------|---------------------------------------|-----------------------------------|
| `AgentTool<T, D>`         | `@mariozechner/pi-agent-core`         | Tool definition + execution       |
| `AnyAgentTool`            | `src/agents/tools/common.ts`          | Untyped tool alias                |
| `AgentMessage`            | `@mariozechner/pi-agent-core`         | Conversation message union        |
| `AssistantMessageEvent`   | `@mariozechner/pi-ai`                 | Stream event union                |
| `AgentEvent`              | `@mariozechner/pi-agent-core`         | Agent lifecycle event             |
| `Model<TApi>`             | `@mariozechner/pi-ai`                 | LLM model descriptor              |
| `ApiProvider<TApi>`       | `@mariozechner/pi-ai`                 | Streaming provider registration   |
| `ChannelPlugin`           | `src/channels/plugins/types.ts`       | Channel connector interface       |
| `OpenClawPluginApi`       | `src/plugins/types.ts`                | Plugin registration API           |
| `PluginRegistry`          | `src/plugins/registry.ts`             | Global plugin state               |
| `PluginRuntime`           | `src/plugins/runtime/types.ts`        | Runtime dependency facade         |
| `OpenClawConfig`          | `src/config/config.ts`                | Application configuration         |
| `SessionEntry`            | `src/config/sessions.ts`              | Per-session state                 |
| `ProviderPlugin`          | `src/plugins/types.ts`                | LLM provider plugin               |
| `EmbeddedPiRunResult`     | `src/agents/pi-embedded-runner/types.ts` | Agent run result                |

---

## 9. Design Principles (Extracted from Code)

1. **Plugin-first**: All channels, many providers, and some tools are implemented as plugins
2. **Turn-based agent loop**: LLM calls and tool executions alternate in a loop until done
3. **Streaming**: All LLM calls stream — text, thinking, and tool calls arrive as deltas
4. **Session persistence**: Every conversation is persisted as JSONL for resume/compaction
5. **Auth profile rotation**: Multiple API keys per provider with automatic failover
6. **Hook-driven extensibility**: 25 lifecycle hooks for observation and behavior modification
7. **Sandbox isolation**: Tools can run in Docker/Podman containers
8. **Multi-channel**: A single agent can serve Telegram, Discord, Slack, and more simultaneously
9. **Tool policy**: Fine-grained allow/deny lists, profiles (minimal/coding/messaging/full)
10. **Provider-agnostic**: Same tool definitions work across Anthropic, OpenAI, Google, etc.
