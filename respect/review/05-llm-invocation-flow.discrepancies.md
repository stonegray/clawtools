# Respec Review — 05 LLM Invocation Flow

Source of truth: `openclaw/` (current workspace).

## Discrepancies

### Entry point parameters differ
- Respec lists `RunEmbeddedPiAgentParams` with fields like `prompt`, `images`, `modelProvider`, `modelId`, `onBlockReply`, `onStreamingTextDelta`.
- OpenClaw's `RunEmbeddedPiAgentParams` in `pi-embedded-runner/run/params.ts` includes many additional fields:
  - `sessionFile`, `sessionId`, `sessionKey`, `timeoutMs`, `runId`, `abortSignal`, `workspaceDir`, `agentDir`, `config`, `skillsSnapshot`
  - Multiple channel/routing context fields (`groupId`, `groupChannel`, `spawnedBy`, `senderId`, etc.)
  - Callback fields for multiple subscription modes (`onPartialReply`, `onAssistantMessageStart`, `onBlockReply`, `onReasoningStream`, `onToolResult`, `onAgentEvent`)
  - Execution context fields (`execOverrides`, `bashElevated`, `clientTools`, `disableTools`)
- Respec's "key fields" view is a simplification; the full parameter set is much larger and more complex. This is not a bug, but Respec should acknowledge the simplified view or expand the parameter table.

### Result type differs
- Respec describes `EmbeddedPiRunResult` with `payloads`, `meta`, `didSendViaMessagingTool`, `messagingToolSentTexts`, `messagingToolSentMediaUrls`, `messagingToolSentTargets`, `successfulCronAdds`.
- OpenClaw's actual type in `pi-embedded-runner/types.ts` matches this, but `meta.agentMeta` contains different fields: `sessionId`, `provider`, `model`, `compactionCount`, `promptTokens`, plus `usage` and `lastCallUsage` (which track cache fields separately to avoid inflation).
- Respec should note the separate `lastCallUsage` tracking for context-window calculation.

### Phase naming and structure
- Respec uses "PHASE" numbers (1–6) and names them: "Pre-resolution", "Model & Auth Resolution", "Retry Loop", "Attempt", "Agent Loop", "Post-processing".
- OpenClaw's actual code structure in `runEmbeddedPiAgent()` does follow phases, but the naming and boundaries may differ. Respec's outline is a reasonable abstraction but should be verified against actual code flow.

### before_model_resolve vs before_agent_start
- Respec mentions both hooks but doesn't fully clarify the precedence.
- OpenClaw actually runs both hooks and merges their results with `modelResolveOverride` taking precedence (new hook > legacy hook). Respec should document this precedence explicitly.

### Retry logic details
- Respec says "Scale with profile count (2× base × profile count)" for max retries.
- OpenClaw uses `BASE_RUN_RETRY_ITERATIONS (24) + RUN_RETRY_ITERATIONS_PER_PROFILE (8) × profileCount`, clamped to `[32, 160]`.
  - This is more conservative than "2× base × profile count" and includes hard bounds. Respec's formula is incorrect.

### Stream subscription return type
- Respec mentions `subscribeEmbeddedPiSession()` returns `Promise<SubscriptionResult>`.
- OpenClaw's actual function in `pi-embedded-subscribe.ts` returns the subscription result directly (not fully specified in Respec).

### Cache fields handling
- Respec doesn't mention the cache inflation issue that OpenClaw handles.
- OpenClaw keeps `lastInput`, `lastCacheRead`, `lastCacheWrite` from the most recent API call (to avoid N× context inflation across tool-use loops). This is noted in code comments and should be documented in Respec's usage tracking section.

## Confirmed matches
- Multi-turn aggregation behavior (sum input/output, use last cache fields).
- Session lane serialization (one run per session at a time).
- Compaction trigger on context overflow.
