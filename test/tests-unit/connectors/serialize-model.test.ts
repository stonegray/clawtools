import { describe, it, expect } from "vitest";
import { serializeModel, deserializeModel } from "clawtools/connectors";
import type { ModelDescriptor } from "clawtools";

// =============================================================================
// serializeModel
// =============================================================================

describe("serializeModel", () => {
    it("maps id, api, provider (required fields)", () => {
        const result = serializeModel({
            id: "claude-opus-4",
            api: "anthropic-messages",
            provider: "anthropic",
        });
        expect(result.id).toBe("claude-opus-4");
        expect(result.api).toBe("anthropic-messages");
        expect(result.provider).toBe("anthropic");
    });

    it("maps baseUrl → base_url", () => {
        const result = serializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
            baseUrl: "https://api.openai.com/v1",
        });
        expect(result.base_url).toBe("https://api.openai.com/v1");
        expect((result as Record<string, unknown>).baseUrl).toBeUndefined();
    });

    it("maps contextWindow → context_window", () => {
        const result = serializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
            contextWindow: 128_000,
        });
        expect(result.context_window).toBe(128_000);
        expect((result as Record<string, unknown>).contextWindow).toBeUndefined();
    });

    it("maps maxTokens → max_tokens", () => {
        const result = serializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
            maxTokens: 4096,
        });
        expect(result.max_tokens).toBe(4096);
        expect((result as Record<string, unknown>).maxTokens).toBeUndefined();
    });

    it("maps cost.cacheRead → cost.cache_read and cost.cacheWrite → cost.cache_write", () => {
        const result = serializeModel({
            id: "m",
            api: "anthropic-messages",
            provider: "anthropic",
            cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        });
        expect(result.cost).toEqual({
            input: 3,
            output: 15,
            cache_read: 0.3,
            cache_write: 3.75,
        });
        expect((result.cost as Record<string, unknown>)?.cacheRead).toBeUndefined();
        expect((result.cost as Record<string, unknown>)?.cacheWrite).toBeUndefined();
    });

    it("omits fields that are not present on the descriptor", () => {
        const result = serializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
        });
        expect(result.base_url).toBeUndefined();
        expect(result.context_window).toBeUndefined();
        expect(result.max_tokens).toBeUndefined();
        expect(result.cost).toBeUndefined();
        expect(result.name).toBeUndefined();
    });

    it("passes through reasoning, input, headers, compat unchanged", () => {
        const result = serializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
            reasoning: true,
            input: ["text", "image"],
            headers: { "x-custom": "value" },
            compat: { streaming: true },
        });
        expect(result.reasoning).toBe(true);
        expect(result.input).toEqual(["text", "image"]);
        expect(result.headers).toEqual({ "x-custom": "value" });
        expect(result.compat).toEqual({ streaming: true });
    });

    it("roundtrips through deserializeModel without data loss", () => {
        const original: ModelDescriptor = {
            id: "claude-opus-4",
            name: "Claude Opus 4",
            api: "anthropic-messages",
            provider: "anthropic",
            baseUrl: "https://api.anthropic.com",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
            contextWindow: 200_000,
            maxTokens: 32_768,
            headers: { "anthropic-version": "2023-06-01" },
            compat: { streaming: true },
        };
        const serialized = serializeModel(original);
        const restored = deserializeModel(serialized);
        expect(restored).toEqual(original);
    });
});

// =============================================================================
// deserializeModel
// =============================================================================

describe("deserializeModel", () => {
    it("maps base_url → baseUrl", () => {
        const result = deserializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
            base_url: "https://api.openai.com/v1",
        });
        expect(result.baseUrl).toBe("https://api.openai.com/v1");
        expect((result as Record<string, unknown>).base_url).toBeUndefined();
    });

    it("maps context_window → contextWindow", () => {
        const result = deserializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
            context_window: 128_000,
        });
        expect(result.contextWindow).toBe(128_000);
    });

    it("maps max_tokens → maxTokens", () => {
        const result = deserializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
            max_tokens: 4096,
        });
        expect(result.maxTokens).toBe(4096);
    });

    it("maps cost.cache_read → cost.cacheRead and cache_write → cacheWrite", () => {
        const result = deserializeModel({
            id: "m",
            api: "anthropic-messages",
            provider: "anthropic",
            cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        });
        expect(result.cost).toEqual({
            input: 3,
            output: 15,
            cacheRead: 0.3,
            cacheWrite: 3.75,
        });
    });

    it("omits fields absent from the serialized object", () => {
        const result = deserializeModel({
            id: "m",
            api: "openai-completions",
            provider: "openai",
        });
        expect(result.baseUrl).toBeUndefined();
        expect(result.contextWindow).toBeUndefined();
        expect(result.maxTokens).toBeUndefined();
        expect(result.cost).toBeUndefined();
    });
});
