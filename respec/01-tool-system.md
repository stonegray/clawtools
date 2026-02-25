# 01 — Tool System Specification

> Formal specification of the OpenClaw tool system.
> Extracted from: `src/agents/pi-tools.ts`, `src/agents/tools/common.ts`, `src/agents/tool-catalog.ts`

---

## 1. Tool Interface Contract

### 1.1 Core Type: `AgentTool<TParameters, TDetails>`

Source: `@mariozechner/pi-agent-core`

```typescript
interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;  // @sinclair/typebox schema → compiles to JSON Schema
}

interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any>
  extends Tool<TParameters> {
  label: string;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}
```

### 1.2 OpenClaw Extension: `AnyAgentTool`

Source: `src/agents/tools/common.ts`

```typescript
type AnyAgentTool = AgentTool<any, unknown> & {
  ownerOnly?: boolean;  // If true, only owner senders can use this tool
};
```

### 1.3 Tool Result

```typescript
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}

// Content block types
interface TextContent     { type: "text";  text: string; }
interface ImageContent    { type: "image"; data: string; mimeType: string; }
```

### 1.4 Tool Update Callback

```typescript
type AgentToolUpdateCallback<TDetails> = (partial: {
  content?: (TextContent | ImageContent)[];
  details?: TDetails;
}) => void;
```

---

## 2. Built-in Tool Catalog

Source: `src/agents/tool-catalog.ts`

### 2.1 Tool Sections

| Section      | Tools                                                    |
|--------------|----------------------------------------------------------|
| **Files**    | `read`, `write`, `edit`, `apply_patch`                   |
| **Runtime**  | `exec`, `process`                                        |
| **Web**      | `web_search`, `web_fetch`                                |
| **Memory**   | `memory_search`, `memory_get`                            |
| **Sessions** | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `subagents`, `session_status` |
| **UI**       | `browser`, `canvas`                                      |
| **Messaging**| `message`                                                |
| **Automation**| `cron`, `gateway`                                       |
| **Nodes**    | `nodes`                                                  |
| **Agents**   | `agents_list`                                            |
| **Media**    | `image`, `tts`                                           |

### 2.2 Tool Profiles

| Profile      | Included Tools                                          |
|--------------|---------------------------------------------------------|
| `minimal`    | `session_status`                                        |
| `coding`     | `read`, `write`, `edit`, `apply_patch`, `exec`, `process`, `memory_search`, `memory_get`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `subagents`, `session_status`, `image` |
| `messaging`  | `sessions_list`, `sessions_history`, `sessions_send`, `session_status`, `message` |
| `full`       | All tools (no restrictions)                              |

### 2.3 Tool Groups

Groups are prefixed with `group:` and map to sections:

```typescript
const CORE_TOOL_GROUPS = {
  "group:openclaw": [...], // All tools with includeInOpenClawGroup=true
  "group:fs": ["read", "write", "edit", "apply_patch"],
  "group:runtime": ["exec", "process"],
  "group:web": ["web_search", "web_fetch"],
  "group:memory": ["memory_search", "memory_get"],
  "group:sessions": ["sessions_list", ...],
  "group:ui": ["browser", "canvas"],
  "group:messaging": ["message"],
  "group:automation": ["cron", "gateway"],
  "group:nodes": ["nodes"],
  "group:agents": ["agents_list"],
  "group:media": ["image", "tts"],
};
```

---

## 3. Tool Registration Metadata Schema

### 3.1 Core Tool Definition

```typescript
type CoreToolDefinition = {
  id: string;                         // Canonical tool name
  label: string;                      // Display label
  description: string;                // Human-readable description
  sectionId: string;                  // Section grouping
  profiles: ToolProfileId[];          // Which profiles include this tool
  includeInOpenClawGroup?: boolean;   // Included in group:openclaw
};
```

### 3.2 Plugin Tool Registration

```typescript
type PluginToolRegistration = {
  pluginId: string;                          // Owning plugin ID
  factory: OpenClawPluginToolFactory;        // Factory or direct tool
  names: string[];                           // Registered tool names
  optional: boolean;                         // Can be omitted from tool list
  source: string;                            // Source file path
};

type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;

type OpenClawPluginToolContext = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  sandboxed?: boolean;
};
```

---

## 4. Tool Parameter Schemas

Parameters use `@sinclair/typebox` which compiles to JSON Schema at runtime.

### 4.1 Schema Construction Patterns

