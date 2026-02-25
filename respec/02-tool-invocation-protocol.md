# 02 — Tool Invocation Protocol

> Formal specification of how tools are invoked, executed, and their results fed back.
> Extracted from: `@mariozechner/pi-agent-core`, `src/agents/pi-tool-definition-adapter.ts`

---

## 1. Invocation Lifecycle

```
LLM Response
     │
     ├── Parse AssistantMessage.content → extract ToolCall[]
     │
     │   ToolCall = {
     │     type: "toolCall",
     │     id: string,        // Provider-assigned unique ID
     │     name: string,      // Tool name (e.g., "exec", "read")
     │     arguments: Record<string, any>  // Parsed JSON arguments
     │   }
     │
     ├── For each ToolCall:
     │     │
     │     ├─── [1] EMIT: tool_execution_start
     │     │     { toolCallId, toolName, args }
     │     │
     │     ├─── [2] HOOK: before_tool_call
     │     │     → May block (return { block: true })
     │     │     → May modify params (return { params: {...} })
     │     │
     │     ├─── [3] EXECUTE: tool.execute(toolCallId, params, signal, onUpdate)
     │     │     → Returns AgentToolResult<T>
     │     │     → Or throws Error (caught and wrapped)
     │     │
     │     ├─── [4] HOOK: after_tool_call
     │     │     → Observation only
     │     │
     │     ├─── [5] CONSTRUCT: ToolResultMessage
     │     │     {
     │     │       role: "toolResult",
     │     │       toolCallId: string,
     │     │       toolName: string,
     │     │       content: (TextContent | ImageContent)[],
     │     │       details: any,
     │     │       isError: boolean,
     │     │       timestamp: number
     │     │     }
     │     │
     │     ├─── [6] HOOK: tool_result_persist
     │     │     → May rewrite message content before persistence
     │     │
     │     ├─── [7] EMIT: tool_execution_end
     │     │     { toolCallId, toolName, result, isError }
     │     │
     │     └─── [8] APPEND to session messages
     │
     └── Re-invoke LLM with updated messages (auto-loop)
```

---

## 2. Transport Format: LLM → Runtime

### 2.1 Tool Call in AssistantMessage

The LLM returns tool calls as content blocks within the `AssistantMessage`:

```typescript
// AssistantMessage from LLM
{
  role: "assistant",
  content: [
    { type: "text", text: "I'll read that file for you." },
    {
      type: "toolCall",
      id: "call_abc123",
      name: "read",
      arguments: {
        file_path: "/home/user/project/main.ts",
        offset: 0,
        limit: 200
      }
    }
  ],
  stopReason: "toolUse",
  // ... other fields
}
```

### 2.2 Streaming Tool Call Assembly

Tool calls arrive as streaming deltas:

```
1. { type: "toolcall_start",  contentIndex: 1 }
2. { type: "toolcall_delta",  contentIndex: 1, delta: '{"file_' }
3. { type: "toolcall_delta",  contentIndex: 1, delta: 'path": "/hom' }
4. { type: "toolcall_delta",  contentIndex: 1, delta: 'e/user/main.ts"}' }
5. { type: "toolcall_end",    contentIndex: 1, toolCall: { ... } }
```

The `toolcall_end` event contains the fully assembled `ToolCall` object.

---

## 3. Transport Format: Runtime → LLM

### 3.1 Tool Result Message

```typescript
// Sent back to LLM as part of conversation history
{
  role: "toolResult",
  toolCallId: "call_abc123",   // Must match the ToolCall.id
  toolName: "read",
  content: [
    {
      type: "text",
      text: "// main.ts\nimport { createServer } from 'http';\n..."
    }
  ],
  details: { file_path: "/home/user/project/main.ts", lines: 200 },
  isError: false,
  timestamp: 1740000000000
}
```

### 3.2 Error Result

```typescript
{
  role: "toolResult",
  toolCallId: "call_abc123",
  toolName: "exec",
  content: [
    {
      type: "text",
      text: '{"status":"error","tool":"exec","error":"command required"}'
    }
  ],
  details: undefined,
  isError: true,
  timestamp: 1740000000000
}
```

### 3.3 Image Result

```typescript
{
  role: "toolResult",
  toolCallId: "call_abc123",
  toolName: "image",
  content: [
    { type: "text", text: "MEDIA:/path/to/screenshot.png" },
    { type: "image", data: "iVBORw0KGgo...", mimeType: "image/png" }
  ],
  details: { path: "/path/to/screenshot.png" },
  isError: false,
  timestamp: 1740000000000
}
```

---

## 4. Tool Call ID Generation

Source: `src/agents/tool-call-id.ts`

Tool call IDs are typically provider-assigned. OpenClaw normalizes them for providers with strict requirements:

- **Mistral**: Requires specific ID format → OpenClaw generates compliant IDs
- **General**: Passes through provider-assigned IDs unchanged

---

## 5. Execution Semantics

### 5.1 Parallel vs Sequential

Tool calls from a single LLM response can contain **multiple tool calls**. The agent loop from `pi-agent-core` executes them **in parallel** by default.

