# MCPtools Integration Strategy: Unified Tool Interface for MCP + OpenClaw

**Status:** Draft for human review  
**Date:** 2026-02-26  
**Scope:** Architecture decision for MCPtools — a new project that loads arbitrary MCP servers (including streamable/HTTP MCPs) alongside OpenClaw tools under a single unified interface.

---

## 1. Background & Goal

[clawtools](../README.md) currently exposes OpenClaw's tool and connector systems as a standalone library. The goal of MCPtools is to extend this into a **unified tool interface** where both:

- **OpenClaw tools** (the `AgentTool` / `execute()` model, plugin-registered)
- **MCP servers** (any transport: stdio subprocess, Streamable HTTP, legacy SSE)

…can be loaded, listed, and invoked through one consistent API surface — so an LLM agent loop needs only one `Tool[]` array regardless of where each tool originates.

---

## 2. Protocol Reference Summary

### 2.1 OpenClaw Tool Wire Model

The OpenClaw / clawtools `Tool` interface (from `src/types.ts`):

```typescript
interface Tool {
  name: string;
  label?: string;
  description: string;
  parameters: object;      // JSON Schema, top-level type:object
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
  ) => Promise<ToolResult>;
  ownerOnly?: boolean;
}

interface ToolResult {
  content: (TextContent | ImageContent)[];
  details?: unknown;
}
```

**Key characteristics:**

| Dimension | Detail |
|-----------|--------|
| Transport | In-process function call (no network) |
| Schema format | TypeBox → JSON Schema (top-level `type:object` required) |
| Content types | `text`, `image` (base64) |
| Streaming | `onUpdate` callback for progressive partial results |
| Cancellation | `AbortSignal` threaded into `execute()` |
| Session state | Stateless per-call; context passed via `ToolContext` at factory time |
| Error model | Thrown `ToolInputError` / `ToolAuthorizationError`, or `isError` in result |
| Registration | `api.registerTool(tool | factory)` in plugin `register()` |
| Lifecycle hooks | `before_tool_call`, `after_tool_call`, `tool_result_persist` (OpenClaw runtime only) |
| Multi-tool | Single invocation returns a single `ToolResult` |
| Owner restriction | `ownerOnly: true` flag |

### 2.2 MCP Tool Wire Model (spec rev 2025-03-26)

The MCP protocol (JSON-RPC 2.0 over stdio or Streamable HTTP):

**Tool definition** (from `tools/list` response):
```json
{
  "name": "get_weather",
  "description": "Get current weather information for a location",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": { "type": "string", "description": "City name or zip code" }
    },
    "required": ["location"]
  },
  "annotations": { ... }
}
```

**Tool invocation** (`tools/call` request/response):
```json
// Request
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "get_weather", "arguments": { "location": "New York" } } }

// Response
{ "jsonrpc": "2.0", "id": 2, "result": {
    "content": [
      { "type": "text", "text": "Temperature: 72°F" },
      { "type": "image", "data": "base64...", "mimeType": "image/png" },
      { "type": "audio", "data": "base64...", "mimeType": "audio/wav" },
      { "type": "resource", "resource": { "uri": "resource://...", "text": "..." } }
    ],
    "isError": false
  }
}
```

**Key characteristics:**

| Dimension | Detail |
|-----------|--------|
| Transport | stdio (subprocess) or Streamable HTTP (SSE + POST) |
| Schema format | Standard JSON Schema (no restrictions on root type) |
| Content types | `text`, `image`, `audio`, `resource` (embedded URI) |
| Streaming | Not in tools — MCP has no per-call progress stream (notifications exist at session level) |
| Cancellation | `notifications/cancelled` JSON-RPC notification |
| Session state | Stateful: `initialize` handshake, capability negotiation, optional `Mcp-Session-Id` header |
| Error model | JSON-RPC protocol error (`error.code`) OR `isError: true` in result content |
| Registration | Server process declares tools; client discovers via `tools/list` |
| Lifecycle hooks | None in protocol; client-side only |
| Multi-tool | N/A — one `tools/call` per tool invocation |
| Owner restriction | Not in protocol; must be implemented client-side |
| List changes | `notifications/tools/list_changed` when server pushes updates |
| Resources | Additional concept: `resources/list`, `resources/read` (no OpenClaw equivalent) |
| Prompts | Additional concept: `prompts/list`, `prompts/get` (no OpenClaw equivalent) |
| Sampling | Server can request LLM completions from client (no OpenClaw equivalent) |

