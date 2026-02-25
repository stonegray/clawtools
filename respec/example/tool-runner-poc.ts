/**
 * tool-runner-poc.ts
 *
 * Proof-of-concept: Load and execute an OpenClaw-compatible tool definition
 * without any OpenClaw CLI dependency.
 *
 * Run: bun respec/example/tool-runner-poc.ts
 *   or: npx tsx respec/example/tool-runner-poc.ts
 */

import { Type, type Static, type TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ── Core types (extracted from @mariozechner/pi-agent-core) ─────────

interface AgentToolResult<TDetails = unknown> {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  details?: TDetails;
}

interface AgentTool<TParams extends TObject = TObject, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult<TDetails>>;
}

type AnyAgentTool = AgentTool<any, unknown>;

// ── Parameter reader utilities (from src/agents/tools/common.ts) ────

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean },
): string | undefined {
  const snakeKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const raw = params[key] ?? params[snakeKey];
  if (raw == null || raw === "") {
    if (opts?.required) throw new Error(`Missing required parameter: ${key}`);
    return undefined;
  }
  return String(raw);
}

function readNumberParam(
  params: Record<string, unknown>,
  key: string,
): number | undefined {
  const snakeKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const raw = params[key] ?? params[snakeKey];
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

// ── Tool definition: read_file ──────────────────────────────────────

const ReadFileSchema = Type.Object({
  file_path: Type.String({ description: "Absolute path to the file to read." }),
  offset: Type.Optional(
    Type.Number({ description: "Start line (0-indexed). Default: 0." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max lines to return. Default: 250." }),
  ),
});

const readFileTool: AnyAgentTool = {
  name: "read",
  label: "Read File",
  description:
    "Read the contents of a file at a given path. Returns the file contents as text.",
  parameters: ReadFileSchema,
  async execute(_toolCallId, args) {
    const params = args as Record<string, unknown>;
    const filePath = readStringParam(params, "file_path", { required: true })!;
    const offset = readNumberParam(params, "offset") ?? 0;
    const limit = readNumberParam(params, "limit") ?? 250;

    const resolved = path.resolve(filePath);
    let content: string;
    try {
      content = await fs.readFile(resolved, "utf-8");
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              tool: "read",
              error: err.message,
            }),
          },
        ],
      };
    }

    const lines = content.split("\n");
    const slice = lines.slice(offset, offset + limit);
    const totalLines = lines.length;

    return {
      content: [{ type: "text" as const, text: slice.join("\n") }],
      details: {
        file_path: resolved,
        offset,
        limit,
        totalLines,
        returnedLines: slice.length,
      },
    };
  },
};

// ── Tool definition: list_dir ───────────────────────────────────────

const ListDirSchema = Type.Object({
  dir_path: Type.String({ description: "Absolute path to the directory." }),
});

const listDirTool: AnyAgentTool = {
  name: "list_dir",
  label: "List Directory",
  description: "List the contents of a directory.",
  parameters: ListDirSchema,
  async execute(_toolCallId, args) {
    const params = args as Record<string, unknown>;
    const dirPath = readStringParam(params, "dir_path", { required: true })!;
    const resolved = path.resolve(dirPath);

    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const listing = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join("\n");
      return {
        content: [{ type: "text" as const, text: listing }],
        details: { dir_path: resolved, count: entries.length },
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              tool: "list_dir",
              error: err.message,
            }),
          },
        ],
      };
    }
  },
};

// ── Schema extraction ───────────────────────────────────────────────

function extractToolSchema(tool: AnyAgentTool): object {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

// ── Validation ──────────────────────────────────────────────────────

function validateArgs(
  tool: AnyAgentTool,
  args: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors = [...Value.Errors(tool.parameters, args)].map(
    (e) => `${e.path}: ${e.message}`,
  );
  return { valid: errors.length === 0, errors };
}

// ── Runner ──────────────────────────────────────────────────────────

async function runTool(
  tool: AnyAgentTool,
  args: Record<string, unknown>,
): Promise<void> {
  console.log(`\n── Executing tool: ${tool.name} ──`);
  console.log("  Args:", JSON.stringify(args));

  // Validate
  const validation = validateArgs(tool, args);
  if (!validation.valid) {
    console.error("  Validation errors:", validation.errors);
    return;
  }

  // Execute
  const id = `call_${Date.now()}`;
  const start = performance.now();
  const result = await tool.execute(id, args);
  const duration = (performance.now() - start).toFixed(1);

  // Interpret
  for (const block of result.content) {
    if (block.type === "text") {
      // Check for error JSON
      try {
        const parsed = JSON.parse(block.text);
        if (parsed.status === "error") {
          console.error(`  ERROR: ${parsed.error}`);
          return;
        }
      } catch {
        // Not JSON — print raw text
      }
      const preview =
        block.text.length > 500
          ? block.text.slice(0, 500) + `\n... (${block.text.length} chars total)`
          : block.text;
      console.log(`  Result (${duration}ms):\n${preview}`);
    } else if (block.type === "image") {
      console.log(`  Image: ${block.mimeType} (${block.data.length} bytes base64)`);
    }
  }

  if (result.details) {
    console.log("  Details:", JSON.stringify(result.details));
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const tools = [readFileTool, listDirTool];

  console.log("=== OpenClaw Tool Runner PoC ===\n");

  // Print schemas
  console.log("Registered tools:");
  for (const tool of tools) {
    const schema = extractToolSchema(tool);
    console.log(`  - ${tool.name}: ${tool.description}`);
    console.log(`    Schema: ${JSON.stringify(schema, null, 2).split("\n").join("\n    ")}`);
  }

  // Run: list current directory
  await runTool(listDirTool, { dir_path: process.cwd() });

  // Run: read this file
  await runTool(readFileTool, {
    file_path: new URL(import.meta.url).pathname,
    offset: 0,
    limit: 10,
  });

  // Run: read non-existent file (error case)
  await runTool(readFileTool, { file_path: "/nonexistent/path.txt" });

  // Run: missing required param (validation error)
  await runTool(readFileTool, {});

  console.log("\n=== Done ===");
}

main().catch(console.error);