### 5.2 Abort / Cancellation

```typescript
// AbortSignal is threaded through the entire execution chain
tool.execute(toolCallId, params, signal, onUpdate)

// Cancellation propagation:
// 1. User sends steering message → abort signal fires
// 2. Tool execution is interrupted
// 3. Partial result may be returned
// 4. Session continues with the next turn
```

### 5.3 Timeout

Execution timeout is configured per-tool:

```typescript
// exec tool timeouts
{
  timeoutSec: 120,        // Max execution time
  backgroundMs: 30000,    // Background process yield time
  cleanupMs: 5000,        // Post-execution cleanup window
}
```

### 5.4 Progressive Updates

Tools can report progress during execution:

```typescript
execute: async (toolCallId, params, signal, onUpdate) => {
  onUpdate?.({ content: [{ type: "text", text: "Starting..." }] });
  // ... work ...
  onUpdate?.({ content: [{ type: "text", text: "50% done..." }] });
  // ... more work ...
  return { content: [...], details: {...} };
}
```

Updates emit `tool_execution_update` events.

---

## 6. Input Normalization

### 6.1 Parameter Name Normalization

Both `camelCase` and `snake_case` parameter names are accepted:

```typescript
// These are equivalent:
{ "filePath": "/path/to/file" }
{ "file_path": "/path/to/file" }
```

### 6.2 Claude Code Compatibility

`wrapToolParamNormalization` maps Claude Code-style parameter names to OpenClaw parameter names:

```typescript
const CLAUDE_PARAM_GROUPS = {
  write: {
    file_path: "file_path",
    content: "content",
  },
  edit: {
    file_path: "file_path",
    old_string: "old_string",
    new_string: "new_string",
  },
};
```

### 6.3 Required Parameter Assertion

```typescript
function assertRequiredParams(params: Record<string, unknown>, required: string[]): void {
  for (const key of required) {
    const value = readParamRaw(params, key);
    if (value === undefined || value === null || value === "") {
      throw new ToolInputError(`${key} required`);
    }
  }
}
```

---

## 7. Output Validation

### 7.1 Content Type Validation

Tool results must conform to:

```typescript
type AgentToolResult<T> = {
  content: (TextContent | ImageContent)[];  // At least one content block
  details: T;                               // Typed detail payload
}
```

### 7.2 Image Sanitization

Images in tool results are sanitized before being sent to the LLM:

```typescript
type ImageSanitizationLimits = {
  maxWidth?: number;    // Max image width in pixels
  maxHeight?: number;   // Max image height in pixels
  maxBytes?: number;    // Max image size in bytes
};
```

Large images are resized/compressed to stay within limits.

---

## 8. Error Envelope Format

### 8.1 Standard Error JSON

```json
{
  "status": "error",
  "tool": "tool_name",
  "error": "Human-readable error message"
}
```

### 8.2 Blocked Tool Result

When a `before_tool_call` hook blocks execution:

```json
{
  "status": "blocked",
  "tool": "exec",
  "reason": "Tool blocked by policy: safe-bin mode"
}
```

### 8.3 Client-Delegated Result

For client-hosted tools (OpenResponses):

```json
{
  "status": "pending",
  "tool": "custom_tool",
  "message": "Tool execution delegated to client"
}
```

---

## 9. Sequence Diagram: Full Tool Invocation

```
User        Agent Loop     Tool System    LLM Provider
 │              │               │              │
 │──message──▶ │               │              │
 │              │──stream()────────────────▶  │
 │              │              │              │
 │              │◀─toolcall_end─────────────  │
 │              │              │              │
 │              │──before_hook─▶│              │
 │              │              │              │
 │              │──execute()──▶│              │
 │              │              │──(shell/fs)──│
 │              │◀─result──────│              │
 │              │              │              │
 │              │──after_hook──▶│              │
 │              │              │              │
 │              │──stream()────────────────▶  │
 │              │              │              │
 │              │◀─text_delta───────────────  │
 │              │◀─done─────────────────────  │
 │              │              │              │
 │◀─reply──────│               │              │
```

---

## 10. Capability Flags

Tools declare capabilities through their schema and metadata:

| Flag              | Scope      | Effect                                    |
|-------------------|------------|-------------------------------------------|
| `ownerOnly`       | Tool       | Restricts to owner senders                |
| `optional`        | Plugin     | Can be omitted from tool list             |
| `background`      | Exec       | Supports background execution             |
| `pty`             | Exec       | Supports pseudo-terminal mode             |
| `elevated`        | Exec       | Supports elevated (sudo) execution        |
| `workspaceOnly`   | Filesystem | Restricts to workspace directory          |

---

## 11. Streaming Semantics for Tool Results

Tool results are **not** streamed. They are returned as complete payloads. However:

1. **Progressive updates** can be emitted during execution via `onUpdate`
2. **Background processes** return partial output and continue running
3. **Large outputs** are truncated (e.g., exec output capped at configurable limit)

The streaming occurs at the **LLM level**, not the tool level. After all tool results are appended, the next LLM call streams its response.
