/**
 * connector-wrapper-poc.ts
 *
 * Proof-of-concept: Wrap an OpenAI-compatible LLM API into the OpenClaw
 * connector shape (ApiProvider interface) with streaming support.
 *
 * Run: OPENAI_API_KEY=sk-... bun respec/example/connector-wrapper-poc.ts
 *   or: OPENAI_API_KEY=sk-... npx tsx respec/example/connector-wrapper-poc.ts
 *
 * If no API key is set, runs in dry-run mode with mock streaming.
 */

// ── Types (extracted from @mariozechner/pi-ai) ──────────────────────

type Api = string;
type Provider = string;
type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

interface TextContent {
  type: "text";
  text: string;
}

interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  timestamp: number;
}

type AssistantMessageEvent =
  | { type: "start"; partial: Partial<AssistantMessage> }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: Partial<AssistantMessage> }
  | { type: "text_end"; contentIndex: number; content: string; partial: Partial<AssistantMessage> }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: Partial<AssistantMessage> }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: Partial<AssistantMessage> }
  | { type: "done"; reason: StopReason; message: AssistantMessage }
  | { type: "error"; reason: "error"; error: AssistantMessage };

interface Model {
  id: string;
  provider: Provider;
  api: Api;
  contextWindow: number;
  maxTokens: number;
}

interface StreamOptions {
  systemPrompt: string;
  messages: Array<{ role: string; content: any }>;
  tools?: Array<{ name: string; description: string; input_schema: object }>;
  temperature?: number;
}

// ── Connector interface ─────────────────────────────────────────────

interface Connector {
  id: string;
  api: Api;
  stream(
    model: Model,
    options: StreamOptions,
    apiKey: string,
  ): AsyncGenerator<AssistantMessageEvent>;
}

// ── SSE Parser ──────────────────────────────────────────────────────

async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event?: string; data: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;

      for (const part of parts) {
        if (!part.trim()) continue;
        let event: string | undefined;
        let data = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
          else if (line.startsWith("data:")) data += line.slice(5);
        }
        if (data) yield { event, data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── OpenAI-compatible connector ─────────────────────────────────────

function createOpenAIConnector(baseUrl = "https://api.openai.com/v1"): Connector {
  return {
    id: "openai-compat",
    api: "openai-completions",

    async *stream(model, options, apiKey) {
      const emptyUsage: Usage = {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };

      const partial: Partial<AssistantMessage> = {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: model.id,
        usage: emptyUsage,
      };

      yield { type: "start", partial };

      // Build messages array
      const messages: any[] = [
        { role: "system", content: options.systemPrompt },
        ...options.messages,
      ];

      // Build request
      const body: any = {
        model: model.id,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      };

      if (options.tools?.length) {
        body.tools = options.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }));
      }

      if (options.temperature != null) {
        body.temperature = options.temperature;
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMsg: AssistantMessage = {
          ...partial as AssistantMessage,
          content: [{ type: "text", text: errorText }],
          stopReason: "error",
          errorMessage: errorText,
          timestamp: Date.now(),
        } as any;
        yield { type: "error", reason: "error", error: errorMsg };
        return;
      }

      // Parse SSE stream
      const textParts: string[] = [];
      const toolCallAccumulators = new Map<number, { id: string; name: string; args: string }>();
      let contentIndex = 0;
      let finishReason: StopReason = "stop";
      let usage = emptyUsage;

      for await (const event of parseSSE(response.body!)) {
        if (event.data === "[DONE]") break;

        let chunk: any;
        try {
          chunk = JSON.parse(event.data);
        } catch {
          continue;
        }

        // Usage from final chunk
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
            cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            cacheWrite: 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (chunk.choices?.[0]?.finish_reason) {
          const fr = chunk.choices[0].finish_reason;
          finishReason = fr === "tool_calls" ? "toolUse" : fr === "stop" ? "stop" : "length";
        }

        // Text content
        if (delta.content) {
          textParts.push(delta.content);
          yield {
            type: "text_delta",
            contentIndex,
            delta: delta.content,
            partial,
          };
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                args: "",
              });
            }
            const acc = toolCallAccumulators.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) {
              acc.args += tc.function.arguments;
              yield {
                type: "toolcall_delta",
                contentIndex: contentIndex + 1 + idx,
                delta: tc.function.arguments,
                partial,
              };
            }
          }
        }
      }

      // Finalize text
      if (textParts.length > 0) {
        const fullText = textParts.join("");
        yield {
          type: "text_end",
          contentIndex,
          content: fullText,
          partial,
        };
        (partial.content as any[]).push({ type: "text", text: fullText });
      }

      // Finalize tool calls
      for (const [, acc] of toolCallAccumulators) {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(acc.args);
        } catch {}
        const toolCall: ToolCall = {
          type: "toolCall",
          id: acc.id,
          name: acc.name,
          arguments: parsedArgs,
        };
        (partial.content as any[]).push(toolCall);
        yield {
          type: "toolcall_end",
          contentIndex: contentIndex + 1,
          toolCall,
          partial,
        };
      }

      // Done
      const finalMessage: AssistantMessage = {
        role: "assistant",
        content: partial.content as any[],
        api: "openai-completions",
        provider: "openai",
        model: model.id,
        usage,
        stopReason: finishReason,
        timestamp: Date.now(),
      };

      yield { type: "done", reason: finishReason, message: finalMessage };
    },
  };
}

