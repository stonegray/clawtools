# 12 — Edge Cases and Provider Quirks

> Known edge cases, provider-specific behaviors, and error scenarios.
> Derived from actual source code analysis.

---

## 1. Tool Schema Edge Cases

### 1.1 Gemini Keyword Stripping

Google's Generative AI API rejects schemas containing certain JSON Schema keywords:

```typescript
// Keywords stripped for Gemini compatibility:
const GEMINI_STRIP_KEYWORDS = [
  "default",
  "$schema",
  "examples",
  "title",
  // Plus format keyword handling
];
```

**Implication**: Any tool with `default` values in its Typebox schema will have those
defaults silently removed when sent to Gemini models. The runtime must apply defaults
client-side before executing the tool.

### 1.2 `format` Property Name

The `format` property name in JSON Schema is treated as a reserved keyword by some
validators. Tool schemas should avoid using `format` as a parameter name:

```typescript
// BAD — will be rejected by some providers
Type.Object({
  format: Type.String(),  // Conflicts with JSON Schema "format" keyword
});

// GOOD — use a different name
Type.Object({
  outputFormat: Type.String(),
});
```

### 1.3 Empty Tool Call Arguments

Some providers send `{}` or `""` when a tool has no required parameters. The runtime
must handle both:

```typescript
function parseToolArgs(rawArgs: string | object): Record<string, unknown> {
  if (typeof rawArgs === "string") {
    if (rawArgs === "" || rawArgs === "{}") return {};
    return JSON.parse(rawArgs);
  }
  return rawArgs ?? {};
}
```

### 1.4 Streaming JSON Assembly

Tool call arguments arrive as streaming JSON deltas:

```
Delta 1: '{"file_'
Delta 2: 'path": "/ho'
Delta 3: 'me/user/src/ind'
Delta 4: 'ex.ts"}'
```

The runtime must accumulate deltas and parse only on `toolcall_end`. Partial JSON
parsing must not be attempted.

---

## 2. Provider-Specific Quirks

### 2.1 Anthropic

**Thinking Block Ordering**: Thinking blocks must come before text blocks in the
content array. Some responses return thinking after text — the runtime reorders.

**Cache Verification Signatures**: `textSignature` and `thinkingSignature` fields
enable cache hit verification. These must be preserved in session transcripts for
cache effectiveness.

**Max Tokens Enforcement**: Anthropic requires an explicit `max_tokens` parameter.
The runtime sets this to the model's `maxTokens` or a provider default.

**Tool Result Size**: Large tool results may cause `overloaded_error`. The runtime
truncates tool results exceeding a size threshold.

### 2.2 OpenAI

**Function Calling Format**: OpenAI uses a different wire format for tool calls:

```json
// OpenAI format
{
  "tool_calls": [{
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "read_file",
      "arguments": "{\"file_path\": \"/home/user/src/index.ts\"}"
    }
  }]
}

// Normalized to:
{
  "type": "toolCall",
  "id": "call_abc123",
  "name": "read_file",
  "arguments": { "file_path": "/home/user/src/index.ts" }
}
```

**Arguments as String**: OpenAI returns tool arguments as a JSON string, not a parsed
object. The runtime must `JSON.parse` the arguments.

**o-series Models**: Reasoning models (o1, o3, o4-mini) have different capabilities:
- May not support system prompts (use developer messages)
- May not support streaming
- May not support temperature parameter
- May have different max_tokens semantics

### 2.3 Google (Gemini)

**Turn Alternation**: Gemini requires strict user-assistant turn alternation. The
runtime inserts empty user messages when consecutive assistant messages exist:

```
Before:  [assistant] [assistant]  ← Invalid for Gemini
After:   [assistant] [user: ""] [assistant]  ← Valid
```

**Schema Restrictions**: Beyond keyword stripping, Gemini has additional restrictions:
- No `additionalProperties` in tool schemas
- No `$ref` or `$defs`
- Limited support for `oneOf`/`anyOf`

**Tool Result Format**: Gemini uses a different tool result format on the wire:

```json
{
  "functionResponse": {
    "name": "read_file",
    "response": { "content": "file contents..." }
  }
}
```

### 2.4 Ollama

**Model Availability**: Ollama models must be pulled before use. The runtime checks
model availability and provides helpful error messages.

**Streaming**: Ollama uses its own streaming format (not SSE). The runtime has a
custom stream function that bypasses the `pi-ai` registry.

**Tool Support**: Not all Ollama models support tool use. The runtime falls back to
prompt-based tool calling for unsupported models.

### 2.5 OpenAI-Compatible Providers

**Compat Flags**: The OpenAI compatibility layer supports flags for provider quirks:

```typescript
type CompatFlags = {
  noSystemRole?: boolean;        // Use "user" instead of "system" role
  noStreaming?: boolean;         // Disable streaming
  noToolUse?: boolean;           // Disable tool use
  noTemperature?: boolean;       // Don't send temperature parameter
  stringifyToolArgs?: boolean;   // Send tool args as JSON string
  noStopSequences?: boolean;     // Don't send stop sequences
};
```

---

## 3. Message Ordering Edge Cases

### 3.1 Role Ordering Violations

LLM APIs require specific message ordering. Violations are detected and fixed:

```
Rule: User and assistant messages must alternate
Rule: Tool results must follow assistant messages with tool calls
Rule: First message must be from user (for most providers)
```

**Recovery**: The runtime inserts synthetic messages to fix ordering:

