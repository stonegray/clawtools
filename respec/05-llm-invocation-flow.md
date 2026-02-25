# 05 — LLM Invocation Flow

> Formal specification of the complete LLM invocation lifecycle.
> Extracted from: `src/agents/pi-embedded-runner/run.ts`, `src/agents/pi-embedded-subscribe.ts`

---

## 1. Entry Point: `runEmbeddedPiAgent`

### 1.1 Parameters (Key Fields)

```typescript
type RunEmbeddedPiAgentParams = {
  // Identity
  agentId?: string;
  sessionKey: string;
  agentDir?: string;
  workspaceDir?: string;

  // Message
  prompt: string;
  images?: Array<{ data: string; mimeType: string }>;

  // Model
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;

  // Channel context
  messageProvider?: string;
  agentAccountId?: string;
  messageTo?: string;
  messageThreadId?: string | number;
  senderId?: string;
  senderName?: string;

  // Configuration
  config?: OpenClawConfig;
  abortSignal?: AbortSignal;

  // Streaming callbacks
  onBlockReply?: (text: string) => void;
  onBlockReplyFlush?: () => void;
  onToolExecutionStart?: (meta: ToolMeta) => void;
  onToolExecutionEnd?: (meta: ToolMeta) => void;
  onStreamingTextDelta?: (delta: string) => void;
};
```

### 1.2 Result

```typescript
type EmbeddedPiRunResult = {
  payloads?: Array<{
    text?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    replyToId?: string;
    isError?: boolean;
  }>;
  meta: EmbeddedPiRunMeta;
  didSendViaMessagingTool?: boolean;
  messagingToolSentTexts?: string[];
  messagingToolSentMediaUrls?: string[];
  messagingToolSentTargets?: MessagingToolSend[];
  successfulCronAdds?: number;
};

type EmbeddedPiRunMeta = {
  durationMs: number;
  agentMeta?: EmbeddedPiAgentMeta;
  aborted?: boolean;
  error?: {
    kind: "context_overflow" | "compaction_failure" | "role_ordering"
        | "image_size" | "retry_limit";
    message: string;
  };
  stopReason?: string;
  pendingToolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
};

type EmbeddedPiAgentMeta = {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  turnCount: number;
};
```

---

## 2. Full Invocation Sequence

