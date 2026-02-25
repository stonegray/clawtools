/**
 * standalone-tool-exec.ts
 *
 * Proof-of-concept: Execute an OpenClaw tool standalone as a CLI utility.
 * Demonstrates that OpenClaw-compatible tools can be used completely
 * outside of any agent loop or OpenClaw runtime.
 *
 * Usage:
 *   bun respec/example/standalone-tool-exec.ts read --file_path ./package.json --limit 10
 *   bun respec/example/standalone-tool-exec.ts ls --dir_path .
 *   bun respec/example/standalone-tool-exec.ts exec --command "echo hello"
 *   bun respec/example/standalone-tool-exec.ts --list
 *   bun respec/example/standalone-tool-exec.ts --schema read
 */

import { Type, type TObject, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";

// ── Tool interface ──────────────────────────────────────────────────

interface ToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  details?: unknown;
}

interface Tool {
  name: string;
  label: string;
  description: string;
  parameters: TObject;
  execute: (
    id: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
}

// ── Tool implementations ────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: "read",
    label: "Read File",
    description: "Read the contents of a file.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Path to the file to read." }),
      offset: Type.Optional(Type.Number({ description: "Start line (0-indexed)." })),
      limit: Type.Optional(Type.Number({ description: "Max lines to return." })),
    }),
    async execute(_id, args) {
      const filePath = path.resolve(String(args.file_path));
      const offset = Number(args.offset ?? 0);
      const limit = Number(args.limit ?? 500);
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const slice = lines.slice(offset, offset + limit);
      return {
        content: [{ type: "text", text: slice.join("\n") }],
        details: { file_path: filePath, totalLines: lines.length, returned: slice.length },
      };
    },
  },

  {
    name: "ls",
    label: "List Directory",
    description: "List directory contents.",
    parameters: Type.Object({
      dir_path: Type.String({ description: "Path to the directory." }),
    }),
    async execute(_id, args) {
      const dirPath = path.resolve(String(args.dir_path));
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const listing = entries
        .map((e) => {
          const suffix = e.isDirectory() ? "/" : e.isSymbolicLink() ? "@" : "";
          return `${e.name}${suffix}`;
        })
        .sort()
        .join("\n");
      return {
        content: [{ type: "text", text: listing }],
        details: { dir_path: dirPath, count: entries.length },
      };
    },
  },

  {
    name: "exec",
    label: "Execute Command",
    description: "Execute a shell command and return output.",
    parameters: Type.Object({
      command: Type.String({ description: "The shell command to execute." }),
      timeout_ms: Type.Optional(
        Type.Number({ description: "Timeout in milliseconds. Default: 30000." }),
      ),
    }),
    async execute(_id, args) {
      const command = String(args.command);
      const timeoutMs = Number(args.timeout_ms ?? 30000);
      try {
        const output = execSync(command, {
          encoding: "utf-8",
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return {
          content: [{ type: "text", text: output }],
          details: { command, exitCode: 0 },
        };
      } catch (err: any) {
        const stdout = err.stdout ?? "";
        const stderr = err.stderr ?? "";
        const output = [stdout, stderr].filter(Boolean).join("\n");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                tool: "exec",
                exitCode: err.status,
                output: output || err.message,
              }),
            },
          ],
        };
      }
    },
  },

  {
    name: "write",
    label: "Write File",
    description: "Write content to a file.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Path to the file to write." }),
      content: Type.String({ description: "Content to write." }),
      append: Type.Optional(
        Type.Boolean({ description: "Append instead of overwrite." }),
      ),
    }),
    async execute(_id, args) {
      const filePath = path.resolve(String(args.file_path));
      const content = String(args.content);
      const append = Boolean(args.append);

      await fs.mkdir(path.dirname(filePath), { recursive: true });

      if (append) {
        await fs.appendFile(filePath, content, "utf-8");
      } else {
        await fs.writeFile(filePath, content, "utf-8");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "ok",
              file_path: filePath,
              bytes: Buffer.byteLength(content),
              mode: append ? "append" : "write",
            }),
          },
        ],
      };
    },
  },

  {
    name: "grep",
    label: "Search Files",
    description: "Search for a pattern in files.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Search pattern (plain text)." }),
      dir_path: Type.Optional(Type.String({ description: "Directory to search in." })),
      include: Type.Optional(Type.String({ description: "File glob pattern." })),
    }),
    async execute(_id, args) {
      const pattern = String(args.pattern);
      const dirPath = path.resolve(String(args.dir_path ?? "."));
      const include = args.include ? `--include=${args.include}` : "";

      try {
        const cmd = `grep -rn ${include} -- ${JSON.stringify(pattern)} ${JSON.stringify(dirPath)} | head -50`;
        const output = execSync(cmd, {
          encoding: "utf-8",
          timeout: 15000,
          maxBuffer: 512 * 1024,
        });
        return {
          content: [{ type: "text", text: output || "(no matches)" }],
          details: { pattern, dir_path: dirPath },
        };
      } catch (err: any) {
        // grep returns exit code 1 for no matches
        if (err.status === 1) {
          return {
            content: [{ type: "text", text: "(no matches)" }],
            details: { pattern, dir_path: dirPath },
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "error", error: err.message }),
            },
          ],
        };
      }
    },
  },
];

