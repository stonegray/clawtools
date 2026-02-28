/**
 * Core type definitions for clawtools.
 *
 * These types are reimplemented from OpenClaw's type system to provide a
 * standalone, dependency-free interface. They are intentionally compatible
 * with OpenClaw's AgentTool, AgentToolResult, and plugin types but do not
 * import from OpenClaw directly.
 *
 * @module
 */

// =============================================================================
// Tool Result Types
// =============================================================================

/** A text content block returned by a tool. */
export interface TextContent {
    type: "text";
    text: string;
}

/** An image content block returned by a tool. */
export interface ImageContent {
    type: "image";
    data: string;
    mimeType: string;
}

/** Union of all content block types a tool can return. */
export type ContentBlock = TextContent | ImageContent;

/**
 * The result returned by a tool's `execute` method.
 *
 * @typeParam TDetails - Type of the structured details payload.
 */
export interface ToolResult<TDetails = unknown> {
    /** One or more content blocks (text and/or images). */
    content: ContentBlock[];
    /** Optional structured details for programmatic consumption. */
    details?: TDetails;
}

// =============================================================================
// Tool Update Callback
// =============================================================================

/**
 * Callback for progressive tool updates during execution.
 * Tools may call this to report partial results while still running.
 */
export type ToolUpdateCallback<TDetails = unknown> = (partial: {
    content?: ContentBlock[];
    details?: TDetails;
}) => void;

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * A fully-defined tool that can be invoked by an LLM agent.
 *
 * This interface is compatible with OpenClaw's `AgentTool` type.
 * The `parameters` field should be a JSON Schema object (or a TypeBox schema,
 * which compiles to JSON Schema).
 *
 * @typeParam TParams - JSON Schema type for the tool's parameters.
 * @typeParam TDetails - Type of the structured details in the result.
 */
export interface Tool<TParams = Record<string, unknown>, TDetails = unknown> {
    /** Canonical tool name (e.g., "read", "exec", "web_fetch"). */
    name: string;
    /** Human-readable display label. */
    label?: string;
    /** Description of what the tool does (shown to the LLM). */
    description: string;
    /** JSON Schema describing the tool's input parameters. */
    parameters: TParams;
    /**
     * Execute the tool with the given arguments.
     *
     * @param toolCallId - Unique identifier for this invocation.
     * @param params - Parsed arguments matching the parameters schema.
     * @param signal - Optional abort signal for cancellation.
     * @param onUpdate - Optional callback for progressive updates.
     * @returns The tool result containing content blocks and optional details.
     */
    execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
        onUpdate?: ToolUpdateCallback<TDetails>,
    ) => Promise<ToolResult<TDetails>>;
    /** If true, only authorized/owner senders can invoke this tool. */
    ownerOnly?: boolean;
}

// =============================================================================
// Tool Metadata
// =============================================================================

/** Section grouping for tool catalog display. */
export interface ToolSection {
    id: string;
    label: string;
}

/** Profile presets that control which tools are available. */
export type ToolProfile = "minimal" | "coding" | "messaging" | "full";

/** Metadata about a registered tool (catalog entry). */
export interface ToolMeta {
    /** Canonical tool ID. */
    id: string;
    /** Display label. */
    label: string;
    /** Short description. */
    description: string;
    /** Section this tool belongs to (e.g., "fs", "web", "runtime"). */
    sectionId: string;
    /** Which profiles include this tool. */
    profiles: ToolProfile[];
    /** Whether it's included in the "group:openclaw" group. */
    includeInOpenClawGroup?: boolean;
    /** Source: "core" for built-in tools, "plugin" for plugin-provided tools. */
    source: "core" | "plugin";
    /** Plugin ID if source is "plugin". */
    pluginId?: string;
}

// =============================================================================
// FsBridge — file-system abstraction for sandboxed fs tools
// =============================================================================

/**
 * Stat result returned by a {@link FsBridge}.
 */
export interface FsStat {
    type: "file" | "directory" | "other";
    size: number;
    mtimeMs: number;
}

/**
 * Minimal file-system abstraction required by the core fs tools
 * (`read`, `write`, `edit`).
 *
 * Implement this interface to plug any file-system backend (local Node.js,
 * sandboxed container, virtual FS, …) into the tool layer.
 * For local Node.js use, call {@link createNodeBridge} from
 * `clawtools/tools` instead of implementing this manually.
 *
 * @example
 * ```ts
 * import { createNodeBridge } from "clawtools/tools";
 *
 * const ct = await createClawtools();
 * const tools = ct.tools.resolveAll({
 *   workspaceDir: "/my/project",
 *   root: "/my/project",
 *   bridge: createNodeBridge("/my/project"),
 * });
 * ```
 */
