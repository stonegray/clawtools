# 09 — Runtime Model Specification

> Formal specification of the OpenClaw agent runtime.
> Extracted from: `src/runtime.ts`, `src/agents/pi-embedded-runner/`, `src/plugins/runtime/`

---

## 1. Runtime Environment

### 1.1 RuntimeEnv

```typescript
type RuntimeEnv = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
};

// Default runtime
const defaultRuntime: RuntimeEnv = {
  log: console.log,    // With progress line clearing
  error: console.error,
  exit: (code) => {
    restoreTerminalState();
    process.exit(code);
  },
};

// Non-exiting runtime (for tests)
function createNonExitingRuntime(): RuntimeEnv {
  return {
    log: console.log,
    error: console.error,
    exit: (code) => { throw new Error(`exit ${code}`); },
  };
}
```

### 1.2 PluginRuntime

The `PluginRuntime` is a large dependency injection facade:

```typescript
type PluginRuntime = {
  version: string;

  config: {
    loadConfig: LoadConfig;
    writeConfigFile: WriteConfigFile;
  };

  system: {
    enqueueSystemEvent: EnqueueSystemEvent;
    runCommandWithTimeout: RunCommandWithTimeout;
    formatNativeDependencyHint: FormatNativeDependencyHint;
  };

  media: {
    loadWebMedia: LoadWebMedia;
    detectMime: DetectMime;
    mediaKindFromMime: MediaKindFromMime;
    isVoiceCompatibleAudio: IsVoiceCompatibleAudio;
    getImageMetadata: GetImageMetadata;
    resizeToJpeg: ResizeToJpeg;
  };

  tts: {
    textToSpeechTelephony: TextToSpeechTelephony;
  };

  tools: {
    createMemoryGetTool: CreateMemoryGetTool;
    createMemorySearchTool: CreateMemorySearchTool;
    registerMemoryCli: RegisterMemoryCli;
  };

  channel: {
    text: ChannelTextHelpers;
    reply: ChannelReplyHelpers;
    routing: ChannelRoutingHelpers;
    pairing: ChannelPairingHelpers;
    media: ChannelMediaHelpers;
    activity: ChannelActivityHelpers;
    session: ChannelSessionHelpers;
    mentions: ChannelMentionHelpers;
    reactions: ChannelReactionHelpers;
    groups: ChannelGroupHelpers;
    debounce: ChannelDebounceHelpers;
    commands: ChannelCommandHelpers;
    // Channel-specific helpers:
    discord: DiscordHelpers;
    slack: SlackHelpers;
    telegram: TelegramHelpers;
    signal: SignalHelpers;
    imessage: IMessageHelpers;
    whatsapp: WhatsAppHelpers;  // Lazily loaded
    line: LineHelpers;
  };

  logging: {
    shouldLogVerbose: ShouldLogVerbose;
    getChildLogger: GetChildLogger;
  };

  state: {
    resolveStateDir: ResolveStateDir;
  };
};
```

---

## 2. Agent Execution Model

### 2.1 Session Lane Serialization

```
                 Session Lane: "telegram:+1234567890"
                 ┌────────────────────────────────┐
                 │ Only one run at a time per key  │
  Message 1 ──▶ │ ┌─Run 1────────────────────┐   │
  Message 2 ──▶ │ │ (executing)               │   │
  Message 3 ──▶ │ └───────────────────────────┘   │
                 │ ┌─Run 2────────────────────┐   │
                 │ │ (queued)                  │   │
                 │ └───────────────────────────┘   │
                 └────────────────────────────────┘
```

### 2.2 Global Lane (Optional)

When `config.session.serialization = "global"`:

```
                 Global Lane
                 ┌────────────────────────────────┐
                 │ Only one run globally           │
  Session A ──▶ │ ┌─Run─────────────────────┐    │
  Session B ──▶ │ │ (executing)              │    │
                 │ └─────────────────────────┘    │
                 │ ┌─Run─────────────────────┐    │
                 │ │ (queued)                 │    │
                 │ └─────────────────────────┘    │
                 └────────────────────────────────┘
```

### 2.3 Agent Loop Pseudocode