### 2.3 MCP Transport Details

**stdio:**
- Client spawns server as a child process
- Newline-delimited JSON-RPC over stdin/stdout
- Server stderr is logging only
- Simple: no session IDs, no HTTP

**Streamable HTTP (2025-03-26):**
- Server is a persistent HTTP process; one MCP endpoint supports both POST and GET
- `POST /mcp` → send JSON-RPC message, get back `application/json` or `text/event-stream` (SSE)
- `GET /mcp` → open a long-lived SSE stream for server-initiated notifications
- Optional `Mcp-Session-Id` header for stateful sessions (server assigns at `InitializeResult`)
- Client must send `Accept: application/json, text/event-stream`
- Resumability: SSE event IDs + `Last-Event-ID` header for reconnect
- `DELETE /mcp` to terminate session
- Multiple SSE connections allowed simultaneously

---

## 3. Structural Comparison

| Concern | OpenClaw Tool | MCP Tool |
|---------|---------------|----------|
| **Invocation** | `tool.execute(id, params, signal, onUpdate)` | `tools/call` JSON-RPC over transport |
| **Schema field name** | `parameters` | `inputSchema` |
| **Schema root** | Must be `type:object` | Any valid JSON Schema |
| **Content: text** | ✅ `{ type: "text", text }` | ✅ `{ type: "text", text }` — identical |
| **Content: image** | ✅ `{ type: "image", data, mimeType }` | ✅ `{ type: "image", data, mimeType }` — identical |
| **Content: audio** | ❌ not supported | ✅ `{ type: "audio", data, mimeType }` |
| **Content: resource** | ❌ not supported | ✅ `{ type: "resource", resource: { uri, ... } }` |
| **Progressive updates** | ✅ `onUpdate` callback | ❌ no per-call streaming |
| **Cancellation** | ✅ `AbortSignal` | ✅ `notifications/cancelled` |
| **isError flag** | ✅ in result | ✅ in result |
| **Session state** | ❌ (stateless; context at factory time) | ✅ (server maintains session) |
| **Lifecycle** | Stateful factory context, hooks | Stateful MCP session + capability negotiation |
| **List changes** | ❌ (static after plugin load) | ✅ `notifications/tools/list_changed` |
| **Resources** | ❌ | ✅ first-class |
| **Prompts** | ❌ | ✅ first-class |
| **Sampling (server→LLM)** | ❌ | ✅ server can ask client to do LLM call |
| **Multiple transports** | N/A (in-process) | stdio, Streamable HTTP |
| **Multi-server** | N/A | Multiple concurrent MCP server connections |
| **Security/auth** | `ownerOnly`, profile auth, sandbox isolation | Origin validation, session token, per-server |
| **Schema quirks** | `anyOf`, `oneOf` banned; provider normalization needed | No restrictions in protocol |
| **Display label** | `label` field separate from `name` | `description` only; no label |

---

## 4. The Three Integration Strategies

### Option A — Adapt MCP to OpenClaw's `Tool` interface

Make MCP tools look like OpenClaw tools. An `MCPToolAdapter` wraps each MCP tool's `tools/call` invocation as a `Tool.execute()` method. The `ToolRegistry` sees only `Tool` objects.

```
MCP Server (stdio/HTTP)
     │  JSON-RPC tools/call
     ▼
MCPServerClient  (manages session, transport, reconnect)
     │  wraps each tool as
     ▼
Tool { name, description, parameters, execute() }
     │  registered into
     ▼
ToolRegistry  (same as OpenClaw tools)
     │  consumed by
     ▼
LLM Agent Loop
```

**What needs mapping:**

