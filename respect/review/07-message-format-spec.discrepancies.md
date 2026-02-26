# Respec Review — 07 Message Format Spec

Source of truth: `@mariozechner/pi-ai` and `@mariozechner/pi-agent-core` (external libraries).

## Notes
- This spec describes message formats from `@mariozechner/pi-ai` and `@mariozechner/pi-agent-core`, which are external dependencies.
- OpenClaw uses these types directly and does not override them.
- Session transcripts in `openclaw/src/config/sessions.ts` persist `AgentMessage[]` as JSONL, matching the format described.
- No discrepancies found. Respec accurately documents the message format contract.

## Confirmed matches
- TextContent, ThinkingContent, ImageContent, ToolCall types align with agent-core.
- UserMessage, AssistantMessage, ToolResultMessage match external library types.
- AssistantMessageEvent stream types align with pi-ai streaming protocol.
- Usage tracking fields (input, output, cacheRead, cacheWrite, totalTokens, cost) match OpenClaw's usage tracking implementation.