```typescript
import { Type } from "@sinclair/typebox";

// String parameter
Type.String({ description: "File path to read" })

// Optional parameter
Type.Optional(Type.String({ description: "Working directory" }))

// Number parameter
Type.Number({ description: "Maximum characters", minimum: 100 })

// Boolean parameter
Type.Optional(Type.Boolean({ description: "Run in background" }))

// String enum (safe for all providers)
Type.Unsafe<"markdown" | "text">({
  type: "string",
  enum: ["markdown", "text"],
  description: "Extraction mode"
})

// Object parameter
Type.Object({
  command: Type.String({ description: "Shell command" }),
  workdir: Type.Optional(Type.String()),
})

// Record/Map parameter
Type.Optional(Type.Record(Type.String(), Type.String()))
```

### 4.2 Schema Guardrails

**DO NOT USE** in tool input schemas:
- `Type.Union` — produces `anyOf` which some providers reject
- `null` variants — use `Type.Optional(...)` instead
- `format` as a property name — some validators treat it as reserved

**USE INSTEAD**:
- `stringEnum` / `optionalStringEnum` — `Type.Unsafe` with enum constraint
- `Type.Optional(...)` instead of `... | null`
- Top-level schema must be `type: "object"` with `properties`

### 4.3 Provider-Specific Schema Cleaning

#### Gemini Sanitization

Strips unsupported JSON Schema keywords before sending to Google APIs:

```typescript
const GEMINI_UNSUPPORTED_KEYWORDS = [
  "patternProperties", "additionalProperties", "$schema", "$id", "$ref",
  "$defs", "definitions", "examples", "minLength", "maxLength",
  "minimum", "maximum", "multipleOf", "pattern", "format",
  "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties",
];
```

Also:
- Flattens `anyOf`/`oneOf` literal unions into flat `enum`
- Strips null variants
- Resolves `$ref` pointers

#### General Normalization

`normalizeToolParameters()` ensures:
- Root schema is always `type: "object"` with `properties`
- Provider-specific keyword cleaning based on `modelProvider`

---

## 5. Tool Parameter Reading Utilities

Source: `src/agents/tools/common.ts`

### 5.1 Parameter Readers

```typescript
// Read a string parameter (with automatic camelCase → snake_case fallback)
readStringParam(params, "filePath", { required: true })

// Read numeric parameter
readNumberParam(params, "maxChars", { required: false, integer: true })

// Read string array (auto-wraps single strings)
readStringArrayParam(params, "urls", { required: true })

// Read string-or-number (coerces numbers to strings)
readStringOrNumberParam(params, "threadId")
```

### 5.2 Key Behaviors

- **Snake-case fallback**: `readParamRaw` checks both `camelCase` and `snake_case` keys
- **Trimming**: Strings are trimmed by default (`trim: true`)
- **Empty handling**: Empty strings treated as missing unless `allowEmpty: true`
- **Type coercion**: Numbers accepted for string params, strings parsed for number params

---

## 6. Tool Result Helpers

```typescript
// JSON result (most common)
function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

// Image result
async function imageResult(params: {
  label: string;
  path: string;
  base64: string;
  mimeType: string;
  extraText?: string;
  details?: Record<string, unknown>;
  imageSanitization?: ImageSanitizationLimits;
}): Promise<AgentToolResult<unknown>>

// Image from file path
async function imageResultFromFile(params: {
  label: string;
  path: string;
  imageSanitization?: ImageSanitizationLimits;
}): Promise<AgentToolResult<unknown>>
```

---

## 7. Tool Error Model

### 7.1 Error Types

```typescript
class ToolInputError extends Error {
  readonly status: number = 400;  // Bad request
}

class ToolAuthorizationError extends ToolInputError {
  readonly status: number = 403;  // Forbidden
}
```

### 7.2 Error Propagation

When a tool throws, the `pi-tool-definition-adapter` wraps the error:

```json
{
  "status": "error",
  "tool": "exec",
  "error": "command required"
}
```

The error is returned as a `ToolResultMessage` with `isError: true`, allowing the LLM to retry with corrected parameters.

### 7.3 Owner-Only Restriction

Tools with `ownerOnly: true` are wrapped to throw `OWNER_ONLY_TOOL_ERROR` for non-owner senders:

```typescript
const OWNER_ONLY_TOOL_ERROR = "Tool restricted to owner senders.";
```

---

