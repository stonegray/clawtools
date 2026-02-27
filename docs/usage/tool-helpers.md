# Tool Helpers

Utility functions for tool authors. All exported from both `clawtools` and `clawtools/tools`.

---

## Result builders

Use these to construct `ToolResult` objects in tool `execute` implementations.

### `jsonResult(payload)` → `ToolResult`

Serialize any JSON-serializable value as pretty-printed JSON text. Also sets `details` to the raw payload for programmatic consumption.

```ts
import { jsonResult } from "clawtools/tools";

execute: async (id, params) => jsonResult({ files: ["a.ts", "b.ts"], count: 2 })
// → content: [{ type: "text", text: '{\n  "files": ["a.ts","b.ts"],\n  "count": 2\n}' }]
// → details: { files: [...], count: 2 }
```

### `textResult(text, details?)` → `ToolResult`

Return a plain text content block. Optionally attach structured details.

```ts
execute: async (id, params) => textResult("Operation completed successfully.")
```

### `errorResult(toolName, error)` → `ToolResult`

Return a structured error. The content block is a JSON object `{ status: "error", tool, error }`. This is the convention OpenClaw uses so LLMs can distinguish errors from normal output.

```ts
execute: async (id, params) => {
  if (!params.path) return errorResult("read", "path parameter required");
  // ...
}
// → content: [{ type: "text", text: '{"status":"error","tool":"read","error":"path parameter required"}' }]
```

### `imageResult(params)` → `ToolResult`

Return an image content block, optionally with accompanying text blocks.

```ts
imageResult({
  label: "screenshot",           // used for details
  base64: "<base64-encoded data>",
  mimeType: "image/png",
  path: "/tmp/screenshot.png",   // optional: prepends a "MEDIA:/tmp/..." text block
  extraText: "Rendered at 1920x1080", // optional: prepends an extra text block
  details: { width: 1920, height: 1080 }, // optional structured details
})
```

Result content order (when all optional fields present):
1. `{ type: "text", text: "MEDIA:/tmp/screenshot.png" }` (if `path` provided)
2. `{ type: "text", text: "Rendered at 1920x1080" }` (if `extraText` provided)
3. `{ type: "image", data: "<base64>", mimeType: "image/png" }`

---

## Parameter readers

Safe extraction helpers for tool `execute` implementations. All support both camelCase and snake_case key names automatically (e.g., passing `workspaceDir` or `workspace_dir` both work).

### `readStringParam(params, key, options?)` → `string | undefined`

Read a string parameter. Trims whitespace by default. Coerces numbers to strings.

```ts
import { readStringParam } from "clawtools/tools";

// Optional — returns undefined if missing
const path = readStringParam(params, "path");

// Required — throws ToolInputError if missing or empty
const path = readStringParam(params, "path", { required: true });

// Custom label for error messages
const path = readStringParam(params, "filePath", { required: true, label: "file path" });
// → throws: "file path required" instead of "filePath required"

// Don't trim whitespace
const content = readStringParam(params, "content", { trim: false });

// Allow empty string
const suffix = readStringParam(params, "suffix", { allowEmpty: true });
```

**`StringParamOptions`:**
```ts
{ required?: boolean; trim?: boolean; label?: string; allowEmpty?: boolean }
```

### `readNumberParam(params, key, options?)` → `number | undefined`

Read a number parameter. Coerces string representations. Optionally floors to integer.

```ts
const limit = readNumberParam(params, "limit");
const page  = readNumberParam(params, "page", { required: true, integer: true });
```

**`NumberParamOptions`:**
```ts
{ required?: boolean; integer?: boolean; label?: string }
```

### `readBooleanParam(params, key, optionsOrDefault?)` → `boolean`

Read a boolean. Coerces `"true"`, `"1"` → `true`, everything else → `false` via `Boolean()`. Returns `defaultValue` (default: `false`) if absent.

Accepts either a positional `boolean` default (legacy) or a `BooleanParamOptions` object:

```ts
const recursive = readBooleanParam(params, "recursive", false);       // legacy positional default
const force     = readBooleanParam(params, "force");                   // defaults to false
const verbose   = readBooleanParam(params, "verbose", { defaultValue: true });  // options form
const strict    = readBooleanParam(params, "strict",  { required: true });      // throws if absent
```

