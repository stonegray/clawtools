# Respec Review — 09 Runtime Model

Source of truth: `openclaw/src/runtime.ts`, `openclaw/src/commands/`, agent loop in `@mariozechner/pi-agent-core`.

## Discrepancies

### RuntimeEnv type differs slightly
- Respec shows `RuntimeEnv` with `log`, `error`, `exit`, plus claims "With progress line clearing" for log.
- OpenClaw's actual `src/runtime.ts` defines `RuntimeEnv` identically, but the clearing behavior is factored into the `log` implementation via `clearActiveProgressLine()`. The interface matches but behavior is internal to the implementation, not reflected in the type.

### PluginRuntime size and completeness
- Respec lists an extensive `PluginRuntime` facade with 12+ sub-objects (config, system, media, tts, tools, channel, logging, state).
- OpenClaw actually has this in `src/plugins/runtime/plugin.runtime.ts`, but verification of exact field parity is complex. The breadth is accurate; field-by-field verification was not completed in this review.

### Session lane vs global lane serialization
- Respec claims two modes: per-session queue and global queue (configured via `config.session.serialization`).
- OpenClaw implements this via `createRunQueueManager()` in `src/agents/run-queue-manager.ts`. No discrepancies found.

### Agent loop pseudocode matches pi-agent-core
- Respec pseudocode shows turn-based loop with streaming assembly.
- OpenClaw's agent loop is inside `@mariozechner/pi-agent-core` (external library), not in openclaw itself. OpenClaw calls this library. No discrepancies found; spec accurately documents the loop.

### Error handling model
- Respec lists retry scenarios: context overflow, auth error, rate limit, abort.
- OpenClaw's `handleAgentRunError()` in `src/agents/run.ts` implements these. No discrepancies found.

## Confirmed matches
- RuntimeEnv type and semantics match.
- Session serialization (per-session and global queues) implemented as specified.
- Signal handling via AbortSignal propagated correctly.
- Error recovery strategies (compaction, profile rotation, cooldown, abort) all present.
