# MCPtools Implementation: Scope, Risk, and Unified Interface

**Quick assessment of implementing Option A** (MCP → OpenClaw Tool adapter for clawtools)

---

## What Changes

### New package: `mcptools/`

A new sub-package (similar to how clawtools exports `./tools`, `./connectors`, `./plugins`) that:

1. **Connects to MCP servers** — stdin/subprocess (via spawn) or Streamable HTTP (via fetch + SSE)
2. **Runs the MCP handshake** — sends `initialize`, receives capabilities, sends `initialized`
3. **Fetches tool list** — calls `tools/list`, gets array of tool definitions
4. **Wraps each MCP tool as an OpenClaw `Tool`** — maps `inputSchema` → `parameters`, `tools/call` → `execute()`
5. **Registers wrapped tools into `ToolRegistry`** — same registry that OpenClaw plugin tools use

**Files to add:**

```
mcptools/
  src/
    index.ts                   # Public API: loadMCPServers()
    mcp-client.ts              # Manages one MCP server connection + session lifecycle
    mcp-tool-adapter.ts        # Wraps MCP tool def → clawtools Tool
    mcp-tool-provider.ts       # Manages multiple MCP connections, registration
    types.ts                   # MCPServerConfig shape
    transports/
      stdio.ts                 # Spawn subprocess for stdio transport
      streamable-http.ts       # HTTP + SSE for Streamable HTTP transport
```

**Lines of code estimate:** ~1,500–2,000 (mostly transport/session plumbing)

### Changes to existing clawtools code

Essentially **none** — the adapter is entirely separate. Could ship as a standalone npm package if desired.

---

## What Gets Lost (Accepted Tradeoffs)

| MCP feature | Fate | Impact |
|-------------|------|--------|
| Audio content | Degraded to text: `[Audio result: audio/wav, 24KB]` | Low — LLM gets context, not the audio |
| Resource content | Inlined (if text present) or URI as text | Low — most MCP tools return text anyway |
| MCP Resources (non-tool API) | Not surfaced | Medium — tools that rely on resources can't be used |
| MCP Prompts | Not surfaced | Low — not common in tool-providing servers |
| MCP Sampling (server→LLM call) | Not supported | Low — rare, advanced feature |
| Live `tools/list_changed` | Manual refresh only (`provider.refresh()` call) | Low — ok for static deployments; limitation for dynamic servers |

**Net:** For 80% of MCP servers (filesystem, web search, APIs, databases), this loses almost nothing.

---

## Development Risk Assessment

### Low Risk

- ✅ **Uses battle-tested `@modelcontextprotocol/sdk`** — already in your `package-lock.json` (v1.25.2). No need to reimplement transports from scratch.
- ✅ **No changes to core clawtools** — adapter is additive; can't break existing code.
- ✅ **Existing test harness applies** — use vitest, same as current tests.
- ✅ **Mock MCP server is easy to build** — test fixture that responds to `tools/list` and `tools/call` without network.

### Medium Risk

- 🟡 **Session lifecycle can be tricky** — must handle reconnect, backoff, error states gracefully. Mitigation: explicit logging, status API to inspect connection health.
- 🟡 **Streamable HTTP transport has edge cases** — SSE reconnect logic, session ID header plumbing. But SDK handles most of it; we mostly just wire it up.
- 🟡 **Schema normalization must run on both paths** — MCP schemas can use `$ref`, `anyOf`, etc.; existing `normalizeSchema()` must be applied to MCP-sourced tools at registration time.

### Low Risk but Important

- ✅ **Tool namespacing** — prefix MCP tool names with server ID to avoid collisions (e.g., `filesystem__read_file`, `github__create_issue`). Simple prefix strategy; no surprises.

---

## Does It Provide a Unified Interface?

**Yes, concretely and simply.**

### How it works

```typescript
import { ToolRegistry, discoverCoreTools } from "clawtools";
import { loadMCPServers } from "mcptools";

const registry = new ToolRegistry();
discoverCoreTools(registry);                    // Load OpenClaw tools

await loadMCPServers({
  servers: {
    filesystem: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"]
    },
    github: {
      type: "streamable-http",
      url: "http://localhost:3000/mcp"
    }
  }
}, registry);

// Now registry has one flat list: OpenClaw tools + MCP tools
const allTools = registry.resolveAll({ workspaceDir: "/my/project" });

// Agent loop consumes exactly one Tool[] array
for (const tool of allTools) {
  console.log(`${tool.name}: ${tool.description}`);
}
```

### What the caller sees

- One `Tool[]` array — doesn't matter which tool came from OpenClaw plugin or MCP server.
- All tools have identical `execute(id, params, signal, onUpdate)` signature.
- LLM agent loop needs **zero changes** — already consumes `Tool[]`.
- Tool policy pipeline (profiles, allow/deny, sandbox) applies uniformly to all tools.

### For library users

Any software using clawtools (a custom agent framework, a web service, etc.) can:

1. Load OpenClaw tools (plugin system)
2. Load MCP servers (new `loadMCPServers()` call)
3. Get back one registry with mixed tools
4. Pass that `Tool[]` to their LLM agent loop

**This is a true unified interface.** Not "you can access both but they're separate APIs" — one consistent surface.

---

## Implementation Checklist (rough)

- [ ] `MCPServerConfig` type + validation
- [ ] Stdio transport (spawn, kill, reconnect logic)
- [ ] Streamable HTTP transport (POST, GET SSE, session ID plumbing)
- [ ] `MCPClient` class (one server connection: init, tools/list, tools/call, error handling)
- [ ] `MCPToolAdapter` (maps MCP tool def → clawtools Tool)
- [ ] `MCPToolProvider` (manages N connections, registers into ToolRegistry, exposes status/refresh)
- [ ] Content type degradation (audio → text, resource → URI)
- [ ] Schema normalization (run Gemini cleaner, anyOf flattening on MCP schemas)
- [ ] Tool name namespacing (prefix with server ID)
- [ ] Tests: mock MCP server, connection lifecycle, tool execution, error recovery
- [ ] Docs: config shape, examples (stdio + HTTP), troubleshooting

**Effort estimate:** 1–2 weeks for one developer (assuming `@modelcontextprotocol/sdk` is solid and tests are thorough).

---

## Bottom Line

**Should you implement this?**

- **If you want clawtools to load MCP servers directly:** Yes, this is the right path. Option A is pragmatic, low-friction, and delivers the unified interface immediately.
- **If you want to wait for a more comprehensive design (Option C):** Understandable, but Option A is a stepping stone, not a dead end. Build it now; migrate to Option C later if needed.
- **If you're concerned about complexity:** Transport plumbing is already written (SDK); the adapter is mostly mapping and registration. Comparable to how the current plugin loader works.

**Risk level: Low.** Most surprises will be in edge case error handling (server crashes, network flakiness), not in the core design.

---

## Next Steps

1. Decide on the 8 open questions from `docs/temp-connectorsmcp.md` (tool naming, audio policy, sampling, etc.)
2. Create `mcptools/` package skeleton in the monorepo
3. Build mock MCP server test fixture (lets you verify transport logic without real server)
4. Implement stdio transport first (simpler)
5. Add Streamable HTTP transport
6. Wire up schema normalization + content degradation
7. Write integration tests
8. Ship as `npm install mcptools`

