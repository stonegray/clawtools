# Tool Example: Read a File

Demonstrates calling an OpenClaw tool as a plain function — no LLM, no agent loop.

## Usage

```bash
# From the repository root (requires a built bundle)
npm run build
npx tsx examples/tool/read-file/index.ts ./README.md

# Or with pnpm from the example directory
cd examples/tool/read-file
pnpm start
```

You can pass any file path as the first argument:

```bash
npx tsx examples/tool/read-file/index.ts ./src/types.ts
```

## What it does

1. **Loads tools** using `createClawtools()` — reads the pre-built tool bundle
2. **Resolves** the `read` tool by name from the registry
3. **Calls `execute()`** directly with a `file_path` argument — no LLM involved
4. **Prints** each text content block from the result to stdout

## Key concepts

- **`createClawtools()`** — async entry point that loads executable tools from the built bundle
- **`tools.resolveAll(ctx)`** — materialises all tool factories into live `Tool` objects
- **`tool.execute(id, params)`** — the same interface the LLM agent loop calls; usable standalone
- **`ToolResult.content`** — array of `TextContent` / `ImageContent` blocks; iterate to get output

## Notes

- The `read` tool respects the `workspaceDir` in the context passed to `resolveAll()`.
  By default this example sets `workspaceDir` to `process.cwd()`.
- The built bundle must exist (`npm run build` from the repo root) because
  `createClawtools()` loads from `dist/core-tools/`.
- `toolCallId` (first argument to `execute`) is an opaque string; pass any unique value.
  The LLM agent loop normally provides the ID assigned by the provider.
