import { describe, it, expect } from "vitest";
import { jsonResult, textResult, errorResult, imageResult } from "clawtools/tools";

describe("Tool result helpers", () => {
    // ---------------------------------------------------------------------------
    // jsonResult
    // ---------------------------------------------------------------------------

    describe("jsonResult", () => {
        it("produces a single text block with pretty-printed JSON", () => {
            const r = jsonResult({ foo: "bar" });
            expect(r.content).toHaveLength(1);
            const block = r.content[0] as { type: string; text: string };
            expect(block.type).toBe("text");
            expect(block.text).toBe(JSON.stringify({ foo: "bar" }, null, 2));
        });

        it("sets details to the original payload", () => {
            const payload = { x: 1 };
            expect(jsonResult(payload).details).toBe(payload);
        });

        it("handles null", () => {
            const r = jsonResult(null);
            expect((r.content[0] as { type: string; text: string }).text).toBe("null");
        });

        it("handles arrays", () => {
            const r = jsonResult([1, 2, 3]);
            const text = (r.content[0] as { type: string; text: string }).text;
            expect(JSON.parse(text)).toEqual([1, 2, 3]);
        });

        it("handles nested objects", () => {
            const obj = { a: { b: { c: 42 } } };
            const r = jsonResult(obj);
            expect(JSON.parse((r.content[0] as { type: string; text: string }).text)).toEqual(obj);
        });
    });

    // ---------------------------------------------------------------------------
    // textResult
    // ---------------------------------------------------------------------------

    describe("textResult", () => {
        it("creates a text content block", () => {
            const r = textResult("hello world");
            expect(r.content[0]).toMatchObject({ type: "text", text: "hello world" });
        });

        it("sets details when provided", () => {
            const r = textResult("hello", { key: "value" });
            expect(r.details).toEqual({ key: "value" });
        });

        it("details is undefined when not provided", () => {
            expect(textResult("hello").details).toBeUndefined();
        });
    });

    // ---------------------------------------------------------------------------
    // errorResult
    // ---------------------------------------------------------------------------

    describe("errorResult", () => {
        it("produces JSON with status=error", () => {
            const r = errorResult("my_tool", "Something failed");
            const text = (r.content[0] as { type: string; text: string }).text;
            expect(JSON.parse(text)).toMatchObject({
                status: "error",
                tool: "my_tool",
                error: "Something failed",
            });
        });

        it("sets details with error info", () => {
            const r = errorResult("my_tool", "oops");
            expect(r.details).toMatchObject({ status: "error", tool: "my_tool", error: "oops" });
        });

        it("content is parseable JSON", () => {
            const r = errorResult("t", "e");
            expect(() => JSON.parse((r.content[0] as { type: string; text: string }).text)).not.toThrow();
        });
    });

    // ---------------------------------------------------------------------------
    // imageResult
    // ---------------------------------------------------------------------------

    describe("imageResult", () => {
        const baseImage = { label: "test", base64: "abc123=", mimeType: "image/png" };

        it("includes an image block with base64 data", () => {
            const r = imageResult(baseImage);
            const img = r.content.find((b) => b.type === "image") as
                | { type: string; data: string; mimeType: string }
                | undefined;
            expect(img).toBeDefined();
            expect(img!.data).toBe("abc123=");
            expect(img!.mimeType).toBe("image/png");
        });

        it("prepends a MEDIA: text block when path is provided", () => {
            const r = imageResult({ ...baseImage, path: "/tmp/img.png" });
            expect(r.content[0]).toMatchObject({ type: "text", text: "MEDIA:/tmp/img.png" });
        });

        it("includes extraText block when provided", () => {
            const r = imageResult({ ...baseImage, extraText: "Caption" });
            const texts = r.content.filter((b) => b.type === "text") as Array<{
                type: string;
                text: string;
            }>;
            expect(texts.some((b) => b.text === "Caption")).toBe(true);
        });

        it("image block comes after any text blocks", () => {
            const r = imageResult({ ...baseImage, path: "/p", extraText: "desc" });
            expect(r.content.at(-1)?.type).toBe("image");
        });

        it("details defaults to label and path when no custom details given", () => {
            const r = imageResult({ ...baseImage, path: "/p" });
            expect(r.details).toMatchObject({ label: "test", path: "/p" });
        });

        it("uses custom details when provided", () => {
            const r = imageResult({ ...baseImage, details: { custom: true } });
            expect(r.details).toEqual({ custom: true });
        });
    });
});
