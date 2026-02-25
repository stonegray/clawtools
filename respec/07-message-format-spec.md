# 07 — Message Format Specification

> Formal specification of all message types in the OpenClaw runtime.
> Extracted from: `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`

---

## 1. Message Type Hierarchy

```typescript
// Base LLM messages
type Message = UserMessage | AssistantMessage | ToolResultMessage;

// Agent-level messages (extensible)
interface CustomAgentMessages {}  // Empty by default, declaration-merged
type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

---

## 2. Content Block Types

### 2.1 TextContent

```typescript
interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;  // Anthropic text signature (cache verification)
}
```

### 2.2 ThinkingContent

```typescript
interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;  // Anthropic thinking signature
}
```

### 2.3 ImageContent

```typescript
interface ImageContent {
  type: "image";
  data: string;       // Base64-encoded image data
  mimeType: string;   // e.g., "image/png", "image/jpeg"
}
```

### 2.4 ToolCall

```typescript
interface ToolCall {
  type: "toolCall";
  id: string;                              // Provider-assigned unique ID
  name: string;                            // Tool name (e.g., "exec", "read")
  arguments: Record<string, any>;          // Parsed JSON arguments
  thoughtSignature?: string;               // Anthropic thought signature
}
```

---

## 3. Message Types

### 3.1 UserMessage

```typescript
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;  // Unix milliseconds
}
```

**Examples:**

```json
// Simple text
{
  "role": "user",
  "content": "Read the file src/index.ts",
  "timestamp": 1740000000000
}

// With images
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What's in this screenshot?" },
    { "type": "image", "data": "iVBORw0KGgo...", "mimeType": "image/png" }
  ],
  "timestamp": 1740000000000
}
```

### 3.2 AssistantMessage

```typescript
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;                    // Transport used (e.g., "anthropic-messages")
  provider: Provider;          // Provider name (e.g., "anthropic")
  model: string;               // Model ID (e.g., "claude-opus-4-6")
  usage: Usage;                // Token usage and cost
  stopReason: StopReason;      // Why the model stopped
  errorMessage?: string;       // Error message if stopReason is "error"
  timestamp: number;           // Unix milliseconds
}

type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

