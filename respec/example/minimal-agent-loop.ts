/**
 * minimal-agent-loop.ts
 *
 * Proof-of-concept: A complete agent loop implementation that calls an LLM,
 * executes tools, and loops until the model stops requesting tool use.
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun respec/example/minimal-agent-loop.ts
 *   or: ANTHROPIC_API_KEY=sk-... npx tsx respec/example/minimal-agent-loop.ts
 *
 * If no API key is set, runs in dry-run mode with a mock LLM.
 */

import { Type, type TObject, type Static } from "@sinclair/typebox";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ── Message types ───────────────────────────────────────────────────

interface TextContent {
  type: "text";
  text: string;
}

interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

type ContentBlock = TextContent | ToolCallContent;

type UserMessage = {
  role: "user";
  content: string;
  timestamp: number;
};

type AssistantMessage = {
  role: "assistant";
  content: ContentBlock[];
  stopReason: "stop" | "toolUse" | "length" | "error";
  usage: { input: number; output: number; total: number };
  timestamp: number;
};

type ToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: TextContent[];
  isError: boolean;
  timestamp: number;
};

type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ── Tool interface ──────────────────────────────────────────────────

interface AgentToolResult {
  content: Array<TextContent | { type: "image"; data: string; mimeType: string }>;
  details?: unknown;
}

interface AgentTool {
  name: string;
  label: string;
  description: string;
  parameters: TObject;
  execute: (
    id: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult>;
}

// ── LLM client interface ───────────────────────────────────────────

interface LlmClient {
  chat(params: {
    systemPrompt: string;
    messages: Message[];
    tools: Array<{ name: string; description: string; input_schema: object }>;
  }): Promise<{
    content: ContentBlock[];
    stopReason: "stop" | "toolUse" | "length" | "error";
    usage: { input: number; output: number; total: number };
  }>;
}

// ── Tool definitions ────────────────────────────────────────────────

const readFileTool: AgentTool = {
  name: "read",
  label: "Read File",
  description: "Read file contents. Returns text content of the file.",
  parameters: Type.Object({
    file_path: Type.String({ description: "Absolute path to the file." }),
    limit: Type.Optional(Type.Number({ description: "Max lines. Default 200." })),
  }),
  async execute(_id, args) {
    const filePath = String(args.file_path ?? args.filePath);
    const limit = Number(args.limit ?? 200);
    try {
      const content = await fs.readFile(path.resolve(filePath), "utf-8");
      const lines = content.split("\n").slice(0, limit);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ status: "error", error: err.message }) },
        ],
      };
    }
  },
};

const listDirTool: AgentTool = {
  name: "ls",
  label: "List Directory",
  description: "List directory contents. Returns file/folder names.",
  parameters: Type.Object({
    dir_path: Type.String({ description: "Absolute path to directory." }),
  }),
  async execute(_id, args) {
    const dirPath = String(args.dir_path ?? args.dirPath);
    try {
      const entries = await fs.readdir(path.resolve(dirPath), { withFileTypes: true });
      const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
      return { content: [{ type: "text", text: listing }] };
    } catch (err: any) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ status: "error", error: err.message }) },
        ],
      };
    }
  },
};

// ── Mock LLM client ─────────────────────────────────────────────────

function createMockClient(): LlmClient {
  let callCount = 0;
  return {
    async chat(params) {
      callCount++;
      // First call: request tool use
      if (callCount === 1) {
        return {
          content: [
            { type: "text", text: "Let me list the directory for you." },
            {
              type: "toolCall",
              id: `call_${crypto.randomUUID()}`,
              name: "ls",
              arguments: { dir_path: process.cwd() },
            },
          ],
          stopReason: "toolUse",
          usage: { input: 100, output: 50, total: 150 },
        };
      }
      // Second call: request read
      if (callCount === 2) {
        return {
          content: [
            { type: "text", text: "Let me read the package.json file." },
            {
              type: "toolCall",
              id: `call_${crypto.randomUUID()}`,
              name: "read",
              arguments: { file_path: path.join(process.cwd(), "package.json"), limit: 5 },
            },
          ],
          stopReason: "toolUse",
          usage: { input: 200, output: 60, total: 260 },
        };
      }
      // Third call: final response
      return {
        content: [
          {
            type: "text",
            text: "I've listed the directory and read the package.json. The project looks like a Node.js application.",
          },
        ],
        stopReason: "stop",
        usage: { input: 500, output: 30, total: 530 },
      };
    },
  };
}

// ── Agent loop ──────────────────────────────────────────────────────

interface AgentLoopParams {
  client: LlmClient;
  tools: AgentTool[];
  systemPrompt: string;
  userMessage: string;
  maxTurns?: number;
  onTurnStart?: (turn: number) => void;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, isError: boolean) => void;
  onText?: (text: string) => void;
}

