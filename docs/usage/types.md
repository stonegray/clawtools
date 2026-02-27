# Types Reference

Complete reference for all types exported from `clawtools` and its sub-paths.

---

## Tool result types

### `ContentBlock`
```ts
type ContentBlock = TextContent | ImageContent;
```

### `TextContent`
```ts
interface TextContent {
  type: "text";
  text: string;
}
```

### `ImageContent`
```ts
interface ImageContent {
  type: "image";
  data: string;      // base64-encoded image data
  mimeType: string;  // e.g., "image/png", "image/jpeg"
}
```

### `ToolResult<TDetails>`
```ts
interface ToolResult<TDetails = unknown> {
  content: ContentBlock[];   // one or more content blocks
  details?: TDetails;        // optional structured payload for programmatic use
}
```

### `ToolUpdateCallback<TDetails>`
```ts
type ToolUpdateCallback<TDetails = unknown> = (partial: {
  content?: ContentBlock[];
  details?: TDetails;
}) => void;
```
Passed to `tool.execute` for progressive partial results during long-running operations.

---

## Tool definition types

### `Tool<TParams, TDetails>`
```ts
interface Tool<TParams = Record<string, unknown>, TDetails = unknown> {
  name: string;                   // canonical tool name (e.g., "read", "exec")
  label?: string;                 // human-readable display label
  description: string;            // shown to the LLM
  parameters: TParams;            // JSON Schema for input parameters
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback<TDetails>,
  ) => Promise<ToolResult<TDetails>>;
  ownerOnly?: boolean;            // if true, only authorized senders can invoke
}
```

### `ToolFactory`
```ts
type ToolFactory = (ctx: ToolContext) => Tool | Tool[] | null | undefined;
```
A function that produces zero or more tools given a context. Returns `null`/`undefined` to opt out for this context.

### `ToolContext`
```ts
interface ToolContext {
  config?: Record<string, unknown>;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  sandboxed?: boolean;
  /** Absolute path to the project root; required by read/write/edit tools. */
  root?: string;
  /** Filesystem bridge; required by read/write/edit tools. Use `createNodeBridge(root)` for local Node.js access. */
  bridge?: FsBridge;
}
```

> `root` and `bridge` must be supplied together. If either is missing, filesystem tools will be silently skipped by `resolveAll()`. Use `createNodeBridge(root)` (exported from `clawtools` and `clawtools/tools`) to obtain a local Node.js-backed bridge.

---

## Filesystem bridge types

### `FsStat`
```ts
interface FsStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}
```
Metadata returned by `FsBridge.stat()`.

### `FsBridge`
```ts
interface FsBridge {
  /** Read a file as a UTF-8 string. */
  readFile(path: string): Promise<string>;
  /** Write (overwrite) a file. Parent directories are created if needed. */
  writeFile(path: string, content: string): Promise<void>;
  /** Stat a path; returns `null` if the path does not exist. */
  stat(path: string): Promise<FsStat | null>;
  /** List directory entries. Each entry is a name with a trailing `/` if it is a directory. */
  readdir(path: string): Promise<string[]>;
  /** Remove a file. */
  unlink(path: string): Promise<void>;
  /** Create a directory and all parent directories. */
  mkdir(path: string): Promise<void>;
}
```

Implement this interface to plug any filesystem backend into the `read`/`write`/`edit` tools:

```ts
import { createNodeBridge } from "clawtools";

// Local Node.js bridge — paths are resolved relative to root
const bridge = createNodeBridge("/my/project");

const tools = ct.tools.resolveAll({
  workspaceDir: "/my/project",
  root: "/my/project",
  bridge,
});
```

## Tool catalog types

### `ToolMeta`
```ts
interface ToolMeta {
  id: string;
  label: string;
  description: string;
  sectionId: string;                  // e.g., "fs", "web", "runtime"
  profiles: ToolProfile[];
  includeInOpenClawGroup?: boolean;   // included in the "group:openclaw" group
  source: "core" | "plugin";
  pluginId?: string;                  // set when source is "plugin"
}
```

### `ToolProfile`
```ts
type ToolProfile = "minimal" | "coding" | "messaging" | "full";
```

### `ToolSection`
```ts
interface ToolSection {
  id: string;
  label: string;
}
```

---

## Connector types

### `Connector`
```ts
interface Connector {
  id: string;           // unique connector identifier (e.g., "builtin/anthropic")
  label: string;        // human-readable display name
  provider: string;     // provider name (e.g., "anthropic", "openai")
  api: Api;             // API transport protocol
  models?: ModelDescriptor[];
  envVars?: string[];   // env var names for API key resolution

  stream: (
    model: ModelDescriptor,
    context: StreamContext,
    options: StreamOptions,
  ) => AsyncIterable<StreamEvent>;
}
```

### `Api` / `KnownApi`
```ts
type KnownApi =
  | "openai-completions"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-gemini-cli"
  | "google-vertex";

type Api = KnownApi | (string & {});  // open-ended: any string is valid
```

### `ModelDescriptor`
```ts
interface ModelDescriptor {
  id: string;               // model identifier (e.g., "claude-opus-4-6")
  name?: string;            // human-readable model name
  api: Api;                 // API transport to use
  provider: string;
  baseUrl?: string;
  reasoning?: boolean;      // supports reasoning/thinking
  input?: ("text" | "image")[];
  cost?: ModelCost;
  contextWindow?: number;   // max context tokens
  maxTokens?: number;       // max output tokens
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}
```

