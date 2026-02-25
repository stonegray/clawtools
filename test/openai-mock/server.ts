/**
 * OpenAI-compatible mock HTTP server.
 *
 * Implements:
 *   GET  /v1/models                — returns a small static model list
 *   POST /v1/chat/completions      — streaming SSE or non-streaming JSON
 *
 * Configure the server's behavior per-test with `setScenario()`.
 * Inspect what was sent to the server with `getRequests()`.
 */

import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type {
    CapturedRequest,
    ErrorScenario,
    MockScenario,
    TextScenario,
    ToolCallScenario,
} from "./types.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_SCENARIO: MockScenario = {
    type: "text",
    content: "Hello from mock server!",
};

export class OpenAIMockServer {
    private server: Server;
    private scenario: MockScenario = { ...DEFAULT_SCENARIO };
    private captured: CapturedRequest[] = [];
    private _port = 0;

    constructor() {
        this.server = createServer((req, res) => {
            void this.dispatch(req, res);
        });
    }

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(0, "127.0.0.1", () => {
                this.server.off("error", reject);
                const addr = this.server.address();
                this._port = (addr as { port: number }).port;
                resolve();
            });
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.close((err) => (err ? reject(err) : resolve()));
        });
    }

    // ---------------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------------

    get url(): string {
        return `http://127.0.0.1:${this._port}`;
    }

    get port(): number {
        return this._port;
    }

    /** Set the scenario the server will use for the next (and all subsequent) requests. */
    setScenario(scenario: MockScenario): this {
        this.scenario = scenario;
        return this;
    }

    /** Reset to the default text scenario. */
    resetScenario(): this {
        this.scenario = { ...DEFAULT_SCENARIO };
        return this;
    }

    // ---------------------------------------------------------------------------
    // Request capture
    // ---------------------------------------------------------------------------

    getRequests(): CapturedRequest[] {
        return [...this.captured];
    }

    lastRequest(): CapturedRequest | undefined {
        return this.captured[this.captured.length - 1];
    }

    clearRequests(): void {
        this.captured = [];
    }

    // ---------------------------------------------------------------------------
    // Internal: routing
    // ---------------------------------------------------------------------------

    private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const body = await readBody(req);
        const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : null;

        this.captured.push({
            method: req.method ?? "GET",
            path: req.url ?? "/",
            headers: req.headers as Record<string, string | string[] | undefined>,
            body: parsed,
            timestamp: Date.now(),
        });

        if (req.method === "GET" && req.url === "/v1/models") {
            return this.sendModels(res);
        }

        if (req.method === "POST" && req.url === "/v1/chat/completions") {
            const stream = parsed?.stream === true;
            return this.sendCompletions(res, parsed ?? {}, stream);
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Not found", type: "not_found" } }));
    }

    // ---------------------------------------------------------------------------
    // Internal: handlers
    // ---------------------------------------------------------------------------

    private sendModels(res: ServerResponse): void {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                object: "list",
                data: [
                    { id: "gpt-4o-mini", object: "model", created: 1686935002, owned_by: "mock" },
                    { id: "gpt-4o", object: "model", created: 1686935002, owned_by: "mock" },
                ],
            }),
        );
    }

    private sendCompletions(
        res: ServerResponse,
        _body: Record<string, unknown>,
        stream: boolean,
    ): void {
        const scenario = this.scenario;

        if (scenario.type === "error") {
            return this.sendError(res, scenario);
        }

        if (!stream) {
            return this.sendNonStreaming(res, scenario);
        }

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });

        if (scenario.type === "text") {
            this.streamText(res, scenario);
        } else if (scenario.type === "tool_call") {
            this.streamToolCall(res, scenario);
        }
    }

    private sendError(res: ServerResponse, scenario: ErrorScenario): void {
        res.writeHead(scenario.status, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                error: {
                    message: scenario.message,
                    type: "api_error",
                    code: scenario.code ?? "api_error",
                },
            }),
        );
    }

    private sendNonStreaming(res: ServerResponse, scenario: TextScenario | ToolCallScenario): void {
        const model = scenario.model ?? DEFAULT_MODEL;
        const id = `chatcmpl-mock-${Date.now()}`;

        if (scenario.type === "text") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    id,
                    object: "chat.completion",
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [
                        {
                            index: 0,
                            message: { role: "assistant", content: scenario.content },
                            finish_reason: "stop",
                        },
                    ],
                    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
                }),
            );
        } else {
            // tool_call — return as a non-streaming message with tool_calls
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    id,
                    object: "chat.completion",
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: null,
                                tool_calls: [
                                    {
                                        id: scenario.id ?? "call_test_123",
                                        type: "function",
                                        function: { name: scenario.name, arguments: JSON.stringify(scenario.args) },
                                    },
                                ],
                            },
                            finish_reason: "tool_calls",
                        },
                    ],
                    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
                }),
            );
        }
    }

    private streamText(res: ServerResponse, scenario: TextScenario): void {
        const id = `chatcmpl-mock-${Date.now()}`;
        const model = scenario.model ?? DEFAULT_MODEL;
        const created = Math.floor(Date.now() / 1000);

        const emit = (delta: object, finishReason: string | null = null): void => {
            const chunk = JSON.stringify({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta, finish_reason: finishReason }],
            });
            res.write(`data: ${chunk}\n\n`);
        };

        // Role announce
        emit({ role: "assistant", content: "" });

        // Stream content in word-chunks
        const words = scenario.content.split(" ");
        const chunkSize = scenario.chunkSize ?? 1;

        for (let i = 0; i < words.length; i += chunkSize) {
            const slice = words.slice(i, i + chunkSize).join(" ");
            // Preserve spaces between chunks
            const text = i === 0 ? slice : ` ${slice}`;
            emit({ content: text });
        }

        emit({}, "stop");
        res.write("data: [DONE]\n\n");
        res.end();
    }

    private streamToolCall(res: ServerResponse, scenario: ToolCallScenario): void {
        const id = `chatcmpl-mock-${Date.now()}`;
        const model = scenario.model ?? DEFAULT_MODEL;
        const created = Math.floor(Date.now() / 1000);
        const callId = scenario.id ?? "call_test_123";

        const emit = (delta: object, finishReason: string | null = null): void => {
            const chunk = JSON.stringify({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta, finish_reason: finishReason }],
            });
            res.write(`data: ${chunk}\n\n`);
        };

        // Tool call header chunk
        emit({
            role: "assistant",
            content: null,
            tool_calls: [
                {
                    index: 0,
                    id: callId,
                    type: "function",
                    function: { name: scenario.name, arguments: "" },
                },
            ],
        });

        // Stream arguments in small parts (~10 chars each)
        const argsStr = JSON.stringify(scenario.args);
        const partSize = 10;
        for (let i = 0; i < argsStr.length; i += partSize) {
            emit({ tool_calls: [{ index: 0, function: { arguments: argsStr.slice(i, i + partSize) } }] });
        }

        emit({}, "tool_calls");
        res.write("data: [DONE]\n\n");
        res.end();
    }
}

// ---------------------------------------------------------------------------
// Internal: body reader
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: Buffer) => {
            data += chunk.toString();
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}