**`BooleanParamOptions`:**
```ts
{ required?: boolean; defaultValue?: boolean; label?: string }
```

### `readStringArrayParam(params, key, options?)` → `string[] | undefined`

Read a string array. Auto-wraps a single string into `[string]`. Required variant throws `ToolInputError` if absent.

```ts
const tags = readStringArrayParam(params, "tags");               // optional
const ids  = readStringArrayParam(params, "ids", { required: true }); // required
```

### `assertRequiredParams(params, required)`

Assert that all listed keys are present and non-empty. Throws `ToolInputError` for the first missing key. Useful as an upfront guard before further processing.

```ts
assertRequiredParams(params, ["path", "content"]);
```

---

## Error classes

### `ToolInputError`

Thrown by param readers when a required param is missing or has the wrong type. Has `status: 400`.

```ts
import { ToolInputError } from "clawtools/tools";

if (!someCondition) throw new ToolInputError("path must point to an existing file");
```

### `ToolAuthorizationError`

Subclass of `ToolInputError`. Use for access-control failures. Has `status: 403`.

```ts
import { ToolAuthorizationError } from "clawtools/tools";

if (!ctx.ownerOnly) throw new ToolAuthorizationError("this tool requires owner authorization");
```

---

## Schema utilities

### `extractToolSchema(tool)` → `{ name, description, input_schema }`

Extract a single tool's schema in the format expected by LLM APIs.

```ts
import { extractToolSchema } from "clawtools/tools";

const schema = extractToolSchema(myTool);
// → { name: "my_tool", description: "...", input_schema: { type: "object", ... } }
```

### `extractToolSchemas(tools, provider?)` → `Array<{ name, description, input_schema }>`

Extract schemas from an array of tools. Pass `provider` for provider-specific sanitization.

```ts
import { extractToolSchemas } from "clawtools/tools";

// Standard (works with Anthropic, OpenAI, etc.)
const schemas = extractToolSchemas(resolvedTools);

// Gemini — strips unsupported JSON Schema keywords
const geminiSchemas = extractToolSchemas(resolvedTools, "google");
// Accepted provider strings that trigger Gemini cleaning:
// "google", "google-generative-ai", "google-vertex"
```

### `normalizeSchema(schema)` → `Record<string, unknown>`

Ensure a schema is a valid `type: "object"` JSON Schema. Wraps non-object schemas and sets `properties: {}` if absent.

### `cleanSchemaForGemini(schema)` → `Record<string, unknown>`

Deep-strip all Gemini-incompatible JSON Schema keywords from a schema object. Removed keywords include: `patternProperties`, `additionalProperties`, `$schema`, `$id`, `$ref`, `$defs`, `definitions`, `examples`, `minLength`, `maxLength`, `minimum`, `maximum`, `multipleOf`, `pattern`, `format`, `minItems`, `maxItems`, `uniqueItems`, `minProperties`, `maxProperties`.

---

## Writing a custom tool

```ts
import type { Tool } from "clawtools";
import { readStringParam, jsonResult, errorResult } from "clawtools/tools";

const myTool: Tool = {
  name: "file_info",
  label: "File Info",
  description: "Return basic information about a file path",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file" },
    },
    required: ["path"],
  },
  execute: async (toolCallId, params, signal) => {
    const filePath = readStringParam(params, "path", { required: true });

    try {
      const { statSync } = await import("node:fs");
      const stat = statSync(filePath);
      return jsonResult({ path: filePath, size: stat.size, isDirectory: stat.isDirectory() });
    } catch (err) {
      return errorResult("file_info", `Cannot stat ${filePath}: ${String(err)}`);
    }
  },
};
```

## Writing a tool factory

Factories receive a `ToolContext` and are invoked when `resolveAll()` is called. Use factories when the tool's behavior depends on context values.

```ts
import type { ToolFactory } from "clawtools";
import { textResult } from "clawtools/tools";

const myFactory: ToolFactory = (ctx) => {
  if (!ctx.workspaceDir) return null; // skip when no workspace

  return {
    name: "cwd",
    description: "Return the current workspace directory",
    parameters: { type: "object", properties: {} },
    execute: async () => textResult(ctx.workspaceDir!),
  };
};
```