### `ModelCost`
```ts
interface ModelCost {
  input: number;       // cost per million input tokens
  output: number;      // cost per million output tokens
  cacheRead: number;   // cost per million cache-read tokens
  cacheWrite: number;  // cost per million cache-write tokens
}
```

### `ProviderConfig`
```ts
interface ProviderConfig {
  baseUrl?: string;
  api?: Api;
  models?: ModelDescriptor[];
}
```

### `AuthMode`
```ts
type AuthMode = "api-key" | "oauth" | "token" | "mixed" | "aws-sdk" | "unknown";
```

### `ResolvedAuth`
```ts
interface ResolvedAuth {
  apiKey?: string;
  profileId?: string;
  source?: string;   // where the key came from, e.g. "env:ANTHROPIC_API_KEY"
  mode: AuthMode;
}
```

---

## Message types

See [messages.md](./messages.md) for a full explanation of the conversation format, common mistakes, and a turn-by-turn flow diagram.

### `UserMessage`
```ts
interface UserMessage {
  role: "user";
  content: string;
}
```

### `AssistantMessage`
```ts
interface AssistantMessage {
  role: "assistant";
  content: string;
}
```

### `ConversationMessage`
```ts
type ConversationMessage = UserMessage | AssistantMessage;
```
A discriminated union of the two user-facing message types. For tool results use the internal `ToolResultMessage` format — see [messages.md](./messages.md).

---

## Stream event types

### `StreamContext`
```ts
interface StreamContext {
  systemPrompt?: string;
  messages: Array<UserMessage | AssistantMessage>;
  tools?: Array<{ name: string; description: string; input_schema: unknown }>;
}
```

> Build the `messages` array with `UserMessage` and `AssistantMessage` objects. When feeding tool results back into the conversation, use the internal `ToolResultMessage` format — see [messages.md](./messages.md) for the full protocol.

### `StreamOptions`
```ts
interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  headers?: Record<string, string>;
}
```

### `StreamEvent`
```ts
type StreamEvent =
  | { type: "start" }
  | { type: "text_delta";     delta: string }
  | { type: "text_end";       content: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "thinking_end";   content: string }
  | { type: "toolcall_start" }
  | { type: "toolcall_delta"; delta: string }
  | {
      type: "toolcall_end";
      toolCall: { id: string; name: string; arguments: Record<string, unknown> };
    }
  | {
      type: "done";
      stopReason: "stop" | "toolUse" | "length" | "error";
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; error: string };
```

---

## Plugin types

### `PluginDefinition`
```ts
interface PluginDefinition {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  register?: (api: PluginApi) => void | Promise<void>;
  activate?: (api: PluginApi) => void | Promise<void>; // alias for register
}
```

### `PluginApi`

See [plugins.md](./plugins.md) for the full method listing. Key active methods:

```ts
interface PluginApi {
  id: string;
  name: string;
  registerTool(tool: Tool | ToolFactory, opts?: { name?: string; names?: string[]; optional?: boolean }): void;
  registerConnector(connector: Connector): void;
  // ... (10 no-op compatibility stubs)
}
```

---

## Convenience instance types

### `Clawtools`
```ts
interface Clawtools {
  tools: ToolRegistry;
  connectors: ConnectorRegistry;
  extensions: ExtensionInfo[];
}
```

### `ClawtoolsOptions`
```ts
interface ClawtoolsOptions {
  openclawRoot?: string;
  tools?: DiscoveryOptions;
  extensionsDir?: string;
  skipCoreTools?: boolean;
  skipBuiltinConnectors?: boolean;
}
```

### `DiscoveryOptions`
```ts
interface DiscoveryOptions {
  openclawRoot?: string;
  include?: string[];           // tool IDs or "group:X" references
  exclude?: string[];
  onLoadWarning?: (message: string) => void;
}
```

### `ExtensionInfo`
```ts
interface ExtensionInfo {
  id: string;
  name: string;
  description?: string;
  channels: string[];
  providers: string[];
  path: string;
  entryPoint?: string;
}
```

---

## Plugin loader types (`clawtools/plugins`)

### `PluginManifest`
```ts
interface PluginManifest {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: "memory";
  configSchema?: Record<string, unknown>;
  channels?: string[];
  providers?: string[];
  skills?: string[];
}
```

### `LoadedPlugin`
```ts
interface LoadedPlugin {
  id: string;
  name: string;
  description?: string;
  version?: string;
  source: string;
  tools: Tool[];
  toolFactories: Array<{ factory: ToolFactory; names?: string[]; optional?: boolean }>;
  connectors: Connector[];
}
```

### `PluginLoaderOptions`
```ts
interface PluginLoaderOptions {
  searchPaths: string[];
  enabledPlugins?: string[];
  disabledPlugins?: string[];
  logger?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}
```

### `AuthResolver`
```ts
type AuthResolver = (provider: string) => ResolvedAuth | undefined;
```

---

## Error classes

### `ToolInputError`
```ts
class ToolInputError extends Error {
  readonly status: number = 400;
}
```

### `ToolAuthorizationError`
```ts
class ToolAuthorizationError extends ToolInputError {
  override readonly status = 403;
}
```