// ── Mock connector (no API key needed) ──────────────────────────────

function createMockConnector(): Connector {
  return {
    id: "mock",
    api: "mock",

    async *stream(model, options) {
      const emptyUsage: Usage = {
        input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };

      const partial: Partial<AssistantMessage> = {
        role: "assistant",
        content: [],
        api: "mock",
        provider: "mock",
        model: model.id,
      };

      yield { type: "start", partial };

      // Simulate streaming text
      const words = "Hello! I am a mock connector. This demonstrates the streaming interface.".split(" ");
      let fullText = "";
      for (const word of words) {
        const delta = (fullText ? " " : "") + word;
        fullText += delta;
        yield { type: "text_delta", contentIndex: 0, delta, partial };
        await new Promise((r) => setTimeout(r, 50)); // Simulate latency
      }

      yield { type: "text_end", contentIndex: 0, content: fullText, partial };
      (partial.content as any[]).push({ type: "text", text: fullText });

      // Simulate a tool call if tools are provided
      if (options.tools?.length) {
        const tool = options.tools[0];
        const toolCall: ToolCall = {
          type: "toolCall",
          id: `mock_call_${Date.now()}`,
          name: tool.name,
          arguments: { example: "value" },
        };

        yield {
          type: "toolcall_end",
          contentIndex: 1,
          toolCall,
          partial,
        };
        (partial.content as any[]).push(toolCall);
      }

      const stopReason: StopReason = options.tools?.length ? "toolUse" : "stop";
      const finalMessage: AssistantMessage = {
        role: "assistant",
        content: partial.content as any[],
        api: "mock",
        provider: "mock",
        model: model.id,
        usage: emptyUsage,
        stopReason,
        timestamp: Date.now(),
      };

      yield { type: "done", reason: stopReason, message: finalMessage };
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== OpenClaw Connector Wrapper PoC ===\n");

  const apiKey = process.env.OPENAI_API_KEY;
  const connector = apiKey ? createOpenAIConnector() : createMockConnector();
  const modelId = apiKey ? "gpt-4o-mini" : "mock-model";

  console.log(`Using connector: ${connector.id}`);
  if (!apiKey) console.log("(No OPENAI_API_KEY set — using mock connector)\n");

  const model: Model = {
    id: modelId,
    provider: connector.id,
    api: connector.api,
    contextWindow: 128000,
    maxTokens: 4096,
  };

  const options: StreamOptions = {
    systemPrompt: "You are a helpful assistant. Be brief.",
    messages: [{ role: "user", content: "What is 2+2? Answer in one word." }],
    tools: [
      {
        name: "calculator",
        description: "Perform arithmetic",
        input_schema: {
          type: "object",
          properties: {
            expression: { type: "string", description: "Math expression" },
          },
          required: ["expression"],
        },
      },
    ],
  };

  console.log("Streaming response:");
  process.stdout.write("  ");

  let finalMessage: AssistantMessage | undefined;
  for await (const event of connector.stream(model, options, apiKey ?? "")) {
    switch (event.type) {
      case "start":
        break;
      case "text_delta":
        process.stdout.write(event.delta);
        break;
      case "text_end":
        process.stdout.write("\n");
        break;
      case "toolcall_end":
        console.log(`\n  [Tool call: ${event.toolCall.name}(${JSON.stringify(event.toolCall.arguments)})]`);
        break;
      case "done":
        finalMessage = event.message;
        break;
      case "error":
        console.error(`\n  ERROR: ${JSON.stringify(event.error)}`);
        break;
    }
  }

  if (finalMessage) {
    console.log(`\n  Stop reason: ${finalMessage.stopReason}`);
    console.log(`  Usage: ${finalMessage.usage.input}in / ${finalMessage.usage.output}out / ${finalMessage.usage.totalTokens}total`);
    console.log(`  Content blocks: ${finalMessage.content.length}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
