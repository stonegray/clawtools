# 06 — Plugin Model Specification

> Formal specification of the OpenClaw plugin system.
> Extracted from: `src/plugins/types.ts`, `src/plugins/loader.ts`, `src/plugins/registry.ts`

---

## 1. Plugin Definition Interface

### 1.1 Module Export Patterns

```typescript
// Pattern 1: Function export
export default function register(api: OpenClawPluginApi): void;

// Pattern 2: Async function export
export default async function register(api: OpenClawPluginApi): Promise<void>;

// Pattern 3: Object export
export default {
  id: "my-plugin",
  name: "My Plugin",
  register(api: OpenClawPluginApi): void { ... }
};

// Pattern 4: Object with activate (alias for register)
export default {
  activate(api: OpenClawPluginApi): void { ... }
};
```

### 1.2 `OpenClawPluginDefinition`

```typescript
type OpenClawPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: PluginKind;                        // "memory" | undefined
  configSchema?: OpenClawPluginConfigSchema;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;
};
```

---

## 2. Plugin API: `OpenClawPluginApi`

The complete API surface passed to each plugin's `register` function:

```typescript
type OpenClawPluginApi = {
  // Identity
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;             // Absolute path to plugin entry file

  // Configuration
  config: OpenClawConfig;     // Full application config (read-only)
  pluginConfig?: Record<string, unknown>;  // Plugin-specific config

  // Runtime
  runtime: PluginRuntime;     // Runtime dependency facade
  logger: PluginLogger;       // Scoped logger

  // Registration Methods
  registerTool: (
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    opts?: OpenClawPluginToolOptions,
  ) => void;

  registerHook: (
    events: string | string[],
    handler: InternalHookHandler,
    opts?: OpenClawPluginHookOptions,
  ) => void;

  registerHttpHandler: (handler: OpenClawPluginHttpHandler) => void;

  registerHttpRoute: (params: {
    path: string;
    handler: OpenClawPluginHttpRouteHandler;
  }) => void;

  registerChannel: (
    registration: OpenClawPluginChannelRegistration | ChannelPlugin,
  ) => void;

  registerGatewayMethod: (
    method: string,
    handler: GatewayRequestHandler,
  ) => void;

  registerCli: (
    registrar: OpenClawPluginCliRegistrar,
    opts?: { commands?: string[] },
  ) => void;

  registerService: (service: OpenClawPluginService) => void;

  registerProvider: (provider: ProviderPlugin) => void;

  registerCommand: (command: OpenClawPluginCommandDefinition) => void;

  resolvePath: (input: string) => string;

  // Typed lifecycle hooks
  on: <K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    opts?: { priority?: number },
  ) => void;
};
```

---

## 3. Registration Types

### 3.1 Tool Registration

```typescript
type OpenClawPluginToolOptions = {
  name?: string;         // Tool name
  names?: string[];      // Multiple tool names
  optional?: boolean;    // Can be omitted from tool list
};

type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;

type OpenClawPluginToolContext = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  sandboxed?: boolean;
};
```

### 3.2 Hook Registration

```typescript
type OpenClawPluginHookOptions = {
  entry?: HookEntry;
  name?: string;
  description?: string;
  register?: boolean;     // false to skip internal hook registration
};
```

### 3.3 Channel Registration

```typescript
type OpenClawPluginChannelRegistration = {
  plugin: ChannelPlugin;
  dock?: ChannelDock;
};
```

### 3.4 Provider Registration

```typescript
type ProviderPlugin = {
  id: string;
  label: string;
  docsPath?: string;
  aliases?: string[];
  envVars?: string[];
  models?: ModelProviderConfig;
  auth: ProviderAuthMethod[];
  formatApiKey?: (cred: AuthProfileCredential) => string;
  refreshOAuth?: (cred: OAuthCredential) => Promise<OAuthCredential>;
};
```

### 3.5 Service Registration

```typescript
type OpenClawPluginService = {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
};

type OpenClawPluginServiceContext = {
  config: OpenClawConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};
```

### 3.6 Command Registration

```typescript
type OpenClawPluginCommandDefinition = {
  name: string;              // Command name (no leading /)
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;     // Default: true
  handler: PluginCommandHandler;
};

type PluginCommandHandler = (
  ctx: PluginCommandContext,
) => PluginCommandResult | Promise<PluginCommandResult>;

type PluginCommandContext = {
  senderId?: string;
  channel: string;
  channelId?: ChannelId;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: OpenClawConfig;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: number;
};
```