| MCP | → | OpenClaw Tool |
|-----|---|---------------|
| `tool.inputSchema` | → | `tool.parameters` |
| `tools/call` response `.content` | → | `ToolResult.content` (drop `audio`, `resource`) |
| `notifications/cancelled` | ← | `AbortSignal` listener |
| Session management | hidden | inside adapter |
| `notifications/tools/list_changed` | → | re-register tools in registry |
| `tool.annotations` | → | `ownerOnly` + metadata |
| Audio content | 🔴 dropped / converted to text description | |
| Resource content | 🔴 dropped or URI returned as text | |
| MCP Resources (non-tool) | 🔴 not surfaced | |
| MCP Prompts | 🔴 not surfaced | |
| Sampling (server→client) | 🔴 not supported | |

**Pros:**
- ✅ Zero changes to `ToolRegistry`, `clawtools` API, or any OpenClaw plugin code
- ✅ Agent loop consumes one `Tool[]` — no new abstractions
- ✅ Minimal surface area; easy to implement, test, and maintain
- ✅ Schema normalization (provider quirks, Gemini cleaning) applies uniformly to all tools
- ✅ Progressive update `onUpdate` can be emitted for long-running MCP calls (polled or estimated)
- ✅ `ownerOnly` policy and tool policy pipeline work without changes
- ✅ Straightforward to add to clawtools as a new sub-package (`mcptools/`)

**Cons:**
- 🔴 MCP `audio` content type is dropped (no equivalent in OpenClaw)
- 🔴 MCP `resource` content type must be degraded to text (URI + text representation)
- 🔴 MCP Resources, Prompts, Sampling — entirely out of scope; need separate handling or ignored
- 🔴 `list_changed` notifications require live re-registration; ToolRegistry would need an update mechanism
- 🔴 No way for MCP tools to surface their `annotations` in a structured, typed way
- 🔴 Single MCP server failure/reconnect is hidden inside the adapter — hard to surface diagnostics

---

### Option B — Adapt OpenClaw tools to MCP's `tools/call` interface

Turn clawtools into an MCP server that exposes OpenClaw tools via the MCP protocol. Any MCP client (Claude Desktop, Cursor, etc.) can then consume OpenClaw tools.

```
OpenClaw Tools (plugin-registered)
     │  wrapped as
     ▼
MCPtools Server  (stdio or Streamable HTTP MCP server)
     │  JSON-RPC tools/list, tools/call
     ▼
Any MCP Client (Claude Desktop, Cursor, custom agent)
```

**What needs mapping:**

| OpenClaw Tool | → | MCP Protocol |
|---------------|---|--------------|
| `tool.parameters` | → | `inputSchema` |
| `ToolResult.content` | → | `tools/call` result content |
| `onUpdate` callback | → | No equivalent (dropped or batched) |
| `AbortSignal` | ← | `notifications/cancelled` |
| `ownerOnly` | → | per-client auth at MCP session level |
| Plugin tool factories | → | resolved at server start |
| `label` | → | included in description string |

**Pros:**
- ✅ Makes OpenClaw tools available to **all MCP clients** (Claude Desktop, Cursor, Zed, etc.)
- ✅ Excellent for distribution — one server process, any client
- ✅ MCP is the emerging industry standard; forward-compatible with more clients
- ✅ OpenClaw tools gain MCP Resources and Prompts surface if desired
- ✅ Progressive `onUpdate` can be routed to MCP `notifications/progress`

**Cons:**
- 🔴 **Wrong direction for the stated goal** — this doesn't load MCP servers into a unified interface; it exposes OpenClaw tools *to* MCP clients
- 🔴 Requires running a persistent server process; adds operational complexity
- 🔴 No MCP → OpenClaw path — you still can't load arbitrary MCP servers alongside OpenClaw tools
- 🔴 `onUpdate` → MCP progress notifications requires MCP client to handle them (not all do)
- 🔴 Schema restrictions (no `anyOf`, top-level `object`) must be enforced before exposure
- 🔴 Session management adds state; clawtools is currently entirely stateless
- 🔴 `ownerOnly` enforcement becomes complicated (MCP has no sender identity concept)

> **Verdict:** Option B solves an adjacent but different problem (exposing OpenClaw to MCP clients). It does not fulfill the MCPtools goal. It could be a *companion* feature, not the primary strategy.

---

### Option C — New Unified `UnifiedTool` abstraction above both

