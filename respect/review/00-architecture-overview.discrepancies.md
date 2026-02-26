# Respec Review — 00 Architecture Overview

Source of truth: `openclaw/` (current workspace).

## Discrepancies

### Version / provenance metadata
- Respec header claims `Source: openclaw@2026.2.23-beta.1` and date `2026-02-24`, but the current `openclaw/package.json` reports version `2026.2.25`.

### Hook count
- Respec claims **"25 lifecycle hooks"**. The implemented typed hook name union `PluginHookName` contains **24** entries.
  - Hook names implemented in `openclaw/src/plugins/types.ts`:
    `before_model_resolve`, `before_prompt_build`, `before_agent_start`, `llm_input`, `llm_output`, `agent_end`, `before_compaction`, `after_compaction`, `before_reset`, `message_received`, `message_sending`, `message_sent`, `before_tool_call`, `after_tool_call`, `tool_result_persist`, `before_message_write`, `session_start`, `session_end`, `subagent_spawning`, `subagent_delivery_target`, `subagent_spawned`, `subagent_ended`, `gateway_start`, `gateway_stop`.

### Tool schema library claim is incomplete
- Respec presents tool parameter schemas as TypeBox-first ("`@sinclair/typebox` → compiles to JSON Schema"). In `openclaw/src/agents/pi-tools.ts`, core coding tools are imported from `@mariozechner/pi-coding-agent`, and OpenClaw additionally performs schema normalization/cleaning in `openclaw/src/agents/pi-tools.schema.ts` (including flattening `anyOf`/`oneOf`, enforcing top-level `type: 'object'`, and provider-specific scrubbing). Respec should explicitly describe this normalization layer as part of the tool schema contract.

## Notes (seem correct / confirmed)
- Node engine constraint is >= 22.12.0 (matches "Node.js 22+").
- Plugin loader uses `jiti` with aliasing for `openclaw/plugin-sdk`.
- Plugin discovery includes symlink escape + world-writable + suspicious-ownership checks.