```
function agentLoop(agent, messages, tools, options):
  emit("agent_start")

  while true:
    emit("turn_start")

    // Call LLM
    stream = streamSimple(model, { systemPrompt, messages, tools }, options)

    // Build assistant message from stream
    assistantMessage = AssistantMessage()
    for event in stream:
      emit("message_update", { assistantMessageEvent: event })

      switch event.type:
        case "text_delta":
          assistantMessage.content.appendText(event.delta)
        case "thinking_delta":
          assistantMessage.content.appendThinking(event.delta)
        case "toolcall_end":
          assistantMessage.content.push(event.toolCall)
        case "done":
          assistantMessage.stopReason = event.reason
          assistantMessage.usage = event.message.usage
        case "error":
          assistantMessage.stopReason = "error"

    emit("message_end", { message: assistantMessage })
    messages.push(assistantMessage)

    // Check if we should continue
    if assistantMessage.stopReason != "toolUse":
      break

    // Execute tool calls
    toolCalls = assistantMessage.content.filter(c => c.type == "toolCall")
    toolResults = []

    for toolCall in toolCalls:
      emit("tool_execution_start", { toolCallId, toolName, args })

      // Check for steering messages
      steeringMessages = await getSteeringMessages()
      if steeringMessages.length > 0:
        messages.push(...steeringMessages)

      try:
        result = await tool.execute(toolCall.id, toolCall.arguments, signal)
        isError = false
      catch error:
        result = { content: [{ type: "text", text: errorJson }], details: null }
        isError = true

      emit("tool_execution_end", { toolCallId, toolName, result, isError })

      toolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: result.content,
        details: result.details,
        isError: isError,
        timestamp: Date.now()
      }
      toolResults.push(toolResultMessage)
      messages.push(toolResultMessage)

    emit("turn_end", { message: assistantMessage, toolResults })

    // Check for follow-up messages
    followUps = await getFollowUpMessages()
    if followUps.length > 0:
      messages.push(...followUps)
      continue  // Another turn

    // Continue loop (auto-loop on tool use)

  emit("agent_end", { messages })
  return messages
```

---

## 3. Dependency Injection: `createDefaultDeps`

```typescript
// src/cli/deps.ts
function createDefaultDeps(): DefaultDeps {
  return {
    loadConfig,
    loadSessionStore,
    saveSessionStore,
    resolveStorePath,
    ensureBinary,
    runCommandWithTimeout,
    // ... other dependencies
  };
}
```

This pattern is used throughout the CLI commands and agent runtime.

---

## 4. Process Lifecycle

### 4.1 CLI Entry

```
openclaw.mjs
  │
  ├── Load .env, normalize env
  ├── Enable console capture
  ├── Assert supported runtime (Node 22+)
  ├── Install error handlers
  ├── Build Commander program
  └── Parse CLI args
       │
       ├── openclaw agent --message "..."
       │     └── runEmbeddedPiAgent(...)
       │
       ├── openclaw gateway run
       │     └── Start HTTP server + channel monitors
       │
       ├── openclaw config set key value
       │     └── Modify config file
       │
       └── openclaw channels status
             └── Probe channel connections
```

### 4.2 Gateway Lifecycle

```
Gateway Server
     │
     ├── Start HTTP server on configured port
     ├── Load plugins (tools, channels, hooks, providers)
     ├── Start channel monitors
     │     ├── Telegram polling
     │     ├── Discord WebSocket
     │     ├── Slack Socket Mode
     │     └── ...
     ├── Start plugin services
     │
     ├── [Event Loop]
     │     ├── Receive inbound message
     │     ├── Route to agent
     │     ├── Execute agent run
     │     └── Dispatch reply
     │
     └── Shutdown
           ├── Stop channel monitors
           ├── Stop plugin services
           └── Close HTTP server
```

---

## 5. Error Handling Model

### 5.1 Unhandled Rejection Handler

```typescript
process.on("unhandledRejection", (error) => {
  console.error("[openclaw] Unhandled rejection:", formatUncaughtError(error));
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("[openclaw] Uncaught exception:", formatUncaughtError(error));
  process.exit(1);
});
```

### 5.2 Agent Run Error Handling

```
try:
  result = runEmbeddedPiAgent(params)
catch error:
  if isContextOverflow(error):
    compact and retry
  elif isAuthError(error):
    rotate profile and retry
  elif isRateLimit(error):
    cooldown and retry
  elif isAborted(error):
    return { meta: { aborted: true } }
  else:
    return { meta: { error: { kind, message } } }
```

---

## 6. Signal Handling

### 6.1 AbortSignal Propagation

```
User cancellation
     │
     ├── AbortController.abort()
     │
     ├── Signal propagated to:
     │     ├── LLM stream (fetch abort)
     │     ├── Tool execution (signal parameter)
     │     ├── Background processes (SIGTERM)
     │     └── Subprocess cleanup
     │
     └── Result: { meta: { aborted: true } }
```

### 6.2 Process Signal Handling

```
SIGINT / SIGTERM
     │
     ├── Restore terminal state
     ├── Cancel active agent runs
     ├── Save session state
     └── Exit cleanly
```

---

## 7. Logging Model

### 7.1 Structured Logging

```typescript
// Subsystem logger
const logger = createSubsystemLogger("plugins");
logger.info("Plugin loaded: telegram");
logger.warn("Plugin config invalid");
logger.error("Plugin failed to load");

// With child loggers
const childLogger = logger.child({ pluginId: "telegram" });
```

### 7.2 Console Capture

All `console.log/warn/error` output is captured into structured logs while preserving stdout/stderr behavior.

---

## 8. Concurrency Model

| Resource         | Serialization         | Scope          |
|------------------|-----------------------|----------------|
| Session runs     | Per-session queue      | Session key    |
| Global runs      | Optional global queue  | All sessions   |
| Config writes    | File lock              | Config file    |
| Session writes   | Async lock queue       | Store file     |
| Plugin loading   | Synchronous (cache)    | Process-wide   |
| Tool execution   | None (parallel)        | Per-turn       |
| Hook dispatch    | Priority-ordered       | Per-event      |