// ── CLI argument parser ─────────────────────────────────────────────

function parseCliArgs(argv: string[]): {
  toolName?: string;
  args: Record<string, unknown>;
  flags: { list?: boolean; schema?: string; help?: boolean; json?: boolean };
} {
  const flags: any = {};
  const args: Record<string, unknown> = {};
  let toolName: string | undefined;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--list") {
      flags.list = true;
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--schema" && i + 1 < argv.length) {
      flags.schema = argv[++i];
    } else if (arg.startsWith("--") && i + 1 < argv.length) {
      const key = arg.slice(2);
      const value = argv[++i];
      // Auto-coerce types
      if (value === "true") args[key] = true;
      else if (value === "false") args[key] = false;
      else if (/^\d+$/.test(value)) args[key] = parseInt(value, 10);
      else args[key] = value;
    } else if (!toolName && !arg.startsWith("-")) {
      toolName = arg;
    }
    i++;
  }

  return { toolName, args, flags };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const cliArgs = process.argv.slice(2);
  const { toolName, args, flags } = parseCliArgs(cliArgs);

  // --list: print available tools
  if (flags.list) {
    console.log("Available tools:\n");
    for (const tool of tools) {
      console.log(`  ${tool.name.padEnd(12)} ${tool.description}`);
    }
    return;
  }

  // --schema <name>: print tool schema
  if (flags.schema) {
    const tool = tools.find((t) => t.name === flags.schema);
    if (!tool) {
      console.error(`Unknown tool: ${flags.schema}`);
      process.exit(1);
    }
    console.log(JSON.stringify({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }, null, 2));
    return;
  }

  // --help or no args
  if (flags.help || !toolName) {
    console.log(`OpenClaw Standalone Tool Executor

Usage:
  standalone-tool-exec <tool-name> --param1 value1 --param2 value2
  standalone-tool-exec --list
  standalone-tool-exec --schema <tool-name>
  standalone-tool-exec --help

Options:
  --list          List available tools
  --schema NAME   Print JSON Schema for a tool
  --json          Output result as JSON
  --help          Show this help

Available tools: ${tools.map((t) => t.name).join(", ")}`);
    return;
  }

  // Find tool
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    console.error(`Unknown tool: ${toolName}`);
    console.error(`Available: ${tools.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  // Validate args
  const validationErrors = [...Value.Errors(tool.parameters, args)].map(
    (e) => `${e.path}: ${e.message}`,
  );
  if (validationErrors.length > 0) {
    console.error(`Validation errors for ${toolName}:`);
    for (const err of validationErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // Execute
  const id = `cli_${Date.now()}`;
  const start = performance.now();
  const result = await tool.execute(id, args);
  const durationMs = performance.now() - start;

  // Output
  if (flags.json) {
    console.log(JSON.stringify({
      tool: toolName,
      args,
      result: result.content,
      details: result.details,
      durationMs: Math.round(durationMs * 100) / 100,
    }, null, 2));
  } else {
    for (const block of result.content) {
      if (block.type === "text") {
        // Check for error
        try {
          const parsed = JSON.parse(block.text);
          if (parsed.status === "error") {
            console.error(`Error: ${parsed.error ?? parsed.output ?? "unknown"}`);
            process.exit(parsed.exitCode ?? 1);
          }
          // Structured success
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          // Plain text output
          console.log(block.text);
        }
      } else if (block.type === "image") {
        console.log(`[Image: ${block.mimeType}, ${block.data.length} bytes base64]`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