export interface FsBridge {
    stat(args: { filePath: string; cwd?: string }): Promise<FsStat | null>;
    /**
     * Read the full contents of a file.
     *
     * @throws Implementations must throw (e.g. an `ENOENT`-style error) when
     * the file does not exist or cannot be read. This method does **not**
     * return `null` for missing files — callers are expected to catch thrown
     * errors.
     */
    readFile(args: { filePath: string; cwd?: string }): Promise<Buffer>;
    mkdirp(args: { filePath: string; cwd?: string }): Promise<void>;
    /**
     * Write data to a file.
     *
     * Implementations must automatically create any missing parent directories
     * before writing (equivalent to `mkdir -p` followed by the write).
     * Callers rely on this behaviour and do **not** call {@link mkdirp}
     * separately before `writeFile`.
     */
    writeFile(args: { filePath: string; cwd?: string; data: string | Buffer }): Promise<void>;
}

// =============================================================================
// Tool Factory (for plugin-style deferred creation)
// =============================================================================

/**
 * Context passed to tool factories when tools are instantiated.
 * Mirrors OpenClaw's `OpenClawPluginToolContext`.
 */
export interface ToolContext {
    /** Application configuration (opaque to tools). */
    config?: Record<string, unknown>;
    /** Workspace directory path. */
    workspaceDir?: string;
    /** Agent data directory path. */
    agentDir?: string;
    /** Agent identifier. */
    agentId?: string;
    /** Current session key. */
    sessionKey?: string;
    /** Channel the message arrived on. */
    messageChannel?: string;
    /** Agent account identifier. */
    agentAccountId?: string;
    /** Whether the agent is running in a sandbox. */
    sandboxed?: boolean;
    /**
     * Filesystem root for the `fs` tools (read / write / edit).
     * Defaults to `workspaceDir` when omitted.
     * Required for the fs tools to operate — omitting it causes those
     * tools to be silently skipped by `resolveAll()`.
     */
    root?: string;
    /**
     * File-system bridge implementation for the `fs` tools.
     * Required for the fs tools to operate — omitting it causes those
     * tools to be silently skipped by `resolveAll()`.
     * Use `createNodeBridge(root)` from `clawtools/tools` for local Node.js usage.
     */
    bridge?: FsBridge;
}

/**
 * A factory function that creates tools on demand.
 * May return a single tool, an array of tools, or null/undefined to skip.
 */
export type ToolFactory = (
    ctx: ToolContext,
) => Tool | Tool[] | null | undefined;

// =============================================================================
// Connector / Provider Types
// =============================================================================

/** Known LLM API transport protocols. */
export type KnownApi =
    | "openai-completions"
    | "openai-responses"
    | "azure-openai-responses"
    | "openai-codex-responses"
    | "anthropic-messages"
    | "bedrock-converse-stream"
    | "google-generative-ai"
    | "google-gemini-cli"
    | "google-vertex";

/** API transport identifier — known transports or any custom string. */
export type Api = KnownApi | (string & {});

/** Cost structure per million tokens. */
export interface ModelCost {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}

/** Descriptor for a specific LLM model. */
export interface ModelDescriptor {
    /** Model identifier (e.g., "claude-opus-4-6"). */
    id: string;
    /** Human-readable model name. */
    name?: string;
    /** API transport to use. */
    api: Api;
    /** Provider name (e.g., "anthropic", "openai"). */
    provider: string;
    /** API base URL. */
    baseUrl?: string;
    /** Whether the model supports reasoning/thinking. */
    reasoning?: boolean;
    /** Supported input modalities. */
    input?: ("text" | "image")[];
    /** Token cost structure. */
    cost?: ModelCost;
    /** Maximum context window in tokens. */
    contextWindow?: number;
    /** Maximum output tokens. */
    maxTokens?: number;
    /** Custom headers to send with requests. */
    headers?: Record<string, string>;
    /** Provider-specific compatibility flags. */
    compat?: Record<string, unknown>;
}