Introduce a new shared interface that both an `MCPConnector` and the existing `OpenClawConnector` implement. Neither protocol is adapted to the other; both are adapted to a common superset.

```
┌───────────────────────────────────────────┐
│         UnifiedToolProvider               │
│  interface {                              │
│    listTools(): UnifiedTool[]             │
│    callTool(name, args, signal): Result   │
│    on('tools_changed', handler)           │
│    resources?: ResourceProvider           │
│    prompts?: PromptProvider               │
│  }                                        │
└──────────────┬────────────────────────────┘
               │ implemented by
   ┌───────────┴────────────┐
   │                        │
   ▼                        ▼
MCPToolProvider       OpenClawToolProvider
(wraps MCP session)   (wraps ToolRegistry)
```

**The `UnifiedTool` type** would be a superset:

```typescript
interface UnifiedTool {
  name: string;
  label?: string;
  description: string;
  parameters: object;             // JSON Schema
  // OpenClaw extras
  ownerOnly?: boolean;
  // MCP extras
  annotations?: MCPToolAnnotations;
  // Invocation
  execute(id, params, signal?, onUpdate?): Promise<UnifiedToolResult>;
}

interface UnifiedToolResult {
  content: (TextContent | ImageContent | AudioContent | ResourceContent)[];
  details?: unknown;
  isError?: boolean;
}
```

**Pros:**
- ✅ No information loss — audio content, resource content, MCP annotations all preserved
- ✅ MCP Resources and Prompts can be surfaced as first-class concepts
- ✅ `list_changed` events become a native interface concern, not a workaround
- ✅ Sampling (server→client LLM call) can be handled if `UnifiedToolProvider` carries an LLM callback
- ✅ Cleanest long-term architecture — neither side is artificially constrained
- ✅ New MCP-only features (future spec revisions) can be added without breaking OpenClaw side
- ✅ Can export an adapter from `UnifiedTool` back to OpenClaw `Tool` for backward compat

**Cons:**
- 🔴 Largest upfront implementation cost — new type, two providers, migration path
- 🔴 Breaks existing `ToolRegistry` API (or requires a parallel registry)
- 🔴 `onUpdate` still has no MCP equivalent — must either drop or fake it
- 🔴 Agent loops consuming `Tool[]` today would need to consume `UnifiedTool[]` — migration burden
- 🔴 OpenClaw `before_tool_call` / `after_tool_call` hooks don't apply to MCP tools (hook system is OpenClaw-runtime-only)
- 🔴 `AudioContent` from MCP has no rendering path in most LLM providers today anyway
- 🔴 Schema normalization (Gemini cleaning, `anyOf` stripping) must run on both paths
- 🔴 Requires maintaining two registry types or a unified registry that understands both

---

## 5. Deep-Dive: MCP-Specific Complexity

These MCP behaviors have no direct OpenClaw analog and must be explicitly handled regardless of the chosen strategy:

### 5.1 Session Lifecycle (required for all options)

MCP requires `initialize` → `initialized` before any tool call. This is stateful. Each MCP server connection must:

1. Open transport (spawn child for stdio; HTTP connection for Streamable HTTP)
2. Send `initialize` request with client capabilities
3. Wait for server's `InitializeResult` (capabilities, server info, optional session ID)
4. Send `initialized` notification
5. Then discover tools via `tools/list`

This lifecycle must be managed by the MCPtools layer regardless of which integration option is chosen. The key question is whether this is exposed to callers or fully hidden.

### 5.2 `notifications/tools/list_changed`

MCP servers can push tool list changes at any time. The OpenClaw `ToolRegistry` is append-only and has no live-update path. Any option that maps MCP tools into `ToolRegistry` must handle:

- Re-fetching `tools/list` when notification arrives
- Reconciling: new tools to add, removed tools to deregister
- Notifying the agent loop that its tool list is stale

### 5.3 Streamable HTTP Transport Complexity

The Streamable HTTP transport adds:

- HTTP session management (`Mcp-Session-Id` header)
- Dual-channel: POST for client→server, GET for server→client SSE
- Reconnect + replay via `Last-Event-ID`
- `DELETE /mcp` for session termination
- DNS rebinding protection (Origin header validation on server; irrelevant for client)
- Backwards compat with old 2024-11-05 HTTP+SSE transport (POST → 405 → fall back to GET SSE)

