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
 * const ct = await createClawtoolsAsync();
 * const tools = ct.tools.resolveAll({
 *   workspaceDir: "/my/project",
 *   root: "/my/project",
 *   bridge: createNodeBridge("/my/project"),
 * });
 * ```
 */
export interface FsBridge {
    stat(args: { filePath: string; cwd?: string }): Promise<FsStat | null>;
    readFile(args: { filePath: string; cwd?: string }): Promise<Buffer>;
    mkdirp(args: { filePath: string; cwd?: string }): Promise<void>;
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

/** Resolved authentication for a provider call. */
export interface ResolvedAuth {
    apiKey?: string;
    profileId?: string;
    source?: string;
    mode: AuthMode;
}

// =============================================================================
// Stream Event Types
// =============================================================================

/** Events emitted during an LLM streaming response. */
export type StreamEvent =
    | { type: "start" }
    | { type: "text_delta"; delta: string }
    | { type: "text_end"; content: string }
    | { type: "thinking_delta"; delta: string }
    | { type: "thinking_end"; content: string }
    | { type: "toolcall_start" }
    | { type: "toolcall_delta"; delta: string }
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
        usage?: { inputTokens: number; outputTokens: number };
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

// =============================================================================
// Connector Definition
// =============================================================================

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
    messages: Array<UserMessage | AssistantMessage>;
    tools?: Array<{ name: string; description: string; input_schema: unknown }>;
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
    /** Available models for this connector. */
    models?: ModelDescriptor[];
    /** Environment variable names for API key resolution. */
    envVars?: string[];

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
     * @remarks Returns the input unchanged in clawtools (no plugin directory context).
     */
    resolvePath: (input: string) => string;

    /**
     * Register a typed lifecycle hook handler (alternative to registerHook).
     * @remarks No-op in clawtools — hooks require the OpenClaw runtime.
     */
    on: (hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) => void;
}