/** Configuration for a single provider's model catalog. */
export interface ProviderConfig {
    /** API base URL. */
    baseUrl?: string;
    /** Default API transport. */
    api?: Api;
    /** Available models. */
    models?: ModelDescriptor[];
}

/** Authentication mode for a provider. */
export type AuthMode =
    | "api-key"
    | "oauth"
    | "token"
    | "mixed"
    | "aws-sdk"
    | "unknown";

/**
 * Resolved authentication for a provider call.
 *
 * This is a discriminated union on `mode`. Each variant carries only the
 * fields that are meaningful for that authentication mechanism:
 *
 * - **`"api-key"`** — `apiKey` is always present. `source` indicates where
 *   the key was found (`"explicit"`, `"env:<VAR_NAME>"`, etc.).
 * - **`"aws-sdk"`** — No API key. Credentials come from the AWS SDK credential
 *   chain (environment, `~/.aws/credentials`, IAM role, etc.). `profileId` is
 *   optionally set to the named AWS profile.
 * - **`"oauth"`** / **`"token"`** — Token-based auth; `apiKey` carries the
 *   bearer token.
 * - **`"none"`** — No authentication required.
 * - **`"mixed"`** / **`"unknown"`** — Fallback variants for providers with
 *   complex or undetermined auth requirements.
 *
 * @example Narrowing by mode:
 * ```ts
 * const auth = resolveAuth("anthropic", connector.envVars);
 * if (auth?.mode === "api-key") {
 *   // auth.apiKey is guaranteed to be a non-empty string here
 *   headers["x-api-key"] = auth.apiKey;
 * }
 * ```
 */
export type ResolvedAuth =
    | {
        mode: "api-key";
        /** The resolved API key (always present for this mode). */
        apiKey: string;
        /** Where the key was found: `"explicit"`, `"env:<VAR_NAME>"`, etc. */
        source: string;
        profileId?: undefined;
    }
    | {
        mode: "aws-sdk";
        /** Named AWS profile, if applicable. */
        profileId?: string;
        apiKey?: undefined;
        source?: undefined;
    }
    | {
        mode: "oauth" | "token";
        /** Bearer token. */
        apiKey: string;
        source: string;
        profileId?: undefined;
    }
    | {
        mode: "none";
        apiKey?: undefined;
        source?: undefined;
        profileId?: undefined;
    }
    | {
        mode: "mixed" | "unknown";
        apiKey?: string;
        source?: string;
        profileId?: string;
    };

// =============================================================================
// Stream Event Types
// =============================================================================

/**
 * Token-usage information reported by the LLM on a completed turn.
 *
 * Fields are optional so that connectors which only have partial usage data
 * (e.g. only input-token counts) do not need to synthesise zeros.
 */
export interface UsageInfo {
    inputTokens?: number;
    outputTokens?: number;
}