This is substantially more complex than stdio. The `@modelcontextprotocol/sdk` is already in `package-lock.json` (v1.25.2) — using it would handle this transport complexity rather than reimplementing from scratch.

### 5.4 Audio Content

MCP 2025-03-26 added `audio` content type. No LLM provider in clawtools currently accepts audio in tool results. Options:

- **Drop it** (simplest; loses data)
- **Base64-encode as attachment with metadata text** ("Audio result: [audio/wav, 24KB]")
- **Surface in `UnifiedToolResult`** only (Option C; consumer decides)

### 5.5 Resource Content (`type: "resource"`)

MCP tools can embed resource references in results. These are URIs that the client can subscribe to or re-fetch. Options:

- **Inline the text** (if `resource.text` is present) — lossless for most cases
- **Return URI as text** — lossy for binary resources
- **Surface in `UnifiedToolResult`** (Option C only)

### 5.6 MCP Sampling (server→client LLM call)

An MCP server can send a `sampling/createMessage` request to the client, asking it to run an LLM inference. This is the MCP mechanism for tool-side sub-agents. Clawtools has no LLM invocation path exposed to tools — it sits below the LLM layer. Supporting this would require passing a callback/connector reference into the MCP client layer.

### 5.7 MCP Roots

The client can declare filesystem roots it controls via `roots/list`. Useful if you want the MCP server to be aware of the workspace. Maps naturally to `ToolContext.workspaceDir`.

---

## 6. Recommended Strategy with Rationale

### Primary recommendation: **Option A (MCP → OpenClaw Tool adapter)**

**Rationale:**

The immediate, practical goal is *loading MCP tools into a unified tool list alongside OpenClaw tools*. Option A achieves this with minimal friction:

- OpenClaw tools already work. Nothing about how they're loaded, listed, or invoked changes.
- MCP tools need an adapter layer: connection management, JSON-RPC, tool list discovery, and mapping `tools/call` → `execute()`.
- The result is one `Tool[]` that the agent loop consumes unchanged.
- The `@modelcontextprotocol/sdk` (already in lockfile) handles transport complexity, so the adapter is mostly mapping, not protocol implementation.

**What to intentionally drop (accepted losses):**

| Feature | Disposition |
|---------|-------------|
| Audio content | Convert to text description: `"[audio result: audio/wav, Xb]"` |
| Resource content | Inline `resource.text` if present; else `"[resource: <uri>]"` |
| MCP Resources (non-tool) | Out of scope for MCPtools v1; future sub-API |
| MCP Prompts | Out of scope for MCPtools v1; future sub-API |
| MCP Sampling | Out of scope; requires LLM callback threading |
| `list_changed` | Support via `MCPToolProvider.refresh()` manual call + optional event listener |

### Secondary recommendation: **Option B as a companion feature**

Build a lightweight MCP server that exposes OpenClaw tools via the MCP protocol — but as a *separate optional server binary*, not the primary integration path. This lets OpenClaw tools be consumed by Claude Desktop, Cursor, etc. without coupling it to the MCPtools loader.

### Option C: **Defer to v2**

Option C is the right long-term architecture if MCPtools grows to expose Resources, Prompts, Sampling, and audio content. The design should keep Option C as the target by:

- Keeping the `MCPToolProvider` as an internal class (not leaking MCP session details into the `Tool` type)
- Defining `UnifiedToolResult` as an internal type today that happens to also hold `audio` and `resource` blocks — even if no consumer uses them yet
- This makes Option A a stepping stone, not a dead end

---

## 7. Proposed MCPtools Architecture (Option A implementation)

```
mcptools/
  src/
    mcp-client.ts          # MCPServerClient — transport, session, reconnect
    mcp-tool-adapter.ts    # Maps MCP tool def → Tool; routes execute() → tools/call
    mcp-tool-provider.ts   # Manages multiple MCP server connections
    mcp-config.ts          # MCPServer config shape (command/args or url)
    transports/
      stdio.ts             # stdio transport (spawn subprocess)
      streamable-http.ts   # Streamable HTTP transport (SSE + POST)
    index.ts               # Public API: loadMCPServers(), MCPToolProvider
```

