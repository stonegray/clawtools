# 10 — Minimal Reference Implementation

> Pseudocode reference implementation sufficient to run OpenClaw tools standalone.

---

## 1. Minimal Tool Runner

This pseudocode demonstrates how to load a single OpenClaw tool definition, assemble a
JSON Schema, call the tool's `execute` method, and interpret the result — without requiring
the OpenClaw CLI or any OpenClaw-specific runtime.

```typescript
// ─── 1. Tool Definition ─────────────────────────────────────────────
import { Type, type TObject } from "@sinclair/typebox";

interface ToolResult<TDetails = unknown> {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  details?: TDetails;
}

interface AgentTool<TParams extends TObject = TObject, TDetails = unknown> {
  name: string;
  description: string;
  parameters: TParams;                       // Typebox schema
  execute: (
    id: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult<TDetails>>;
}

// ─── 2. Define a Tool ───────────────────────────────────────────────
const readFileTool: AgentTool = {
  name: "read_file",
  description: "Read the contents of a file.",
  parameters: Type.Object({
    file_path: Type.String({ description: "Absolute path to the file" }),
    offset: Type.Optional(Type.Number({ description: "Start line (0-indexed)" })),
    limit: Type.Optional(Type.Number({ description: "Max lines to return" })),
  }),
  async execute(id, args) {
    const path = args.file_path as string;
    const content = await fs.readFile(path, "utf-8");
    const lines = content.split("\n");
    const offset = (args.offset as number) ?? 0;
    const limit = (args.limit as number) ?? lines.length;
    const slice = lines.slice(offset, offset + limit).join("\n");
    return {
      content: [{ type: "text", text: slice }],
      details: { file_path: path, lines: limit },
    };
  },
};

// ─── 3. Schema Extraction ───────────────────────────────────────────
import { Value } from "@sinclair/typebox/value";

function extractJsonSchema(tool: AgentTool): object {
  // Typebox schemas are already valid JSON Schema objects
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

// ─── 4. Execute a Tool ──────────────────────────────────────────────
async function executeTool(
  tool: AgentTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  // Validate args against schema
  const errors = [...Value.Errors(tool.parameters, args)];
  if (errors.length > 0) {
    return {
      content: [{ type: "text", text: JSON.stringify({
        status: "error",
        tool: tool.name,
        error: `Invalid arguments: ${errors.map(e => e.message).join(", ")}`,
      }) }],
    };
  }

  const id = `call_${crypto.randomUUID()}`;
  return tool.execute(id, args, signal);
}

// ─── 5. Interpret the Result ────────────────────────────────────────
function interpretResult(result: ToolResult): {
  text: string;
  images: Array<{ data: string; mimeType: string }>;
  isError: boolean;
} {
  const texts: string[] = [];
  const images: Array<{ data: string; mimeType: string }> = [];
  let isError = false;

  for (const block of result.content) {
    if (block.type === "text") {
      texts.push(block.text);
      try {
        const parsed = JSON.parse(block.text);
        if (parsed.status === "error") isError = true;
      } catch {}
    } else if (block.type === "image") {
      images.push({ data: block.data, mimeType: block.mimeType });
    }
  }

  return { text: texts.join("\n"), images, isError };
}
```

---

## 2. Minimal Agent Loop

```typescript
// ─── Types ──────────────────────────────────────────────────────────
type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: ContentBlock[]; stopReason: string }
  | { role: "toolResult"; toolCallId: string; toolName: string;
      content: TextContent[]; isError: boolean };

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

type TextContent = { type: "text"; text: string };

// ─── LLM Client Interface ──────────────────────────────────────────
interface LlmClient {
  chat(params: {
    systemPrompt: string;
    messages: Message[];
    tools: Array<{ name: string; description: string; input_schema: object }>;
  }): Promise<{
    content: ContentBlock[];
    stopReason: "stop" | "toolUse" | "length" | "error";
    usage: { input: number; output: number };
  }>;
}

// ─── Agent Loop ─────────────────────────────────────────────────────
async function agentLoop(params: {
  client: LlmClient;
  tools: AgentTool[];
  systemPrompt: string;
  userMessage: string;
  maxTurns?: number;
}): Promise<Message[]> {
  const { client, tools, systemPrompt, userMessage, maxTurns = 20 } = params;

  const toolSchemas = tools.map(t => extractJsonSchema(t));
  const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));
  const messages: Message[] = [{ role: "user", content: userMessage }];

  for (let turn = 0; turn < maxTurns; turn++) {
    // Call LLM
    const response = await client.chat({ systemPrompt, messages, tools: toolSchemas });
    const assistantMsg: Message = {
      role: "assistant",
      content: response.content,
      stopReason: response.stopReason,
    };
    messages.push(assistantMsg);

    // If no tool calls, we're done
    if (response.stopReason !== "toolUse") break;

    // Execute tool calls
    const toolCalls = response.content.filter(
      (c): c is Extract<ContentBlock, { type: "toolCall" }> => c.type === "toolCall"
    );

    for (const toolCall of toolCalls) {
      const tool = toolMap[toolCall.name];
      let result: ToolResult;

      if (!tool) {
        result = {
          content: [{ type: "text", text: JSON.stringify({
            status: "error", tool: toolCall.name, error: "Unknown tool"
          }) }],
        };
      } else {
        result = await executeTool(tool, toolCall.arguments);
      }

      const { isError } = interpretResult(result);
      messages.push({
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: result.content.filter((c): c is TextContent => c.type === "text"),
        isError,
      });
    }
  }

  return messages;
}
```