/**
 * Events emitted by a {@link Connector} during a single LLM streaming turn.
 *
 * ## Stream Protocol
 *
 * ### Guaranteed events (always present)
 *
 * - **`start`** — Always the first event. Signals that the HTTP connection is
 *   established and streaming has begun.
 * - **`done`** — Always the last event on a _successful_ turn. Contains the
 *   terminal `stopReason` and optional token-usage data. After `done` the
 *   async iterator ends.
 * - **`error`** — Replaces `done` when the provider returns a stream-level
 *   error. After `error` the async iterator ends. `done` is **not** also
 *   emitted in this case.
 *
 * ### Text events (provider-dependent)
 *
 * - **`text_delta`** — Incremental text token. Accumulate these to build the
 *   full response string.
 * - **`text_end`** — Emitted once when a text block finishes. The `content`
 *   field equals the full accumulated text. Treating `text_end` as an
 *   alternative to accumulating `text_delta`s is valid, but `text_end` is not
 *   always emitted — in particular, some providers may end a text block with a
 *   `toolcall_start` without a preceding `text_end`. Always accumulate
 *   `text_delta`s as the primary signal.
 *
 * ### Thinking events (provider-dependent)
 *
 * Same semantics as text events but for reasoning/thinking blocks. Only
 * emitted by providers/models that support extended thinking (see
 * `ModelDescriptor.reasoning`).
 *
 * - **`thinking_delta`** — Incremental thinking token.
 * - **`thinking_end`** — Full accumulated thinking content.
 *
 * ### Tool-call events
 *
 * Tool calls are streamed in three phases:
 *
 * 1. **`toolcall_start`** — A new tool call has begun. The optional `id`
 *    field is populated when the provider reveals the call ID at the start of
 *    the call (e.g. Anthropic). If absent, the ID is only available at
 *    `toolcall_end`.
 * 2. **`toolcall_delta`** — Incremental JSON fragment of the tool arguments.
 *    The optional `id` mirrors the id from the corresponding `toolcall_start`
 *    when the provider supports it.
 * 3. **`toolcall_end`** — The tool call is complete. `toolCall.id`,
 *    `toolCall.name`, and `toolCall.arguments` are fully resolved here.
 *
 * **Multiple concurrent tool calls:** Some providers (e.g. Anthropic with
 * parallel tool use) may interleave events for multiple tool calls in the same
 * stream. Use the `id` fields on `toolcall_start` / `toolcall_delta` to
 * correlate delta fragments to the correct call.
 *
 * ### Tool-use loop pattern
 *
 * When `done.stopReason === "toolUse"` the LLM expects tool results to be fed
 * back. Collect all `toolcall_end` events from the stream, execute the tools,
 * then add a `ToolResultMessage` for each result to the conversation and call
 * `connector.stream()` again:
 *
 * ```ts
 * const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
 * for await (const event of connector.stream(model, context, options)) {
 *   if (event.type === "text_delta") process.stdout.write(event.delta);
 *   if (event.type === "toolcall_end") toolCalls.push(event.toolCall);
 *   if (event.type === "done" && event.stopReason === "toolUse") {
 *     // Execute tools and build tool-result messages...
 *   }
 *   if (event.type === "error") throw new Error(event.error);
 * }
 * ```
 *
 * ### Usage data
 *
 * `done.usage` is populated by providers that report token counts. When absent
 * it means the provider does not expose usage data for this call — treat it as
 * unavailable, not as zero. The built-in pi-ai bridge always populates usage
 * for Anthropic, OpenAI, and Google providers. The debug connector always
 * populates usage with a rough token estimate.
 *
 * ### `stopReason: "error"` on `done`
 *
 * A `done` event with `stopReason: "error"` indicates the provider terminated
 * the stream with a non-exception error condition (e.g. a content-policy
 * refusal that produces a stop reason but no exception). This is distinct from
 * the `error` event, which signals an exception in the stream pipeline. When
 * `stopReason: "error"` is received without a preceding `error` event, treat
 * it as an empty response with no recoverable content. A preceding `error`
 * event is **not** guaranteed in this case.
 */
export type StreamEvent =
    | { type: "start" }
    | { type: "text_delta"; delta: string }
    | { type: "text_end"; content: string }
    | { type: "thinking_delta"; delta: string }
    | { type: "thinking_end"; content: string }
    | {
        type: "toolcall_start";
        /**
         * The tool-call ID, if available at stream-start time.
         *
         * Populated by connectors that receive the ID before the argument
         * stream begins (e.g. Anthropic). May be `undefined` for providers
         * that only resolve the ID at `toolcall_end`.
         */
        id?: string;
    }
    | {
        type: "toolcall_delta";
        delta: string;
        /**
         * The tool-call ID this delta belongs to.
         *
         * Mirrors the `id` from the corresponding `toolcall_start` event.
         * Useful for correlating deltas when multiple tool calls are in-flight
         * in the same stream (e.g. Anthropic parallel tool use).
         */
        id?: string;
    }
    | {
        type: "toolcall_end";
        toolCall: {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
        };
    }
    | {
        type: "done";
        stopReason: "stop" | "toolUse" | "length" | "error";
        usage?: UsageInfo;
    }
    | { type: "error"; error: string };

// =============================================================================
// Conversation Message Types
// =============================================================================

/**
 * A user turn in the conversation.
 *
 * `content` can be a plain string or a multimodal array of blocks (text,
 * image_url, …) following the provider's expected shape.
 */
export interface UserMessage {
    role: "user";
    content: string | Array<{ type: string; [key: string]: unknown }>;
}

/**
 * An assistant turn in the conversation.
 *
 * `content` may be a plain string, a multimodal block array, or null for
 * tool-use-only responses.
 */
export interface AssistantMessage {
    role: "assistant";
    content: string | null | Array<{ type: string; [key: string]: unknown }>;
}

/** Union of all first-class conversation message types. */
export type ConversationMessage = UserMessage | AssistantMessage;