### 7.1 Configuration Shape

```typescript
type MCPServerConfig =
  | {
      type: "stdio";
      command: string;          // e.g., "npx"
      args: string[];           // e.g., ["-y", "@modelcontextprotocol/server-filesystem"]
      env?: Record<string, string>;
      workingDir?: string;
    }
  | {
      type: "streamable-http";
      url: string;              // e.g., "https://myserver.com/mcp"
      headers?: Record<string, string>;
      auth?: { type: "bearer"; token: string } | { type: "api-key"; key: string };
    };

type MCPServersConfig = {
  servers: Record<string, MCPServerConfig>;  // keyed by server ID
};
```

### 7.2 Public API

```typescript
// Load MCP servers and return tools registered into a ToolRegistry
async function loadMCPServers(
  config: MCPServersConfig,
  registry: ToolRegistry,
  options?: {
    onToolsChanged?: (serverId: string) => void;
    signal?: AbortSignal;
  }
): Promise<MCPToolProvider>

class MCPToolProvider {
  // Refresh tool list from all connected servers
  async refresh(): Promise<void>

  // Get connection status per server
  status(): Record<string, "connected" | "connecting" | "disconnected" | "error">

  // Disconnect all servers
  async close(): Promise<void>
}
```

### 7.3 Tool Name Namespacing

Since multiple MCP servers may define tools with the same name (e.g., `read`), tool names should be namespaced:

```
<server-id>__<tool-name>
// e.g.:  filesystem__read_file
//        github__create_issue
//        brave__web_search
```

This is consistent with how OpenClaw handles tool namespacing across plugins. The `label` field can display the un-namespaced name with the server ID as context.

**Open question for human decision:** Should namespace prefix be configurable? Should the separator be `__`, `:`, or `/`? (Some LLM providers reject `/` in tool names.)

### 7.4 Schema Normalization

MCP `inputSchema` may use JSON Schema features that are incompatible with some LLM providers (Gemini rejects `$ref`, `anyOf`, etc.). The existing `normalizeSchema()` and `cleanSchemaForGemini()` utilities from clawtools should be applied to MCP-sourced schemas at registration time, same as for OpenClaw tools.

### 7.5 Content Type Degradation (accepted losses)

```typescript
function degradeMCPContent(content: MCPContent[]): ContentBlock[] {
  return content.flatMap(block => {
    switch (block.type) {
      case "text":
        return [{ type: "text", text: block.text }];
      case "image":
        return [{ type: "image", data: block.data, mimeType: block.mimeType }];
      case "audio":
        // Degrade: describe in text
        return [{ type: "text", text: `[Audio result: ${block.mimeType}, ${estimateSize(block.data)}]` }];
      case "resource":
        // Inline text if available, else URI
        if (block.resource.text) return [{ type: "text", text: block.resource.text }];
        if (block.resource.blob) return [{ type: "text", text: `[Resource: ${block.resource.uri}]` }];
        return [{ type: "text", text: `[Resource: ${block.resource.uri}]` }];
    }
  });
}
```

---

## 8. Pros/Cons Summary Table