```typescript
// If first message is assistant, prepend empty user message
if (messages[0].role === "assistant") {
  messages.unshift({ role: "user", content: "", timestamp: 0 });
}

// If consecutive same-role messages, insert bridging message
for (let i = 1; i < messages.length; i++) {
  if (messages[i].role === messages[i-1].role && messages[i].role !== "toolResult") {
    messages.splice(i, 0, {
      role: messages[i].role === "user" ? "assistant" : "user",
      content: "",
      timestamp: messages[i].timestamp,
    });
  }
}
```

### 3.2 Orphaned Tool Results

Tool results without matching tool calls are problematic:

```
[assistant: text only, no tool calls]
[toolResult: toolCallId="orphan"]  ← No matching tool call
```

**Recovery**: Orphaned tool results are dropped with a warning.

### 3.3 Missing Tool Results

Assistant messages with tool calls but no subsequent tool results:

```
[assistant: toolCall id="abc"]
[user: new message]  ← Tool result missing
```

**Recovery**: Synthetic error tool results are inserted:

```json
{
  "role": "toolResult",
  "toolCallId": "abc",
  "toolName": "unknown",
  "content": [{ "type": "text", "text": "[tool result unavailable]" }],
  "isError": true
}
```

---

## 4. Session Edge Cases

### 4.1 Concurrent Session Access

Multiple processes reading the same session store simultaneously:

```
Process A: read → modify → write
Process B: read → modify → write  ← May overwrite A's changes
```

**Mitigation**: Async lock queue + atomic writes. But across processes (e.g., multiple
gateway instances), last-write-wins semantics apply.

### 4.2 Corrupt JSONL Files

Partial writes or crashes can corrupt JSONL transcripts:

```
{"role":"user","content":"hello","timestamp":1740000000000}
{"role":"assistant","content":[{"type":"te  ← Truncated line
```

**Recovery**: Skip malformed lines during transcript loading. Log a warning.

### 4.3 Session Key Collision

Different channel contexts can produce the same session key:

```
"telegram:12345" could be either a user ID or a group ID
```

**Mitigation**: Session keys include channel-specific qualifiers (group ID, thread ID,
etc.) to avoid collisions.

### 4.4 Large Session Files

Sessions with extensive tool use can produce very large JSONL files:

- File read results (full file contents in tool results)
- Command output (verbose build logs)
- Image data (base64-encoded screenshots)

**Mitigation**: Compaction reduces session size. Individual tool results can be truncated
before persistence.

---

## 5. Context Window Management

### 5.1 Token Counting

Token counting is approximate (provider-dependent):

```
Exact counting: Requires provider-specific tokenizer
Approximate: Character count / 4 (rough estimate)
Cached: Token counts from previous responses used as baseline
```

### 5.2 Context Overflow Detection

```
Scenario: Total tokens exceed model's contextWindow
Detection: HTTP 400 with specific error codes
  - Anthropic: "context_length_exceeded"
  - OpenAI: "context_length_exceeded" or "max_tokens"
  - Google: "RESOURCE_EXHAUSTED"
```

### 5.3 Compaction Failure Modes

| Failure                   | Cause                          | Recovery              |
|---------------------------|--------------------------------|-----------------------|
| Compaction LLM call fails | Provider error                 | Return error          |
| Summary too large         | Many unique topics             | Truncate summary      |
| All messages are recent   | Single large turn              | Cannot compact further|
| Empty session after compact| Logic error                   | Restore from backup   |

---

## 6. Authentication Edge Cases

### 6.1 Token Expiry During Streaming

OAuth tokens can expire mid-stream:

```
Stream starts successfully
[...streaming text...]
401 Unauthorized  ← Token expired mid-stream
```

**Recovery**: Complete partial response, then refresh token and retry on next turn.

### 6.2 All Profiles Exhausted

When all auth profiles are on cooldown:

```
Profile 1: cooldown until T+300
Profile 2: cooldown until T+120
Profile 3: cooldown until T+60
```

**Recovery**: Wait for shortest cooldown, then retry with that profile.

### 6.3 Rate Limit with Retry-After

```
HTTP 429 with Retry-After: 30
```

**Recovery**: Respect `Retry-After` header. Set profile cooldown to that duration.

---

## 7. Tool Execution Edge Cases

### 7.1 Tool Execution Timeout

Tools that run longer than the configured timeout:

```
exec tool: Running `npm install` (takes 120s)
Timeout: 60s
```

**Recovery**: Kill subprocess, return timeout error in tool result.

### 7.2 Tool Abort During Execution

User cancels while a tool is executing:

```
AbortSignal fires during tool execution
Tool must clean up (kill subprocesses, close files)
Return partial result or error
```

### 7.3 Parallel Tool Calls

Some providers request multiple tool calls in a single response:

```json
{
  "content": [
    { "type": "toolCall", "id": "1", "name": "read", "arguments": { "file_path": "a.ts" } },
    { "type": "toolCall", "id": "2", "name": "read", "arguments": { "file_path": "b.ts" } }
  ]
}
```

**Behavior**: Tools are executed sequentially (not in parallel) by default. This ensures
deterministic ordering of side effects.

### 7.4 Recursive Tool Calls

A tool that triggers another agent run (subagent spawning):

```
Agent A calls tool "delegate"
  → Spawns Agent B
    → Agent B calls tools
    → Agent B returns result
  → Agent A receives result as tool output
```

**Depth limit**: `spawnDepth` tracked in session entry to prevent infinite recursion.