/**
 * Union of all message types that can appear in a conversation history array,
 * including tool results fed back into the context.
 *
 * Use this type when storing or typing the full message history passed to a
 * connector via {@link StreamContext.messages}.
 */
export type ContextMessage = UserMessage | AssistantMessage | ToolResultMessage;

/**
 * A tool result message — clawtools' internal format for feeding tool
 * execution results back into the conversation.
 *
 * **This is NOT the same as OpenAI's `role: "tool"` or Anthropic's nested
 * `role: "user"` + `type: "tool_result"` blocks.** See `docs/usage/messages.md`
 * for the full protocol and a wrong-vs-right comparison table.
 */
export interface ToolResultMessage {
    role: "toolResult";
    /** Matches the `toolCall.id` from the assistant message that triggered this call. */
    toolCallId: string;
    /** The tool name (for logging/debugging; not strictly required by the connector). */
    toolName: string;
    /** One or more content blocks — text and/or images. */
    content: Array<TextContent | ImageContent>;
    /** True when the tool threw an error. */
    isError: boolean;
}

// =============================================================================
// Connector Definition
// =============================================================================

/**
 * A minimal JSON Schema object suitable for describing LLM tool input schemas.
 *
 * This covers the common subset used when passing tool definitions to LLM
 * providers via {@link StreamContext}. The `type` field is required for
 * top-level schemas (typically `"object"`). All other fields are optional so
 * that simple schemas (`{}`, `{ type: "string" }`) and complex ones
 * (`$defs`, `anyOf`, …) are equally accepted.
 *
 * @example
 * ```ts
 * const schema: JsonSchema = {
 *   type: "object",
 *   properties: {
 *     message: { type: "string", description: "Text to echo" },
 *   },
 *   required: ["message"],
 * };
 * ```
 */
export interface JsonSchema {
    type?: string;
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    description?: string;
    enum?: unknown[];
    const?: unknown;
    anyOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    allOf?: JsonSchema[];
    $ref?: string;
    $defs?: Record<string, JsonSchema>;
    [key: string]: unknown;
}

/** Options passed to a connector's stream function. */
export interface StreamOptions {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    apiKey?: string;
    headers?: Record<string, string>;
}

/** Context for an LLM invocation. */
export interface StreamContext {
    systemPrompt?: string;
    messages: Array<UserMessage | AssistantMessage | ToolResultMessage>;
    /**
     * Tool definitions to include in this invocation.
     *
     * Each tool's `input_schema` should be a JSON Schema object (or a TypeBox
     * schema, which compiles to JSON Schema). Use the {@link JsonSchema}
     * interface for type-safe construction, or `Record<string, unknown>` when
     * passing through an opaque schema from an external source.
     */
    tools?: Array<{ name: string; description: string; input_schema: JsonSchema | Record<string, unknown> }>;
}

/**
 * A connector provides access to an LLM provider's streaming API.
 *
 * Connectors are the bridge between clawtools and external LLM services.
 * Each connector implements a specific API transport protocol.
 */
export interface Connector {
    /** Unique connector identifier (typically the API transport name). */
    id: string;
    /** Human-readable display name. */
    label: string;
    /** Provider this connector is for (e.g., "anthropic", "openai"). */
    provider: string;
    /** API transport protocol. */
    api: Api;
    /**
     * Available models for this connector.
     *
     * Every built-in connector ships with a populated model list. For
     * connectors that fetch their model catalog dynamically (e.g. from a
     * remote registry), implement {@link listModels} and set this to an
     * empty array as the initial value.
     */
    models: ModelDescriptor[];
    /** Environment variable names for API key resolution. */
    envVars?: string[];
    /**
     * Fetch the connector's full model catalog asynchronously.
     *
     * Implement this method on connectors whose model list may change at
     * runtime or must be fetched from a remote API (e.g. a self-hosted LLM
     * registry). When present, callers should prefer `listModels()` over
     * the static `models` array for up-to-date data.
     *
     * If absent, consumers fall back to the static `models` array.
     */
    listModels?: () => Promise<ModelDescriptor[]>;

    /**
     * Stream a response from the LLM.
     *
     * @param model - Model descriptor to use.
     * @param context - System prompt, messages, and tools.
     * @param options - Streaming options (temperature, abort, etc.).
     * @returns An async iterable of stream events.
     */
    stream: (
        model: ModelDescriptor,
        context: StreamContext,
        options: StreamOptions,
    ) => AsyncIterable<StreamEvent>;
}