| | Option A (MCP→Tool adapter) | Option B (Tool→MCP server) | Option C (Unified abstraction) |
|---|---|---|---|
| **Fulfills stated goal** | ✅ Yes | ❌ No (wrong direction) | ✅ Yes |
| **Implementation effort** | 🟡 Medium | 🟡 Medium | 🔴 High |
| **Breaks existing API** | ✅ None | ✅ None | 🔴 Yes (new type) |
| **Audio content** | 🟡 Degraded to text | N/A | ✅ Preserved |
| **Resource content** | 🟡 Degraded to text/URI | N/A | ✅ Preserved |
| **MCP Resources (non-tool)** | ❌ Not surfaced | N/A | ✅ Surfaceable |
| **MCP Prompts** | ❌ Not surfaced | N/A | ✅ Surfaceable |
| **MCP Sampling** | ❌ Not supported | N/A | 🟡 Supportable with effort |
| **tools/list_changed** | 🟡 Manual refresh | N/A | ✅ First-class event |
| **OpenClaw tools exposed to MCP clients** | ❌ No | ✅ Yes | 🟡 Via separate adapter |
| **Uses @modelcontextprotocol/sdk** | ✅ Yes (already in lockfile) | ✅ Yes | ✅ Yes |
| **Schema normalization** | ✅ Inherited from clawtools | 🟡 Must add | ✅ Centralized |
| **Backwards compat with clawtools** | ✅ Full | ✅ Full | 🔴 Requires migration |
| **Tool policy pipeline** | ✅ Works unchanged | 🟡 Per-client | 🟡 Must adapt |
| **Testability** | ✅ Easy (mock MCP server) | ✅ Easy | 🟡 More complex |
| **Future-proof** | 🟡 Moderate | 🟡 Moderate | ✅ Best |
| **Recommended for v1** | ✅ **Yes** | 🟡 Companion only | ❌ Defer to v2 |

---

## 9. Open Questions for Human Decision

1. **Tool namespacing separator**: `filesystem__read_file` vs `filesystem:read_file` vs `filesystem/read_file` — some providers (OpenAI) allow `/` in tool names; others don't. Recommendation: `__` as the safest default.

2. **Audio content policy**: Drop silently, degrade to text description, or surface as `details` only (not in `content`)? Recommendation: degrade to text description so the LLM at least knows something happened.

3. **MCP Resources and Prompts in v1**: Expose as an optional parallel API on `MCPToolProvider` (separate from the `Tool[]` surface), or completely defer? Recommendation: expose as optional methods on `MCPToolProvider` so callers can access them without them polluting the tool interface.

4. **Sampling support**: Requires threading an LLM connector/callback into the MCP layer. Should `loadMCPServers()` accept an optional `onSamplingRequest` callback, or leave it unsupported in v1? Recommendation: accept a callback parameter but leave it `undefined` by default (silently reject sampling requests).

5. **`list_changed` live update**: Should MCPtools maintain a live SSE connection to Streamable HTTP servers for server-push tool updates? Or is polling/manual refresh sufficient for v1? Recommendation: support the event-driven path (SSE GET is already part of the transport) but make it opt-in via `onToolsChanged` callback.

6. **Workspace roots**: Should `loadMCPServers()` accept a `workspaceDir` and send it as MCP `roots` capability? This lets MCP servers (especially filesystem tools) know what workspace they're operating in. Recommendation: yes — map `ToolContext.workspaceDir` to MCP `roots`.

7. **Config file format**: Should MCPtools support loading server configs from a standard file (`.mcp.json`, `mcptools.json`, or reading from Claude Desktop's `claude_desktop_config.json` format)? Recommendation: support Claude Desktop's format natively for zero-friction adoption.

8. **Option B timing**: Build the "expose OpenClaw tools as MCP server" feature now (alongside Option A) or defer? It's a different codebase path and wouldn't share much code with the Option A adapter. Recommendation: defer to a separate `clawtools-mcp-server` package after Option A stabilizes.

---

## 10. Relationship to OpenClaw's Existing MCP Strategy

OpenClaw's `VISION.md` explicitly states:

> "OpenClaw supports MCP through `mcporter`. This keeps MCP integration flexible and decoupled from core runtime. For now, we prefer this bridge model over building first-class MCP runtime into core."

MCPtools **does not conflict** with this. mcporter is an OpenClaw plugin that bridges MCP servers into OpenClaw's runtime as tools through its hook/plugin system. MCPtools is a standalone library project (under clawtools) that does the same bridging at the library level — no OpenClaw runtime required. They solve the same problem at different layers of the stack.

The clawtools/MCPtools approach is appropriate when:
- The consumer is not running the full OpenClaw runtime (e.g., a custom agent loop, a third-party app)
- The consumer wants to mix MCP tools with OpenClaw tools *without* the OpenClaw gateway

If the full OpenClaw runtime is present, mcporter is the right path. If only clawtools is present, MCPtools fills the gap.

---

*Document prepared for human review. Recommend deciding on the open questions in §9 before implementation begins.*
