# Message Format

Clawtools uses its **own** conversation message format — not raw OpenAI `tool_calls` objects,
not Anthropic `content` blocks. The connector layer translates clawtools messages into whatever
each provider's API expects at call time.

If you cargo-cult the OpenAI `{ role: "tool", tool_call_id: "…", content: "…" }` shape or
Anthropic's `role: "user" + content: [{ type: "tool_result" }]`, your messages will be passed
through to pi-ai as-is and you will get confusing 400 errors or silent misbehaviour.

## Types

```ts
import type { UserMessage, AssistantMessage, ConversationMessage } from "clawtools";
```

### `UserMessage`

```ts
interface UserMessage {
  role: "user";
  content: string | Array<{ type: string; [key: string]: unknown }>;
}
```

A plain text user turn or a multimodal block array:

```ts
// Plain text
const msg: UserMessage = { role: "user", content: "Hello!" };

// Multimodal (image + text)
const msg: UserMessage = {
  role: "user",
  content: [
    { type: "text", text: "Describe this image:" },
    { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
  ],
};
```

### `AssistantMessage`

```ts
interface AssistantMessage {
  role: "assistant";
  content: string | null | Array<{ type: string; [key: string]: unknown }>;
}
```

A plain text assistant response or a structured content array (text + tool calls):

```ts
// Plain text (most common for non-tool turns)
const msg: AssistantMessage = { role: "assistant", content: "The answer is 42." };

// Tool-calling turn — content array with text and toolCall blocks
const msg: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "text", text: "I'll read that file now." },
    {
      type: "toolCall",
      id: "call_abc123",
      name: "read",
      arguments: { path: "src/index.ts" },
    },
  ],
};

// Tool-use-only (no text, just the call)
const msg: AssistantMessage = {
  role: "assistant",
  content: [
    {
      type: "toolCall",
      id: "call_abc123",
      name: "read",
      arguments: { path: "src/index.ts" },
    },
  ],
};
```

### `ToolResultMessage` — feeding results back

After executing a tool you must feed the result back as a **tool result message**. This type
is exported from clawtools and is part of the `StreamContext.messages` union:

```ts
import type { ToolResultMessage } from "clawtools";

const toolResult: ToolResultMessage = {
  role: "toolResult" as const,        // ← NOT "tool" (OpenAI) or "user" (Anthropic)
  toolCallId: "call_abc123",          // matches the id from the toolCall block
  toolName: "read",
  content: [{ type: "text", text: "File contents here…" }],
  isError: false,
};
```

Full `ToolResultMessage` shape:

| Field | Type | Description |
|-------|------|-------------|
| `role` | `"toolResult"` | **Required.** Distinguishes this from user/assistant turns. |
| `toolCallId` | `string` | ID from the `toolCall` block that triggered this result. |
| `toolName` | `string` | Name of the tool that was called. |
| `content` | `Array<{ type: "text"; text: string } \| { type: "image"; data: string; mimeType: string }>` | One or more result blocks. |
| `isError` | `boolean` | Set to `true` if the tool call failed. |
| `details` | `unknown` | Optional structured payload (passed through, not shown to the LLM). |

## Message flow in a tool-use loop

```
┌─────────────────────────────────────────────────────────────┐
│ messages array                                              │
│                                                             │
│  [0] UserMessage      { role: "user", content: "…" }        │
│  [1] AssistantMessage { role: "assistant", content: [       │
│        { type: "toolCall", id: "c1", name: "read", … }      │
│      ]}                                                     │
│  [2] ToolResultMessage { role: "toolResult",                │
│        toolCallId: "c1", toolName: "read",                  │
│        content: [{ type: "text", text: "…" }],              │
│        isError: false }                                     │
│  [3] AssistantMessage { role: "assistant", content: "…" }   │
└─────────────────────────────────────────────────────────────┘
```

## Common mistakes

| ❌ Wrong | ✅ Right |
|---------|---------|
| `{ role: "tool", tool_call_id: "…", content: "…" }` | `{ role: "toolResult", toolCallId: "…", … }` |
| `{ role: "user", content: [{ type: "tool_result", … }] }` | `{ role: "toolResult", … }` |
| `content: [{ type: "tool_use", id: "…", … }]` | `content: [{ type: "toolCall", id: "…", … }]` |
| `role: "assistant"` with `tool_calls: [{…}]` at top level | `content: [{ type: "toolCall", … }]` inside the block array |

See the [agentic loop example](../../examples/agentic/) for a complete working implementation.