```
runEmbeddedPiAgent(params)
  │
  ├── [PHASE 1: Pre-resolution]
  │     ├── Acquire session lane (serialization queue)
  │     ├── Acquire global lane (optional global serialization)
  │     ├── Resolve workspace directory
  │     ├── Run before_model_resolve hooks
  │     │     → May return { modelOverride, providerOverride }
  │     ├── Run before_agent_start hooks (legacy)
  │     │     → May return { modelOverride, providerOverride, systemPrompt }
  │     └── Merge hook overrides with params
  │
  ├── [PHASE 2: Model & Auth Resolution]
  │     ├── resolveModel(provider, modelId)
  │     │     → Returns Model<Api> descriptor
  │     ├── evaluateContextWindowGuard()
  │     │     → Block if context window too small
  │     ├── ensureAuthProfileStore()
  │     │     → Load/create auth profile store
  │     ├── resolveAuthProfileOrder()
  │     │     → Ordered list of auth profile candidates
  │     └── Apply runtime model adjustments
  │
  ├── [PHASE 3: Retry Loop] ──────────────────────────────┐
  │     │                                                   │
  │     ├── Select auth profile (next in rotation)          │
  │     ├── Apply API key from profile                      │
  │     │                                                   │
  │     ├── [PHASE 4: Attempt] ───────────────────────┐    │
  │     │     │                                        │    │
  │     │     ├── Load SessionManager                  │    │
  │     │     │     └── Read JSONL transcript           │    │
  │     │     ├── Run before_prompt_build hooks         │    │
  │     │     │     → { systemPrompt?, prependContext? }│    │
  │     │     ├── Build system prompt                   │    │
  │     │     │     ├── Identity block                  │    │
  │     │     │     ├── Skills/instructions             │    │
  │     │     │     ├── Workspace context               │    │
  │     │     │     └── Tool documentation              │    │
  │     │     ├── Assemble tools                        │    │
  │     │     │     └── createOpenClawCodingTools()     │    │
  │     │     ├── Sanitize session history              │    │
  │     │     │     └── Provider-specific fixes         │    │
  │     │     ├── Build API payload                     │    │
  │     │     │     ├── messages: AgentMessage[]        │    │
  │     │     │     ├── systemPrompt: string            │    │
  │     │     │     ├── tools: AgentTool[]              │    │
  │     │     │     └── streamOptions: SimpleStreamOptions│   │
  │     │     ├── Run llm_input hook                    │    │
  │     │     │                                        │    │
  │     │     ├── [PHASE 5: Agent Loop] ─────────┐     │    │
  │     │     │     │                             │     │    │
  │     │     │     ├── Call streamSimple()        │     │    │
  │     │     │     │     └── Yields stream events│     │    │
  │     │     │     ├── Process stream events      │     │    │
  │     │     │     │     ├── text_delta → chunk   │     │    │
  │     │     │     │     ├── thinking_delta       │     │    │
  │     │     │     │     └── toolcall_end         │     │    │
  │     │     │     │                             │     │    │
  │     │     │     ├── If toolUse:               │     │    │
  │     │     │     │     ├── Execute tools       │     │    │
  │     │     │     │     ├── Append results      │     │    │
  │     │     │     │     └── Loop back ──────────┘     │    │
  │     │     │     │                                   │    │
  │     │     │     └── If stop/length: continue        │    │
  │     │     │                                        │    │
  │     │     ├── Run llm_output hook                   │    │
  │     │     ├── Run agent_end hook                    │    │
  │     │     └── Return result ───────────────────────┘    │
  │     │                                                   │
  │     ├── [ERROR HANDLING]                                │
  │     │     ├── Context overflow → compact + retry ───────┤
  │     │     ├── Auth error → rotate profile + retry ──────┤
  │     │     ├── Rate limit → cooldown + retry ────────────┤
  │     │     ├── Thinking unsupported → downgrade + retry ─┤
  │     │     └── Fatal error → return error                │
  │     │                                                   │
  │     └────────────────────────────────────────────────────┘
  │
  └── [PHASE 6: Post-processing]
        ├── Update session metadata (tokens, model, timestamps)
        ├── Save session store
        └── Return EmbeddedPiRunResult
```

---

## 3. Stream Subscription Layer

### 3.1 `subscribeEmbeddedPiSession`

This function subscribes to the `pi-agent-core` event stream and processes events:

```typescript
function subscribeEmbeddedPiSession(params: {
  agent: Agent;
  onBlockReply: (text: string) => void;
  onBlockReplyFlush: () => void;
  onToolExecutionStart: (meta: ToolMeta) => void;
  onToolExecutionEnd: (meta: ToolMeta) => void;
  onStreamingTextDelta: (delta: string) => void;
}): Promise<SubscriptionResult>
```

### 3.2 Event Processing Pipeline

```
AgentEvent (from pi-agent-core)
     │
     ├── message_update
     │     ├── text_delta → accumulate text
     │     │     ├── Strip <think>/<answer> tags
     │     │     ├── Detect code blocks
     │     │     └── Chunk for block reply dispatch
     │     ├── thinking_delta → accumulate thinking
     │     └── toolcall_end → record tool metadata
     │
     ├── tool_execution_start
     │     └── Emit onToolExecutionStart callback
     │
     ├── tool_execution_end
     │     ├── Check for messaging tool sends
     │     ├── Track sent texts for dedup
     │     └── Emit onToolExecutionEnd callback
     │
     ├── message_end
     │     ├── Flush remaining text
     │     └── Record assistant message
     │
     ├── turn_end
     │     └── Accumulate usage stats
     │
     └── agent_end
           ├── Final usage aggregation
           └── Build result payloads
```