---

## 3. Minimal Plugin Loader

```typescript
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface PluginManifest {
  id: string;
  name?: string;
  description?: string;
  main?: string;
}

interface LoadedPlugin {
  id: string;
  tools: AgentTool[];
  hooks: Array<{ event: string; handler: Function }>;
}

async function loadPlugin(pluginDir: string): Promise<LoadedPlugin> {
  // 1. Read manifest
  const manifestPath = join(pluginDir, "openclaw.plugin.json");
  const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  // 2. Resolve entry point
  const entryFile = manifest.main
    ?? (existsSync(join(pluginDir, "index.ts")) ? "index.ts" : "index.js");
  const entryPath = join(pluginDir, entryFile);

  // 3. Load module (use jiti for .ts support)
  const { createJiti } = await import("jiti");
  const jiti = createJiti(entryPath, {
    interopDefault: true,
    alias: { "openclaw/plugin-sdk": "@openclaw/plugin-sdk" },
  });
  const mod = await jiti.import(entryPath);

  // 4. Build registration API
  const tools: AgentTool[] = [];
  const hooks: Array<{ event: string; handler: Function }> = [];

  const api = {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    registerTool: (tool: AgentTool) => tools.push(tool),
    registerHook: (event: string, handler: Function) => hooks.push({ event, handler }),
    // ... other registration methods (stubs or implementations)
  };

  // 5. Call register function
  const registerFn =
    typeof mod === "function" ? mod :
    mod.register ?? mod.activate ?? mod.default;

  if (typeof registerFn === "function") {
    await registerFn(api);
  }

  return { id: manifest.id, tools, hooks };
}
```

---

## 4. Minimal Connector Wrapper

```typescript
// ─── Provider Interface ─────────────────────────────────────────────
interface MinimalProvider {
  id: string;
  chat(params: {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools: Array<{ name: string; description: string; input_schema: object }>;
    apiKey: string;
  }): AsyncGenerator<StreamEvent>;
}

type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "toolcall_end"; toolCall: { id: string; name: string; arguments: Record<string, unknown> } }
  | { type: "done"; stopReason: string; usage: { input: number; output: number } }
  | { type: "error"; error: string };

// ─── Anthropic Connector ────────────────────────────────────────────
const anthropicProvider: MinimalProvider = {
  id: "anthropic",
  async *chat(params) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: 8192,
        system: params.systemPrompt,
        messages: convertMessages(params.messages),
        tools: params.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        stream: true,
      }),
    });

    // Parse SSE stream
    for await (const event of parseSSE(response.body!)) {
      switch (event.type) {
        case "content_block_delta":
          if (event.delta.type === "text_delta") {
            yield { type: "text_delta", delta: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            // Accumulate tool call JSON
          }
          break;
        case "message_stop":
          yield { type: "done", stopReason: "stop", usage: event.usage };
          break;
      }
    }
  },
};
```

---

## 5. Putting It Together

```typescript
async function main() {
  // 1. Load tools
  const tools = [readFileTool /*, writeFileTool, execTool, ... */];

  // 2. Create LLM client
  const client: LlmClient = createAnthropicClient({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: "claude-opus-4-6",
  });

  // 3. Run agent loop
  const messages = await agentLoop({
    client,
    tools,
    systemPrompt: "You are a helpful coding assistant.",
    userMessage: "Read the file package.json and tell me the version",
  });

  // 4. Extract final reply
  const lastAssistant = messages
    .filter(m => m.role === "assistant")
    .at(-1);

  if (lastAssistant && lastAssistant.role === "assistant") {
    for (const block of lastAssistant.content) {
      if (block.type === "text") {
        console.log(block.text);
      }
    }
  }
}
```