## 8. Tool Assembly Pipeline

Source: `src/agents/pi-tools.ts` → `createOpenClawCodingTools()`

### 8.1 Assembly Sequence

```
1. Resolve effective tool policy (profile + global + agent + provider + group)
2. Resolve exec config (host, security, ask, sandbox, etc.)
3. Resolve filesystem policy (workspaceOnly)
4. Assemble base coding tools (from @mariozechner/pi-coding-agent):
   - read  → wrap with workspace guard, sandbox bridge, or model-context scaling
   - write → wrap with param normalization (Claude Code compat)
   - edit  → wrap with param normalization
   - exec  → replaced with OpenClaw's createExecTool (richer)
5. Add exec tool with full config
6. Add process tool for background process management
7. Add apply_patch tool (OpenAI provider only, gated by model allowlist)
8. Add channel agent tools (e.g., whatsapp_login)
9. Add OpenClaw platform tools:
   - web_search, web_fetch
   - memory_search, memory_get
   - sessions_list, sessions_history, sessions_send, sessions_spawn
   - subagents, session_status
   - browser, canvas
   - message, cron, gateway
   - nodes, agents_list
   - image, tts
10. Apply owner-only tool policy
11. Apply tool policy pipeline (profile → global → agent → group → sandbox → subagent)
12. Normalize tool parameters (provider-specific schema cleaning)
13. Wrap with before_tool_call hook
14. Wrap with abort signal propagation
```

### 8.2 Tool Policy Pipeline

```typescript
type ToolPolicyPipelineStep = {
  policy?: { allow?: string[]; deny?: string[] };
  label: string;
};

function applyToolPolicyPipeline(params: {
  tools: AnyAgentTool[];
  toolMeta: (tool: AnyAgentTool) => { pluginId?: string } | undefined;
  warn: (msg: string) => void;
  steps: ToolPolicyPipelineStep[];
}): AnyAgentTool[]
```

Each step can filter tools by `allow` (whitelist) or `deny` (blacklist). Steps are applied in order:

1. Profile policy (e.g., `coding` → only coding tools)
2. Provider-specific profile policy
3. Global policy (`config.tools.allow/deny`)
4. Global provider policy
5. Agent-specific policy
6. Agent provider policy
7. Group policy (channel/group-level)
8. Sandbox tools policy
9. Subagent tools policy

---

## 9. Tool Lifecycle Hooks

### 9.1 `before_tool_call`

Runs **before** each tool execution. Can:
- Modify parameters
- Block execution entirely
- Return a custom result

```typescript
type BeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
};

type BeforeToolCallResult = {
  params?: Record<string, unknown>;  // Modified params
  block?: boolean;                   // Block execution
  blockReason?: string;              // Reason for blocking
} | void;
```

### 9.2 `after_tool_call`

Runs **after** each tool execution. Observation-only.

```typescript
type AfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  result: AgentToolResult<unknown>;
  isError: boolean;
  durationMs: number;
};
```

### 9.3 `tool_result_persist`

Runs before persisting a tool result to the session transcript. Can rewrite the message content.

---

## 10. Sandbox / Isolation Model

### 10.1 Sandbox Context

```typescript
type SandboxContext = {
  enabled: boolean;
  containerName: string;           // Docker/Podman container name
  workspaceDir: string;            // Host workspace path
  containerWorkdir?: string;       // Container workspace path
  workspaceAccess: "rw" | "ro";    // Read-write or read-only
  fsBridge?: FsBridge;             // Host ↔ container filesystem bridge
  docker: { env?: Record<string, string> };
  browser?: { bridgeUrl?: string };
  browserAllowHostControl: boolean;
  tools?: { allow?: string[]; deny?: string[] };
};
```

### 10.2 Execution Hosts

The `exec` tool supports three hosts:

| Host       | Description                          |
|------------|--------------------------------------|
| `gateway`  | Run via Docker/Podman exec           |
| `host`     | Direct host execution                |
| `node`     | Node.js child_process                |

### 10.3 Security Modes

| Mode       | Description                          |
|------------|--------------------------------------|
| `safe-bin` | Only whitelisted binaries            |
| `paranoid` | Extra restrictions                   |
| `full`     | No restrictions                      |

### 10.4 Approval Modes

| Mode       | Description                          |
|------------|--------------------------------------|
| `auto`     | Automatic approval                   |
| `smart`    | Context-aware approval               |
| `always`   | Always require approval              |
