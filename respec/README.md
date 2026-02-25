# OpenClaw Runtime Specification

> Deep architectural extraction and formal runtime specification.
> Generated from source code analysis — not summarized from docs.

---

## Specification Documents

| # | Document | Description |
|---|----------|-------------|
| 00 | [Architecture Overview](00-architecture-overview.md) | Layer diagram, dependency map, data flow, technology stack |
| 01 | [Tool System](01-tool-system.md) | `AgentTool` interface, built-in catalog, profiles, schema patterns |
| 02 | [Tool Invocation Protocol](02-tool-invocation-protocol.md) | 8-step invocation lifecycle, transport formats, error envelopes |
| 03 | [Tool Packaging Format](03-tool-packaging-format.md) | Plugin manifest, discovery locations, jiti module loading |
| 04 | [Connector System](04-connector-system.md) | `ApiProvider` interface, streaming, auth profiles, model selection |
| 05 | [LLM Invocation Flow](05-llm-invocation-flow.md) | Full `runEmbeddedPiAgent` lifecycle, retry logic, compaction |
| 06 | [Plugin Model](06-plugin-model.md) | `OpenClawPluginApi`, registration methods, hooks (25 hooks), lifecycle |
| 07 | [Message Format](07-message-format-spec.md) | `UserMessage`, `AssistantMessage`, `ToolResultMessage`, content blocks |
| 08 | [State & Persistence](08-state-and-persistence.md) | Session store, JSONL transcripts, config format, auth profiles |
| 09 | [Runtime Model](09-runtime-model.md) | `RuntimeEnv`, agent loop pseudocode, serialization, concurrency |
| 10 | [Reference Implementation](10-minimal-reference-implementation.md) | Pseudocode for tool runner, agent loop, plugin loader, connector |
| 11 | [Compatibility Checklist](11-compatibility-checklist.md) | 80+ checkboxes for complete reimplementation validation |
| 12 | [Edge Cases](12-edge-cases.md) | Provider quirks, message ordering, session corruption, auth expiry |

---

## Runnable Proof-of-Concept Examples

All PoCs are standalone TypeScript files runnable with `npx tsx` or `bun`.

| PoC | File | What it demonstrates |
|-----|------|---------------------|
| Tool Runner | [tool-runner-poc.ts](example/tool-runner-poc.ts) | Define, validate, and execute OpenClaw-compatible tools |
| Connector Wrapper | [connector-wrapper-poc.ts](example/connector-wrapper-poc.ts) | Wrap an OpenAI-compatible API into the connector interface with streaming |
| Agent Loop | [minimal-agent-loop.ts](example/minimal-agent-loop.ts) | Complete turn-based agent loop with tool execution and JSONL transcripts |
| Plugin Loader | [plugin-loader-poc.ts](example/plugin-loader-poc.ts) | Discover, load, and register plugins from `openclaw.plugin.json` manifests |
| Standalone Exec | [standalone-tool-exec.ts](example/standalone-tool-exec.ts) | CLI tool executor — run any tool as `standalone-tool-exec read --file_path ...` |

### Running PoCs

```bash
# Tool runner (no deps beyond @sinclair/typebox)
npx tsx respec/example/tool-runner-poc.ts

# Connector (uses mock by default; set OPENAI_API_KEY for real API)
npx tsx respec/example/connector-wrapper-poc.ts

# Agent loop (mock LLM, real filesystem tools)
npx tsx respec/example/minimal-agent-loop.ts

# Plugin loader (creates temp plugins, loads with jiti)
npx tsx respec/example/plugin-loader-poc.ts

# Standalone tool CLI
npx tsx respec/example/standalone-tool-exec.ts --list
npx tsx respec/example/standalone-tool-exec.ts read --file_path ./package.json --limit 5
npx tsx respec/example/standalone-tool-exec.ts exec --command "echo hello"
npx tsx respec/example/standalone-tool-exec.ts --schema grep
```

---

## Source References

| Source | What was extracted |
|--------|-------------------|
| `src/agents/pi-tools.ts` | Tool assembly pipeline, policy wrapping, hook injection |
| `src/agents/tool-catalog.ts` | 24 built-in tool definitions, 4 profiles, 11 groups |
| `src/agents/tools/common.ts` | Parameter readers, result helpers, error types |
| `src/plugins/types.ts` | `OpenClawPluginApi`, hook names, registration types |
| `src/plugins/loader.ts` | Plugin loading pipeline, jiti setup, security checks |
| `src/plugins/registry.ts` | `PluginRegistry` structure, registration functions |
| `src/plugins/manifest.ts` | Manifest format, loading, validation |
| `src/runtime.ts` | `RuntimeEnv` type, terminal state management |
| `src/index.ts` | CLI entry point, Commander program structure |
| `@mariozechner/pi-ai` | `ApiProvider`, `Model`, `AssistantMessageEvent`, streaming |
| `@mariozechner/pi-agent-core` | `AgentTool`, `AgentEvent`, `Agent` class, agent loop |
| `@sinclair/typebox` | JSON Schema generation from TypeScript types |