### 3.7 HTTP Handler Registration

```typescript
// Raw HTTP handler (matches any request)
type OpenClawPluginHttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean> | boolean;

// Path-based HTTP handler
type OpenClawPluginHttpRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;
```

### 3.8 CLI Registration

```typescript
type OpenClawPluginCliRegistrar = (
  ctx: OpenClawPluginCliContext,
) => void | Promise<void>;

type OpenClawPluginCliContext = {
  program: Command;         // Commander program instance
  config: OpenClawConfig;
  workspaceDir?: string;
  logger: PluginLogger;
};
```

---

## 4. Plugin Registry

### 4.1 Registry Structure

```typescript
type PluginRegistry = {
  plugins: PluginRecord[];
  tools: PluginToolRegistration[];
  hooks: PluginHookRegistration[];
  typedHooks: TypedPluginHookRegistration[];
  channels: PluginChannelRegistration[];
  providers: PluginProviderRegistration[];
  gatewayHandlers: GatewayRequestHandlers;
  httpHandlers: PluginHttpRegistration[];
  httpRoutes: PluginHttpRouteRegistration[];
  cliRegistrars: PluginCliRegistration[];
  services: PluginServiceRegistration[];
  commands: PluginCommandRegistration[];
  diagnostics: PluginDiagnostic[];
};
```

### 4.2 Plugin Record

```typescript
type PluginRecord = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  kind?: PluginKind;
  source: string;                   // Entry file path
  origin: PluginOrigin;             // "bundled" | "global" | "workspace" | "config"
  workspaceDir?: string;
  enabled: boolean;
  status: "loaded" | "disabled" | "error";
  error?: string;
  toolNames: string[];
  hookNames: string[];
  channelIds: string[];
  providerIds: string[];
  gatewayMethods: string[];
  cliCommands: string[];
  services: string[];
  commands: string[];
  httpHandlers: number;
  hookCount: number;
  configSchema: boolean;
  configUiHints?: Record<string, PluginConfigUiHint>;
  configJsonSchema?: Record<string, unknown>;
};
```

### 4.3 Global Singleton

The active registry is stored globally:

```typescript
function setActivePluginRegistry(registry: PluginRegistry, key?: string): void;
function getActivePluginRegistry(): PluginRegistry | null;
```

---

## 5. Plugin Loading Pipeline

### 5.1 Full Lifecycle

```
loadOpenClawPlugins(options)
     │
     ├── 1. Apply test defaults (default-disable in test env)
     ├── 2. Normalize plugins config
     ├── 3. Check registry cache → return if hit
     ├── 4. Clear previously registered plugin commands
     ├── 5. Create PluginRuntime (dependency injection bag)
     ├── 6. Create empty PluginRegistry
     ├── 7. Discover plugin candidates (4 locations)
     ├── 8. Load manifest registry
     │
     ├── 9. For each candidate:
     │     ├── a. Check manifest exists
     │     ├── b. Check for duplicate ID (higher-priority wins)
     │     ├── c. Evaluate enable state
     │     │     ├── Global enabled flag
     │     │     ├── Allow list check
     │     │     ├── Per-plugin enabled flag
     │     │     └── Origin-based defaults
     │     ├── d. Validate configSchema in manifest
     │     ├── e. Security: path escape detection
     │     ├── f. Load module via jiti
     │     │     └── Alias: openclaw/plugin-sdk → local SDK
     │     ├── g. Resolve export (default → register/activate)
     │     ├── h. Memory slot logic (only one memory plugin)
     │     ├── i. Validate plugin config against JSON Schema
     │     └── j. Call register(api)
     │           ├── registerTool(...)
     │           ├── registerHook(...)
     │           ├── registerChannel(...)
     │           ├── registerProvider(...)
     │           ├── registerService(...)
     │           ├── registerCommand(...)
     │           ├── registerGatewayMethod(...)
     │           ├── registerHttpHandler(...)
     │           ├── registerHttpRoute(...)
     │           └── registerCli(...)
     │
     ├── 10. Warn about untracked loaded plugins
     ├── 11. Cache registry
     ├── 12. Set as active global registry
     └── 13. Initialize global hook runner
```

### 5.2 Enable State Resolution

