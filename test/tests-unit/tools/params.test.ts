import { describe, it, expect } from "vitest";
import {
    readStringParam,
    readNumberParam,
    readBooleanParam,
    readStringArrayParam,
    assertRequiredParams,
    ToolInputError,
    ToolAuthorizationError,
} from "clawtools/tools";

describe("Parameter helpers", () => {
    // ---------------------------------------------------------------------------
    // readStringParam
    // ---------------------------------------------------------------------------

    describe("readStringParam", () => {
        it("reads a present string", () => {
            expect(readStringParam({ name: "alice" }, "name")).toBe("alice");
        });

        it("trims whitespace by default", () => {
            expect(readStringParam({ name: "  alice  " }, "name")).toBe("alice");
        });

        it("returns undefined when optional and missing", () => {
            expect(readStringParam({}, "name")).toBeUndefined();
        });

        it("throws ToolInputError when required and missing", () => {
            expect(() => readStringParam({}, "name", { required: true })).toThrow(ToolInputError);
        });

        it("uses the label in the error message when provided", () => {
            expect(() =>
                readStringParam({}, "name", { required: true, label: "User Name" }),
            ).toThrow(/User Name/);
        });

        it("accepts snake_case key as fallback for camelCase param", () => {
            expect(readStringParam({ work_dir: "/tmp" }, "workDir")).toBe("/tmp");
        });

        it("prefers camelCase over snake_case when both present", () => {
            expect(readStringParam({ workDir: "camel", work_dir: "snake" }, "workDir")).toBe("camel");
        });

        it("coerces numbers to strings", () => {
            expect(readStringParam({ count: 42 }, "count")).toBe("42");
        });

        it("returns undefined for all-whitespace string", () => {
            expect(readStringParam({ name: "   " }, "name")).toBeUndefined();
        });

        it("allows empty string when allowEmpty is true", () => {
            expect(readStringParam({ name: "" }, "name", { allowEmpty: true })).toBe("");
        });

        it("skips trim when trim=false", () => {
            expect(readStringParam({ name: "  x  " }, "name", { trim: false })).toBe("  x  ");
        });
    });

    // ---------------------------------------------------------------------------
    // readNumberParam
    // ---------------------------------------------------------------------------

    describe("readNumberParam", () => {
        it("reads a number", () => {
            expect(readNumberParam({ n: 5 }, "n")).toBe(5);
        });

        it("parses a string number", () => {
            expect(readNumberParam({ n: "5" }, "n")).toBe(5);
        });

        it("returns undefined when optional and missing", () => {
            expect(readNumberParam({}, "n")).toBeUndefined();
        });

        it("throws when required and missing", () => {
            expect(() => readNumberParam({}, "n", { required: true })).toThrow(ToolInputError);
        });

        it("throws on non-numeric string", () => {
            expect(() => readNumberParam({ n: "abc" }, "n")).toThrow(ToolInputError);
        });

        it("truncates to integer when integer=true", () => {
            expect(readNumberParam({ n: 5.9 }, "n", { integer: true })).toBe(5);
        });

        it("accepts negative numbers", () => {
            expect(readNumberParam({ n: -3 }, "n")).toBe(-3);
        });

        it("accepts zero", () => {
            expect(readNumberParam({ n: 0 }, "n")).toBe(0);
        });
    });

    // ---------------------------------------------------------------------------
    // readBooleanParam
    // ---------------------------------------------------------------------------

    describe("readBooleanParam", () => {
        it("reads true", () => {
            expect(readBooleanParam({ flag: true }, "flag")).toBe(true);
        });

        it("reads false", () => {
            expect(readBooleanParam({ flag: false }, "flag")).toBe(false);
        });

        it("returns defaultValue when missing", () => {
            expect(readBooleanParam({}, "flag", true)).toBe(true);
            expect(readBooleanParam({}, "flag", false)).toBe(false);
        });

        it('coerces "true" to true', () => {
            expect(readBooleanParam({ flag: "true" }, "flag")).toBe(true);
        });

        it('coerces "false" to false', () => {
            expect(readBooleanParam({ flag: "false" }, "flag")).toBe(false);
        });

        it('coerces "1" to true', () => {
            expect(readBooleanParam({ flag: "1" }, "flag")).toBe(true);
        });

        it("falls back to Boolean() for other types", () => {
            expect(readBooleanParam({ flag: 1 }, "flag")).toBe(true);
            expect(readBooleanParam({ flag: 0 }, "flag")).toBe(false);
        });

        it("returns options.defaultValue when missing", () => {
            expect(readBooleanParam({}, "flag", { defaultValue: true })).toBe(true);
            expect(readBooleanParam({}, "flag", { defaultValue: false })).toBe(false);
        });

        it("throws when required: true and missing", () => {
            expect(() => readBooleanParam({}, "flag", { required: true })).toThrow(ToolInputError);
        });

        it("uses label in error message when required and missing", () => {
            expect(() =>
                readBooleanParam({}, "flag", { required: true, label: "verbose mode" }),
            ).toThrow("verbose mode required");
        });

        it("does not throw when required: true and value is present", () => {
            expect(readBooleanParam({ flag: true }, "flag", { required: true })).toBe(true);
            expect(readBooleanParam({ flag: false }, "flag", { required: true })).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // readStringArrayParam
    // ---------------------------------------------------------------------------

    describe("readStringArrayParam", () => {
        it("reads a string array", () => {
            expect(readStringArrayParam({ tags: ["a", "b"] }, "tags")).toEqual(["a", "b"]);
        });

        it("wraps a single string in an array", () => {
            expect(readStringArrayParam({ tags: "one" }, "tags")).toEqual(["one"]);
        });

        it("returns undefined when optional and missing", () => {
            expect(readStringArrayParam({}, "tags")).toBeUndefined();
        });

        it("throws when required and missing", () => {
            expect(() => readStringArrayParam({}, "tags", { required: true })).toThrow(ToolInputError);
        });

        it("throws on an invalid type (number)", () => {
            expect(() => readStringArrayParam({ tags: 123 }, "tags")).toThrow(ToolInputError);
        });

        it("coerces array elements to strings", () => {
            expect(readStringArrayParam({ tags: [1, 2] }, "tags")).toEqual(["1", "2"]);
        });
    });

    // ---------------------------------------------------------------------------
    // assertRequiredParams
    // ---------------------------------------------------------------------------

    describe("assertRequiredParams", () => {
        it("passes when all required params are present", () => {
            expect(() => assertRequiredParams({ a: "1", b: "2" }, ["a", "b"])).not.toThrow();
        });

        it("throws when a required param is missing", () => {
            expect(() => assertRequiredParams({ a: "1" }, ["a", "b"])).toThrow(ToolInputError);
        });

        it("throws when a required param is empty string", () => {
            expect(() => assertRequiredParams({ a: "" }, ["a"])).toThrow(ToolInputError);
        });

        it("throws when a required param is null", () => {
            expect(() => assertRequiredParams({ a: null }, ["a"])).toThrow(ToolInputError);
        });
    });

    // ---------------------------------------------------------------------------
    // Error types
    // ---------------------------------------------------------------------------

    describe("ToolInputError", () => {
        it("has status 400", () => {
            expect(new ToolInputError("x").status).toBe(400);
        });

        it("is an Error", () => {
            expect(new ToolInputError("x")).toBeInstanceOf(Error);
        });
    });

    describe("ToolAuthorizationError", () => {
        it("has status 403", () => {
            expect(new ToolAuthorizationError("x").status).toBe(403);
        });

        it("is a ToolInputError", () => {
            expect(new ToolAuthorizationError("x")).toBeInstanceOf(ToolInputError);
        });
    });
});