**Example: Text response**

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Here's the content of the file..." }
  ],
  "api": "anthropic-messages",
  "provider": "anthropic",
  "model": "claude-opus-4-6",
  "usage": {
    "input": 1500,
    "output": 200,
    "cacheRead": 0,
    "cacheWrite": 1500,
    "totalTokens": 1700,
    "cost": { "input": 0.0225, "output": 0.015, "cacheRead": 0, "cacheWrite": 0.028, "total": 0.0655 }
  },
  "stopReason": "stop",
  "timestamp": 1740000001000
}
```

**Example: With tool calls**

```json
{
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "I need to read the file first..." },
    { "type": "text", "text": "Let me read that file." },
    {
      "type": "toolCall",
      "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "read",
      "arguments": {
        "file_path": "/home/user/src/index.ts",
        "offset": 0,
        "limit": 200
      }
    }
  ],
  "api": "anthropic-messages",
  "provider": "anthropic",
  "model": "claude-opus-4-6",
  "usage": { ... },
  "stopReason": "toolUse",
  "timestamp": 1740000001000
}
```

### 3.3 ToolResultMessage

```typescript
interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;          // Must match ToolCall.id
  toolName: string;            // Tool name
  content: (TextContent | ImageContent)[];
  details?: TDetails;          // Typed detail payload
  isError: boolean;            // Whether this is an error result
  timestamp: number;           // Unix milliseconds
}
```

**Example: Success**

```json
{
  "role": "toolResult",
  "toolCallId": "toolu_01A09q90qw90lq917835lq9",
  "toolName": "read",
  "content": [
    { "type": "text", "text": "import { createServer } from 'http';\n..." }
  ],
  "details": { "file_path": "/home/user/src/index.ts", "lines": 200 },
  "isError": false,
  "timestamp": 1740000002000
}
```

**Example: Error**

```json
{
  "role": "toolResult",
  "toolCallId": "toolu_01A09q90qw90lq917835lq9",
  "toolName": "exec",
  "content": [
    { "type": "text", "text": "{\"status\":\"error\",\"tool\":\"exec\",\"error\":\"command required\"}" }
  ],
  "isError": true,
  "timestamp": 1740000002000
}
```

---

## 4. Usage Type

```typescript
interface Usage {
  input: number;          // Input tokens consumed
  output: number;         // Output tokens generated
  cacheRead: number;      // Tokens read from cache
  cacheWrite: number;     // Tokens written to cache
  totalTokens: number;    // Total tokens (input + output)
  cost: {
    input: number;        // Cost in dollars
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

---

## 5. Stream Event Types

### 5.1 `AssistantMessageEvent` (Wire Format)

```typescript
type AssistantMessageEvent =
  // Session lifecycle
  | { type: "start";          partial: AssistantMessage }
  | { type: "done";           reason: StopReason; message: AssistantMessage }
  | { type: "error";          reason: "aborted" | "error"; error: AssistantMessage }

  // Text streaming
  | { type: "text_start";     contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta";     contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end";       contentIndex: number; content: string; partial: AssistantMessage }

  // Thinking streaming
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end";   contentIndex: number; content: string; partial: AssistantMessage }

  // Tool call streaming
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end";   contentIndex: number; toolCall: ToolCall; partial: AssistantMessage };
```

### 5.2 `AgentEvent` (Runtime Events)

```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end";             messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end";              message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start";         message: AgentMessage }
  | { type: "message_update";        message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end";           message: AgentMessage }
  | { type: "tool_execution_start";  toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end";    toolCallId: string; toolName: string; result: any; isError: boolean };
```

---

## 6. Session Transcript Format (JSONL)

Session transcripts are stored as line-delimited JSON files:

```
<path>: ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
```

Each line is a serialized `AgentMessage`:

```jsonl
{"role":"user","content":"Read the file main.ts","timestamp":1740000000000}
{"role":"assistant","content":[{"type":"text","text":"Let me read that file."},{"type":"toolCall","id":"call_1","name":"read","arguments":{"file_path":"main.ts"}}],"api":"anthropic-messages","provider":"anthropic","model":"claude-opus-4-6","usage":{"input":100,"output":50,"cacheRead":0,"cacheWrite":0,"totalTokens":150,"cost":{"input":0.0015,"output":0.00375,"cacheRead":0,"cacheWrite":0,"total":0.00525}},"stopReason":"toolUse","timestamp":1740000001000}
{"role":"toolResult","toolCallId":"call_1","toolName":"read","content":[{"type":"text","text":"...file contents..."}],"isError":false,"timestamp":1740000002000}
{"role":"assistant","content":[{"type":"text","text":"The file contains..."}],"api":"anthropic-messages","provider":"anthropic","model":"claude-opus-4-6","usage":{"input":200,"output":100,"cacheRead":100,"cacheWrite":0,"totalTokens":300,"cost":{"input":0.003,"output":0.0075,"cacheRead":0.00015,"cacheWrite":0,"total":0.01065}},"stopReason":"stop","timestamp":1740000003000}
```

---

## 7. Reply Payload Format

The result sent back to channels after an agent run:

```typescript
type ReplyPayload = {
  text?: string;               // Reply text (Markdown)
  mediaUrl?: string;           // Media attachment URL
  mediaUrls?: string[];        // Multiple media URLs
  replyToId?: string;          // Reply to this message ID
  isError?: boolean;           // Is this an error response
};
```

---

## 8. Provider-Specific Message Format Adjustments

### 8.1 Anthropic

- Uses `"developer"` role for system prompt (via API)
- Supports `textSignature` and `thinkingSignature` for cache verification
- Thinking content is native

### 8.2 OpenAI

- System prompt as first `"system"` or `"developer"` message
- Tool calls use `function` calling format on the wire
- Thinking may be downgraded to text blocks for non-o-series models

### 8.3 Google

- Tool call JSON Schema is sanitized (see spec 01)
- Gemini-specific keyword stripping
- Turn ordering fixes (user-assistant alternation)

### 8.4 Ollama

- Native streaming via Ollama API
- Tool calls may use OpenAI-compatible format
- Custom stream function bypasses `pi-ai` registry
