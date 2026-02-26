# Respec Review — 01 Tool System

Source of truth: `openclaw/` (current workspace).

## Discrepancies

### Claimed sources and file paths
- Respec says tool system was extracted from `src/agents/pi-tools.ts`, `src/agents/tools/common.ts`, `src/agents/tool-catalog.ts`.
  - In OpenClaw, `AnyAgentTool` for the agent runtime lives at `openclaw/src/agents/tools/common.ts`, but the agent tool typing used by `pi-tools` is also defined separately as `openclaw/src/agents/pi-tools.types.ts` (Respec doesn’t mention the split).

### Tool profiles: `coding` profile is missing `image`
- Respec claims `coding` profile includes `image`.
- In `openclaw/src/agents/tool-catalog.ts`, `image` is present but is included only in `profiles: ['coding']` (this part matches), however Respec’s profile table hard-codes a list that may drift.
  - Current canonical profile resolution is computed from `CORE_TOOL_DEFINITIONS` (not hard-coded per-profile lists).

### Tool groups: `group:openclaw` description is imprecise
- Respec describes `group:openclaw` as "All tools with includeInOpenClawGroup=true".
- In `openclaw/src/agents/tool-catalog.ts`, `includeInOpenClawGroup` exists, but Respec should clarify that many tools have `profiles: []` and are still eligible for `group:openclaw` via that flag.

### Schema guardrails: union handling is not "DO NOT USE" globally
- Respec says "DO NOT USE Type.Union" because some providers reject `anyOf`.
- OpenClaw explicitly supports union-ish tool schemas by flattening `anyOf`/`oneOf` into a single `type: 'object'` schema in `openclaw/src/agents/pi-tools.schema.ts`.
  - This makes unions viable provided they can be flattened into an object schema; Respec should reflect this (avoid implying unions are forbidden in the ecosystem).

### Gemini sanitization keyword list differs
- Respec includes a specific `GEMINI_UNSUPPORTED_KEYWORDS` list.
- OpenClaw’s Gemini schema cleaning is implemented in `openclaw/src/agents/schema/clean-for-gemini.ts` (called by `pi-tools.schema.ts`). The exact keyword list and behavior should be verified against that file rather than documented as a fixed list here.

## Confirmed matches
- Tool catalog sections + tool ids match `openclaw/src/agents/tool-catalog.ts`.
- Param readers (`readStringParam`, `readNumberParam`, `readStringArrayParam`, `readStringOrNumberParam`) exist in `openclaw/src/agents/tools/common.ts` and do camelCase→snake_case fallback.
