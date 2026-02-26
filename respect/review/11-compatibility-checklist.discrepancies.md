# Respec Review — 11 Compatibility Checklist

Source of truth: `openclaw/` implementation against checklist items.

## Discrepancies

### Tool interface: Typebox schema requirement
- Respec requires `Type.Object(...)` from `@sinclair/typebox` for tool schemas.
- OpenClaw enforces this, but some bundled tools or custom tools might use non-Typebox schemas. The requirement is correct but not universally enforced at plugin load time. However, built-in tools and most plugins comply.

### Tool catalog profile support
- Respec claims support for `minimal`, `coding`, `messaging`, `full` profiles.
- OpenClaw defines these in `src/agents/tool-profiles.ts`. Verified correct.

### Tool parameter readers: camelCase + snake_case fallback
- Respec claims both variants work.
- OpenClaw implements this in `normalizeToolArguments()` in `src/agents/pi-tools.ts`. Verified correct.

### AbortSignal propagation to tool execution
- Respec claims AbortSignal is passed to tool.execute(id, args, signal).
- OpenClaw passes this correctly in agent-core integration. Verified correct.

### Message type requirements
- Respec lists `UserMessage`, `AssistantMessage`, `ToolResultMessage`.
- These come from `@mariozechner/pi-agent-core`. OpenClaw uses them correctly. Verified correct.

### Content block types
- Respec lists `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`.
- All present in agent-core types. Verified correct.

### Streaming events
- Respec lists: `start`, `text_delta`, `thinking_delta`, `toolcall_start/delta/end`, `done`, `error`.
- Agent-core generates these via providers. Verified correct.

### Provider interface and authentication
- Respec claims API key from env, auth profile store, config file.
- OpenClaw implements all three in `src/config/auth.ts` and provider integrations. Verified correct.

### Plugin manifest and loading discovery
- Respec claims: config → workspace → global → bundled priority.
- OpenClaw implements this in `loadOpenClawPlugins()` in `src/plugins/loader.ts`. Verified correct.

### Plugin hook count
- Respec claims 25 hooks, but checklist also says "see spec 06" (which shows 24 hooks).
- This is an inconsistency in Respec itself, not a discrepancy with OpenClaw. OpenClaw implements exactly 24 hooks as per 06.

### Session store persistence and TTL
- Respec claims JSON file + 45s TTL + atomic writes.
- OpenClaw implements this in `src/config/sessions.ts`. Verified correct.

### Agent loop max turns and error recovery
- Respec claims max 20 turns, compaction on overflow, profile rotation on auth error, cooldown on rate limit.
- OpenClaw implements all of these. Verified correct.

## Confirmed matches
- Most compatibility checklist items are verified correct.
- Plugin loading discovery order is correct.
- Auth profile rotation and cooldown are implemented.
- Session persistence with TTL is correct.

## Minor issue
- Respec checklist item says "25 hook names" but spec 06 shows 24. This is a Respec self-inconsistency, not an OpenClaw issue.
