# Agentic Loop Example

A complete working agentic loop using clawtools:

1. **Init** — `createClawtools()` loads tools and connectors
2. **Resolve** — `ct.tools.resolveAll({ root, bridge })` materialises tools for the workspace
3. **Stream** — call the LLM with the user message and tool schemas
4. **Tool use** — on `toolcall_end`: execute the tool, construct a `ToolResultMessage`, append to history
5. **Repeat** — loop until `stopReason !== "toolUse"` (natural stop or max-tokens)

## Requirements

- Build the tool bundles first: `npm run build` from the repo root
- Set `ANTHROPIC_API_KEY` in your environment (or edit `PROVIDER` / `MODEL_ID` in `index.ts`)

## Run

```bash
# From the repo root
npm run build
npx tsx examples/agentic/index.ts

# Custom prompt
npx tsx examples/agentic/index.ts "What's in the src/ directory?"

# From the example directory
cd examples/agentic
pnpm start
```

## Key concepts

### `ToolResultMessage`

After executing a tool you must feed the result back as a `ToolResultMessage`:

```ts
{
  role: "toolResult",       // ← NOT "tool" (OpenAI) or role:"user" (Anthropic)
  toolCallId: "call_abc",   // from event.toolCall.id
  toolName: "read",         // from event.toolCall.name
  content: [{ type: "text", text: "…" }],
  isError: false,
}
```

See [docs/usage/messages.md](../../docs/usage/messages.md) for the full format reference.

### `FsBridge` + `root`

The `read`, `write`, and `edit` tools require `root` and `bridge` in the context:

```ts
ct.tools.resolveAll({
  workspaceDir: root,
  root,
  bridge: createNodeBridge(root),   // Node.js fs implementation
});
```

Without these two fields the fs tools are silently skipped. See
[docs/usage/tools.md#fsbridge](../../docs/usage/tools.md) for details.