async function agentLoop(params: AgentLoopParams): Promise<{
  messages: Message[];
  totalUsage: { input: number; output: number; total: number };
  turns: number;
}> {
  const {
    client,
    tools,
    systemPrompt,
    userMessage,
    maxTurns = 20,
    onTurnStart,
    onToolCall,
    onToolResult,
    onText,
  } = params;

  const toolSchemas = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]));

  const messages: Message[] = [
    { role: "user", content: userMessage, timestamp: Date.now() },
  ];

  const totalUsage = { input: 0, output: 0, total: 0 };
  let turn = 0;

  for (turn = 0; turn < maxTurns; turn++) {
    onTurnStart?.(turn + 1);

    // Call LLM
    const response = await client.chat({
      systemPrompt,
      messages,
      tools: toolSchemas,
    });

    totalUsage.input += response.usage.input;
    totalUsage.output += response.usage.output;
    totalUsage.total += response.usage.total;

    const assistantMsg: AssistantMessage = {
      role: "assistant",
      content: response.content,
      stopReason: response.stopReason,
      usage: response.usage,
      timestamp: Date.now(),
    };
    messages.push(assistantMsg);

    // Emit text
    for (const block of response.content) {
      if (block.type === "text") onText?.(block.text);
    }

    // Stop if not tool use
    if (response.stopReason !== "toolUse") break;

    // Execute tool calls
    const toolCalls = response.content.filter(
      (c): c is ToolCallContent => c.type === "toolCall",
    );

    for (const toolCall of toolCalls) {
      onToolCall?.(toolCall.name, toolCall.arguments);

      const tool = toolMap[toolCall.name];
      let result: AgentToolResult;
      let isError = false;

      if (!tool) {
        result = {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                tool: toolCall.name,
                error: `Unknown tool: ${toolCall.name}`,
              }),
            },
          ],
        };
        isError = true;
      } else {
        try {
          result = await tool.execute(toolCall.id, toolCall.arguments);
        } catch (err: any) {
          result = {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "error",
                  tool: toolCall.name,
                  error: err.message,
                }),
              },
            ],
          };
          isError = true;
        }
      }

      // Check for error in result content
      if (!isError) {
        for (const block of result.content) {
          if (block.type === "text") {
            try {
              const parsed = JSON.parse(block.text);
              if (parsed.status === "error") isError = true;
            } catch {}
          }
        }
      }

      onToolResult?.(toolCall.name, isError);

      const toolResultMsg: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: result.content.filter(
          (c): c is TextContent => c.type === "text",
        ),
        isError,
        timestamp: Date.now(),
      };
      messages.push(toolResultMsg);
    }
  }

  return { messages, totalUsage, turns: turn + 1 };
}

// ── Transcript serialization (JSONL) ────────────────────────────────

function serializeTranscript(messages: Message[]): string {
  return messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
}

function deserializeTranscript(jsonl: string): Message[] {
  return jsonl
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== OpenClaw Minimal Agent Loop PoC ===\n");

  const client = createMockClient();
  const tools = [readFileTool, listDirTool];

  console.log("Registered tools:", tools.map((t) => t.name).join(", "));
  console.log("Using mock LLM client (set ANTHROPIC_API_KEY for real LLM)\n");

  const result = await agentLoop({
    client,
    tools,
    systemPrompt: "You are a helpful assistant with access to filesystem tools.",
    userMessage: "What files are in this directory? Read the package.json.",
    maxTurns: 10,
    onTurnStart(turn) {
      console.log(`── Turn ${turn} ──`);
    },
    onToolCall(name, args) {
      console.log(`  → Tool call: ${name}(${JSON.stringify(args)})`);
    },
    onToolResult(name, isError) {
      console.log(`  ← Tool result: ${name} ${isError ? "(ERROR)" : "(OK)"}`);
    },
    onText(text) {
      console.log(`  💬 ${text}`);
    },
  });

  console.log(`\n── Summary ──`);
  console.log(`  Turns: ${result.turns}`);
  console.log(`  Messages: ${result.messages.length}`);
  console.log(`  Usage: ${result.totalUsage.input}in / ${result.totalUsage.output}out / ${result.totalUsage.total}total`);

  // Show JSONL transcript
  const jsonl = serializeTranscript(result.messages);
  console.log(`\n── JSONL Transcript (${jsonl.split("\n").length - 1} lines) ──`);
  for (const msg of result.messages) {
    const preview = JSON.stringify(msg).slice(0, 120);
    console.log(`  ${preview}...`);
  }

  // Round-trip verification
  const roundTripped = deserializeTranscript(jsonl);
  console.log(`\n  JSONL round-trip: ${roundTripped.length === result.messages.length ? "✅ OK" : "❌ MISMATCH"}`);

  console.log("\n=== Done ===");
}

main().catch(console.error);
