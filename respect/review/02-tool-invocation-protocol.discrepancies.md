# Respec Review — 02 Tool Invocation Protocol

Source of truth: `openclaw/` (current workspace).

## Discrepancies

### Parallel execution claim
- Respec claims: "pi-agent-core executes tool calls **in parallel** by default".
- OpenClaw wraps tools via `openclaw/src/agents/pi-tool-definition-adapter.ts` and adds hook behavior there; this file alone does not establish parallelism.
  - The actual parallel/sequential behavior is determined by `@mariozechner/pi-agent-core` internals (and/or OpenClaw’s embedded runner). Respec should avoid asserting parallelism unless it is verified in OpenClaw’s `pi-embedded-runner` integration.

### ToolCall content block type naming
- Respec uses `type: 'toolCall'` exclusively in examples.
- OpenClaw explicitly recognizes tool call blocks with types in `{ 'toolCall', 'toolUse', 'functionCall' }` when extracting/sanitizing tool call IDs (`openclaw/src/agents/tool-call-id.ts`). Respec should document these accepted variants.

### Hook semantics: before_tool_call
- Respec says before_tool_call "may block" and "may modify params".
- In OpenClaw, `before_tool_call` hook behavior is implemented in `openclaw/src/agents/pi-tools.before-tool-call.ts` and invoked from `pi-tool-definition-adapter.ts`; blocking currently manifests as throwing an Error with the hook-provided reason (not a structured `{ block: true }` envelope).

### Error envelope examples
- Respec’s error JSON examples should include the actual statuses OpenClaw uses.
  - OpenClaw’s tool adapter uses `jsonResult({ status: 'error', tool, error })` on failures.
  - Client-tool delegation returns `jsonResult({ status: 'pending', tool, message })`.
  - Respec mentions `blocked` status (likely exists), but the actual implementation of "blocked" depends on `jsonResult` and hook wrappers; this needs alignment.

## Confirmed matches
- Tool call ID sanitization for Mistral-style strict length constraints exists (`openclaw/src/agents/tool-call-id.ts`, `ToolCallIdMode = 'strict' | 'strict9'`).
- CamelCase/snake_case param fallback exists via `readParamRaw` in `openclaw/src/agents/tools/common.ts`.