### 3.3 Block Reply Chunking

Text is chunked for delivery to messaging channels:

```
"Hello, I found the solution. Here's the code:\n```typescript\n..."
     │
     ├── Chunk 1: "Hello, I found the solution."
     ├── Chunk 2: "Here's the code:\n```typescript\n..."
     └── Chunk 3: "```" (close)
```

Chunking respects:
- Paragraph boundaries
- Code block boundaries (fenced blocks kept intact or re-opened)
- Configurable max chunk size
- Platform-specific limits

---

## 4. Usage Tracking

### 4.1 Per-Turn Usage

Each LLM call returns usage in the `AssistantMessage`:

```typescript
interface Usage {
  input: number;       // Input tokens
  output: number;      // Output tokens
  cacheRead: number;   // Cache read tokens
  cacheWrite: number;  // Cache write tokens
  totalTokens: number; // Total tokens
  cost: {
    input: number;     // Input cost ($)
    output: number;    // Output cost ($)
    cacheRead: number; // Cache read cost ($)
    cacheWrite: number;// Cache write cost ($)
    total: number;     // Total cost ($)
  };
}
```

### 4.2 Multi-Turn Aggregation

Across tool-call loops, usage is accumulated:
- `input`, `output` tokens are **summed**
- `cacheRead`, `cacheWrite` use the **last call's values** (to avoid inflation)
- Costs are summed across all turns

---

## 5. Serialization / Queuing

### 5.1 Session Lane

Each session key has a serialization queue. Only one agent run per session at a time:

```
Session "telegram:user123"
     │
     ├── Run 1 (in progress)
     ├── Run 2 (queued)
     └── Run 3 (queued)
```

### 5.2 Global Lane

Optional global serialization across all sessions:

```typescript
// Useful for rate-limited providers
config.session.serialization = "global"
```

---

## 6. Compaction

When context overflow occurs, the session is compacted:

```
1. Detect context overflow error from LLM
2. Load full session transcript
3. Summarize older messages (keep recent window)
4. Replace old messages with summary
5. Retry LLM call with compacted session
6. If compaction fails → return error
```

Compaction is tracked in session metadata:
```typescript
sessionEntry.compactionCount // Incremented on each compaction
```

---

## 7. Steering & Follow-up Messages

### 7.1 Steering Messages

Users can inject messages during an active agent run:

```typescript
agent.getSteeringMessages = async () => {
  // Check for new user messages sent during tool execution
  return pendingMessages.splice(0);
};
```

Steering messages:
- Interrupt the current tool execution
- Are prepended to the next LLM call
- Can redirect the agent's behavior

### 7.2 Follow-up Messages

After the agent would normally stop, follow-up messages can force continuation:

```typescript
agent.getFollowUpMessages = async () => {
  // Check for messages that arrived while agent was running
  return followUpQueue.splice(0);
};
```

---

## 8. Error Taxonomy

| Error Kind            | Retryable | Action                          |
|-----------------------|-----------|----------------------------------|
| `context_overflow`    | Yes       | Compact session, retry           |
| `compaction_failure`  | No        | Return error                     |
| `role_ordering`       | Yes       | Fix message ordering, retry      |
| `image_size`          | No        | Return error                     |
| `retry_limit`         | No        | Return error                     |
| Auth 401              | Yes       | Rotate auth profile, retry       |
| Rate limit 429        | Yes       | Cooldown profile, retry          |
| Thinking unsupported  | Yes       | Downgrade thinking, retry        |
| Network error         | Yes       | Exponential backoff, retry       |
| Timeout               | No        | Return error                     |
| Abort (signal)        | No        | Return { aborted: true }         |
