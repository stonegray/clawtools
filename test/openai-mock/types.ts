/**
 * Types for configuring the OpenAI-compatible mock server.
 *
 * A `MockScenario` tells the server what to return for the next request.
 * Set one before each test assertion with `server.setScenario(...)`.
 */

// =============================================================================
// Scenarios
// =============================================================================

/**
 * Stream a text response, split into word-size SSE chunks.
 */
export interface TextScenario {
    type: "text";
    /** Full response text. Streamed as individual word chunks. */
    content: string;
    /** Words per SSE chunk. Defaults to 1. */
    chunkSize?: number;
    /** Model name echoed back in the response. Defaults to "gpt-4o-mini". */
    model?: string;
}

/**
 * Stream a single tool call, with arguments streamed in small parts.
 */
export interface ToolCallScenario {
    type: "tool_call";
    /** Tool call ID. Defaults to "call_test_123". */
    id?: string;
    /** The tool name the LLM is calling. */
    name: string;
    /** Arguments for the tool call (serialized and streamed). */
    args: Record<string, unknown>;
    /** Model name echoed back. Defaults to "gpt-4o-mini". */
    model?: string;
}

/**
 * Return an HTTP error response (non-2xx status + OpenAI error body).
 */
export interface ErrorScenario {
    type: "error";
    /** HTTP status code (e.g. 401, 429, 500). */
    status: number;
    /** Error message in the response body. */
    message: string;
    /** OpenAI error code string. Defaults to "api_error". */
    code?: string;
}

/** Union of all possible mock server behaviors. */
export type MockScenario = TextScenario | ToolCallScenario | ErrorScenario;

// =============================================================================
// Request capture
// =============================================================================

/** A request captured by the mock server for test assertions. */
export interface CapturedRequest {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    /** Parsed JSON body, or null for GET requests. */
    body: Record<string, unknown> | null;
    timestamp: number;
}
