# Feature Parity: clawtools vs OpenClaw

> Last updated: 2025-07-17

This document tracks which OpenClaw features are exposed through clawtools and at what level of implementation.

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully implemented — works standalone |
| 🔌 | Passthrough — deep-links into openclaw submodule |
| 🟡 | No-op stub — accepted but silently discarded |
| ❌ | Not exposed — requires OpenClaw runtime |

---

## Plugin Registration API (`PluginApi`)

OpenClaw's `OpenClawPluginApi` exposes 13 registration methods. clawtools implements the full interface so plugins can be loaded without errors.

| Method | clawtools | Notes |
|--------|-----------|-------|
| `registerTool` | ✅ | Tools and tool factories collected and usable |
| `registerConnector` | ✅ | Connectors collected and usable |
| `registerHook` | 🟡 | No hook dispatch engine |
| `registerHttpHandler` | 🟡 | No HTTP server |
| `registerHttpRoute` | 🟡 | No HTTP server |
| `registerChannel` | 🟡 | No channel messaging runtime |
| `registerGatewayMethod` | 🟡 | No gateway RPC server |
| `registerCli` | 🟡 | No Commander.js program |
| `registerService` | 🟡 | No service lifecycle manager |
| `registerProvider` | 🟡 | No provider auth wizard |
| `registerCommand` | 🟡 | No command router |
| `resolvePath` | 🟡 | Returns input unchanged (no plugin dir context) |
| `on` | 🟡 | No hook dispatch engine |

---

## Tool System

| Feature | clawtools | OpenClaw | Notes |
|---------|-----------|----------|-------|
| Tool registry | ✅ `ToolRegistry` | `tool-catalog.ts` | Reimplemented, compatible API |
| Core tool catalog (23 tools) | 🔌 Lazy factories | Direct imports | clawtools references openclaw modules |
| Tool sections (11 groups) | ✅ | ✅ | Reimplemented from catalog metadata |
| Tool profiles (4 presets) | ✅ | ✅ | minimal, coding, messaging, full |
| Custom tool registration | ✅ | ✅ | Direct + factory patterns |
| Parameter helpers | ✅ | ✅ | Reimplemented (snake_case fallback, coercion) |
| Result helpers | ✅ | ✅ | Reimplemented (json, text, error, image) |
| JSON Schema extraction | ✅ | ✅ | Reimplemented + Gemini sanitizer |
| Tool context (`ToolContext`) | ✅ | `OpenClawPluginToolContext` | Compatible fields |
| Plugin-provided tools | ✅ | ✅ | Via `loadPlugins()` → `registerTool` |
| Tool loop detection | ❌ | ✅ | Repeat/poll/ping-pong guards |
| Tool exec approval | ❌ | ✅ | JSONL socket approval flow |
| Per-sender tool policy | ❌ | ✅ | allow/deny per tool per sender |

---

## Connector System

| Feature | clawtools | OpenClaw | Notes |
|---------|-----------|----------|-------|
| Connector registry | ✅ `ConnectorRegistry` | `registerApiProvider` | Provider + API indexing |
| Extension discovery | 🔌 | ✅ | Scans `openclaw/extensions/` manifests |
| Auth resolution | ✅ `resolveAuth()` | Auth profile store | Env var + convention lookup |
| Plugin-provided connectors | ✅ | ✅ | Via `loadPlugins()` → `registerConnector` |
| Model descriptors | ✅ `ModelDescriptor` | `ModelDefinitionConfig` | Compatible subset |
| Stream events | ✅ `StreamEvent` | `AssistantMessageEvent` | Compatible |
| Streaming interface | ✅ `Connector.stream` | `registerApiProvider.stream` | AsyncIterable pattern |
| Auth profile rotation | ❌ | ✅ | Per-profile cooldown + round-robin |
| OAuth credential refresh | ❌ | ✅ | `refreshOAuth()` on `ProviderPlugin` |
| Device code auth flow | ❌ | ✅ | Via `ProviderAuthMethod` |
| Provider auth wizard | ❌ | ✅ | `WizardPrompter` + `ProviderAuthContext` |
| Model compat flags (13) | ❌ | ✅ | `ModelCompatConfig` |
| Bedrock auto-discovery | ❌ | ✅ | `BedrockDiscoveryConfig` |
| CLI backend support | ❌ | ✅ | `CliBackendConfig` |

---

## Plugin System

| Feature | clawtools | OpenClaw | Notes |
|---------|-----------|----------|-------|
| Manifest loading | ✅ | ✅ | `openclaw.plugin.json` |
| Entry point resolution | ✅ | ✅ | package.json + conventional files |
| register/activate export | ✅ | ✅ | Both patterns supported |
| Enable/disable filtering | ✅ | ✅ | Via `PluginLoaderOptions` |
| Tool collection | ✅ | ✅ | Tools + factories |
| Connector collection | ✅ | ✅ | Direct connectors |
| Plugin config schema | ❌ | ✅ | `configSchema` + `safeParse`/`validate` |
| Plugin runtime helpers | ❌ | ✅ | `PluginRuntime` — media, events, TTS, memory |
| Plugin logger injection | ❌ | ✅ | `PluginLogger` with debug/info/warn/error |
| Plugin config resolution | ❌ | ✅ | `pluginConfig` from global config |
| jiti dynamic imports | ❌ | ✅ | clawtools requires pre-compiled JS |

---

## Infrastructure (Not Exposed)

These are OpenClaw-only runtime features with no clawtools equivalent:

| Feature | OpenClaw | Why not in clawtools |
|---------|----------|---------------------|
| Hook system (26 hooks) | ✅ | Requires agent lifecycle runtime |
| Channel adapters (16 types) | ✅ | Requires messaging runtime |
| Gateway RPC server | ✅ | Requires WebSocket server |
| CLI extension system | ✅ | Requires Commander.js program |
| Service lifecycle manager | ✅ | Requires background process host |
| Session persistence (JSONL) | ✅ | Requires session storage engine |
| Agent loop (pi-agent-core) | ✅ | Core runtime, not an adapter concern |
| LLM streaming (pi-ai) | ✅ | Core runtime, not an adapter concern |
| Docker sandbox | ✅ | Requires container orchestration |
| Sandbox browser (CDP/VNC) | ✅ | Requires container orchestration |
| Image sanitization | ✅ | Requires processing pipeline |
| Exec approval (JSONL socket) | ✅ | Requires approval UI |
| Config system (`OpenClawConfig`) | ✅ | Massive config surface, not adapter scope |
| Multi-node clustering | ✅ | Requires node registry + gossip protocol |

---

## Summary

| Category | Implemented | No-op | Not exposed | Total |
|----------|-------------|-------|-------------|-------|
| Plugin API methods | 2 | 11 | 0 | 13 |
| Tool features | 9 | 0 | 3 | 12 |
| Connector features | 7 | 0 | 7 | 14 |
| Plugin features | 6 | 0 | 5 | 11 |
| Infrastructure | 0 | 0 | 14 | 14 |
| **Total** | **24** | **11** | **29** | **64** |

clawtools exposes **55%** of the feature surface (24 implemented + 11 no-op = 35 accessible out of 64). The remaining 29 features are OpenClaw runtime internals that don't apply to a standalone adapter library.