// =============================================================================
// Plugin Extension Types
// =============================================================================

/**
 * A plugin that can register tools, hooks, and other extensions.
 * This mirrors OpenClaw's plugin definition pattern.
 */
export interface PluginDefinition {
    id: string;
    name?: string;
    description?: string;
    version?: string;

    /** Register tools, hooks, and other extensions via the API. */
    register?: (api: PluginApi) => void | Promise<void>;
    /** Alias for register (supported by OpenClaw). */
    activate?: (api: PluginApi) => void | Promise<void>;
}

/**
 * The API surface available to plugins during registration.
 *
 * This mirrors OpenClaw's `OpenClawPluginApi` with all 12 registration methods.
 * Only `registerTool` and `registerConnector` are actively handled by clawtools.
 * All other methods are accepted (no-op) so that OpenClaw plugins can call them
 * without throwing, but their registrations are silently discarded.
 */
export interface PluginApi {
    /** Plugin identity. */
    id: string;
    name: string;

    // ===========================================================================
    // Active — registrations are collected and used by clawtools
    // ===========================================================================

    /** Register a tool or tool factory. */
    registerTool: (
        tool: Tool | ToolFactory,
        opts?: { name?: string; names?: string[]; optional?: boolean },
    ) => void;

    /** Register a connector. */
    registerConnector: (connector: Connector) => void;

    // ===========================================================================
    // No-op — accepted for OpenClaw compatibility but silently discarded.
    // These exist so that OpenClaw plugins can call their full registration API
    // without errors when loaded through clawtools.
    // ===========================================================================

    /**
     * Register a lifecycle hook handler.
     * @remarks No-op in clawtools — hooks require the OpenClaw runtime.
     */
    registerHook: (
        events: string | string[],
        handler: (...args: unknown[]) => unknown,
        opts?: { entry?: unknown; name?: string; description?: string; register?: boolean },
    ) => void;

    /**
     * Register an HTTP request handler (catch-all).
     * @remarks No-op in clawtools — requires the OpenClaw gateway server.
     */
    registerHttpHandler: (handler: (...args: unknown[]) => unknown) => void;

    /**
     * Register an HTTP route handler at a specific path.
     * @remarks No-op in clawtools — requires the OpenClaw gateway server.
     */
    registerHttpRoute: (params: { path: string; handler: (...args: unknown[]) => unknown }) => void;

    /**
     * Register a messaging channel plugin.
     * @remarks No-op in clawtools — channels require the OpenClaw messaging runtime.
     */
    registerChannel: (registration: unknown) => void;

    /**
     * Register a gateway RPC method.
     * @remarks No-op in clawtools — requires the OpenClaw gateway server.
     */
    registerGatewayMethod: (method: string, handler: (...args: unknown[]) => unknown) => void;

    /**
     * Register CLI subcommands via a Commander.js registrar function.
     * @remarks No-op in clawtools — requires the OpenClaw CLI runtime.
     */
    registerCli: (registrar: (...args: unknown[]) => unknown, opts?: { commands?: string[] }) => void;

    /**
     * Register a long-running background service.
     * @remarks No-op in clawtools — services require the OpenClaw service lifecycle manager.
     */
    registerService: (service: { id: string; start: (...args: unknown[]) => unknown; stop?: (...args: unknown[]) => unknown }) => void;

    /**
     * Register an LLM provider with auth methods and model catalog.
     * @remarks No-op in clawtools — provider auth requires the OpenClaw wizard/prompter system.
     */
    registerProvider: (provider: unknown) => void;

    /**
     * Register a custom command that bypasses the LLM agent.
     * @remarks No-op in clawtools — commands require the OpenClaw command router.
     */
    registerCommand: (command: { name: string; description: string; handler: (...args: unknown[]) => unknown }) => void;

    /**
     * Resolve a path relative to the plugin's directory.
     *
     * @remarks **Placeholder — currently returns `input` unchanged.**
     * In OpenClaw, this resolves paths relative to the plugin's own directory.
     * In clawtools, no plugin directory context is available at registration
     * time, so this is a no-op stub reserved for future resolution logic.
     */
    resolvePath: (input: string) => string;

    /**
     * Register a typed lifecycle hook handler (alternative to registerHook).
     * @remarks No-op in clawtools — hooks require the OpenClaw runtime.
     */
    on: (hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) => void;
}