```
resolveEffectiveEnableState(pluginId, origin, config)
     │
     ├── Global enabled=false → all plugins disabled
     ├── Allow list non-empty → only listed plugins enabled
     ├── Per-plugin entry has enabled=false → disabled
     ├── Per-plugin entry has enabled=true → enabled
     ├── Bundled plugins: enabled by default
     ├── Other origins: enabled by default (unless restricted)
     └── Default: enabled
```

### 5.3 Memory Slot Resolution

Only one `kind: "memory"` plugin can be active:

```
plugins with kind="memory":  [lancedb, core]
     │
     ├── Check config.plugins.slots.memory
     │     └── If set to "lancedb" → enable only lancedb
     ├── Check explicit enable flags
     └── Default: first discovered wins
```

---

## 6. Plugin Hooks System

### 6.1 Hook Names (Complete List)

```typescript
type PluginHookName =
  | "before_model_resolve"
  | "before_prompt_build"
  | "before_agent_start"     // Legacy (combines model + prompt phases)
  | "llm_input"
  | "llm_output"
  | "agent_end"
  | "before_compaction"
  | "after_compaction"
  | "before_reset"
  | "message_received"
  | "message_sending"
  | "message_sent"
  | "before_tool_call"
  | "after_tool_call"
  | "tool_result_persist"
  | "before_message_write"
  | "session_start"
  | "session_end"
  | "subagent_spawning"
  | "subagent_delivery_target"
  | "subagent_spawned"
  | "subagent_ended"
  | "gateway_start"
  | "gateway_stop";
```

### 6.2 Hook Event Types

```typescript
// before_model_resolve
type BeforeModelResolveEvent = { prompt: string };
type BeforeModelResolveResult = { modelOverride?; providerOverride? };

// before_prompt_build
type BeforePromptBuildEvent = { prompt: string; messages: unknown[] };
type BeforePromptBuildResult = { systemPrompt?; prependContext? };

// llm_input (observability only)
type LlmInputEvent = {
  runId: string; sessionId: string; provider: string; model: string;
  systemPrompt?: string; prompt: string; historyMessages: unknown[];
  imagesCount: number;
};

// llm_output (observability only)
type LlmOutputEvent = {
  runId: string; sessionId: string; provider: string; model: string;
  assistantTexts: string[]; lastAssistant?: unknown;
  usage?: { input?; output?; cacheRead?; cacheWrite?; total? };
};

// before_tool_call (modifying)
type BeforeToolCallEvent = { toolName: string; params: Record<string, unknown> };
type BeforeToolCallResult = { params?; block?; blockReason? } | void;

// after_tool_call (observability only)
type AfterToolCallEvent = {
  toolName: string; params: Record<string, unknown>;
  result: AgentToolResult; isError: boolean; durationMs: number;
};
```

### 6.3 Hook Execution Model

| Dispatch Mode    | Description                           | Used By                                           |
|------------------|---------------------------------------|---------------------------------------------------|
| **Parallel**     | All handlers run via `Promise.all`    | `llm_input`, `llm_output`, `message_sent`, etc.   |
| **Sequential**   | Handlers run in priority order        | `before_model_resolve`, `before_tool_call`, etc.   |
| **Sync**         | Synchronous, priority-ordered         | `tool_result_persist`, `before_message_write`       |

Priority: Higher number = runs first.

---

## 7. Plugin Config Schema

### 7.1 Config Schema Validation

```typescript
type OpenClawPluginConfigSchema = {
  safeParse?: (value: unknown) => {
    success: boolean;
    data?: unknown;
    error?: { issues?: Array<{ path: Array<string|number>; message: string }> };
  };
  parse?: (value: unknown) => unknown;
  validate?: (value: unknown) => PluginConfigValidation;
  uiHints?: Record<string, PluginConfigUiHint>;
  jsonSchema?: Record<string, unknown>;
};
```

### 7.2 UI Hints

```typescript
type PluginConfigUiHint = {
  label?: string;
  help?: string;
  tags?: string[];
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
};
```

---

## 8. Plugin Logger

```typescript
type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};
```

---

## 9. Plugin Diagnostics

```typescript
type PluginDiagnostic = {
  level: "warn" | "error";
  message: string;
  pluginId?: string;
  source?: string;
};
```

Diagnostics are accumulated during loading and available via `registry.diagnostics`.
