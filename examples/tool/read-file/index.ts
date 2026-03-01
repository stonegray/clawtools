/**
 * Tool Example: Read a File
 *
 * Demonstrates calling an OpenClaw tool directly — no LLM involved.
 * The `read` tool is invoked as a plain function call and prints the file
 * contents to stdout.
 *
 * Run: npx tsx examples/tool/read-file/index.ts [path]
 * e.g: npx tsx examples/tool/read-file/index.ts ./README.md
 */

import { createClawtools } from "../../../src/index.js";

const targetPath = process.argv[2] ?? "./README.md";

const ct = await createClawtools();

// Resolve tools with a workspace context pointing at the repo root
const tools = ct.tools.resolveAll({ workspaceDir: process.cwd() });

const readTool = tools.find((t) => t.name === "read");
if (!readTool) {
    console.error("read tool not found — make sure the bundle is built (npm run build)");
    process.exit(1);
}

console.log(`Reading: ${targetPath}\n${"─".repeat(60)}`);

const result = await readTool.execute(
    "example-call-1",   // toolCallId — can be any string
    { file_path: targetPath },
);

for (const block of result.content) {
    if (block.type === "text") {
        process.stdout.write(block.text);
    }
}
