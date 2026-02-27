/**
 * Parameter reading utilities — safe extraction of tool parameters.
 *
 * Reimplemented from OpenClaw's parameter reading system.
 * Supports both camelCase and snake_case parameter names, trimming,
 * type coercion, and required/optional semantics.
 *
 * Original source: openclaw/src/agents/tools/common.ts (MIT license)
 *
 * @module
 */

// =============================================================================
// Error Types
// =============================================================================

/**
 * Thrown when a tool receives invalid input parameters.
 */
export class ToolInputError extends Error {
    readonly status: number = 400;

    constructor(message: string) {
        super(message);
        this.name = "ToolInputError";
    }
}

/**
 * Thrown when a tool call is not authorized.
 */
export class ToolAuthorizationError extends ToolInputError {
    override readonly status = 403;

    constructor(message: string) {
        super(message);
        this.name = "ToolAuthorizationError";
    }
}

// =============================================================================
// Internal helpers
// =============================================================================

function toSnakeCaseKey(key: string): string {
    return key
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase();
}

function readParamRaw(
    params: Record<string, unknown>,
    key: string,
): unknown {
    if (Object.hasOwn(params, key)) {
        return params[key];
    }
    const snakeKey = toSnakeCaseKey(key);
    if (snakeKey !== key && Object.hasOwn(params, snakeKey)) {
        return params[snakeKey];
    }
    return undefined;
}

// =============================================================================
// String parameters
// =============================================================================

export interface StringParamOptions {
    required?: boolean;
    trim?: boolean;
    label?: string;
    allowEmpty?: boolean;
}

/**
 * Read a string parameter from tool arguments.
 *
 * Supports both camelCase and snake_case keys. Trims whitespace by default.
 *
 * @param params - The raw parameter object from the tool call.
 * @param key - The parameter name (camelCase).
 * @param options - Reading options.
 * @returns The string value, or undefined if not present and not required.
 * @throws ToolInputError if required and missing.
 */
export function readStringParam(
    params: Record<string, unknown>,
    key: string,
    options?: StringParamOptions & { required: true },
): string;
export function readStringParam(
    params: Record<string, unknown>,
    key: string,
    options?: StringParamOptions,
): string | undefined;
export function readStringParam(
    params: Record<string, unknown>,
    key: string,
    options: StringParamOptions = {},
): string | undefined {
    const { required = false, trim = true, label = key, allowEmpty = false } = options;
    const raw = readParamRaw(params, key);

    // Coerce numbers to strings
    if (typeof raw === "number" || typeof raw === "bigint") {
        return String(raw);
    }

    if (typeof raw !== "string") {
        if (required) throw new ToolInputError(`${label} required`);
        return undefined;
    }

    const value = trim ? raw.trim() : raw;
    if (!value && !allowEmpty) {
        if (required) throw new ToolInputError(`${label} required`);
        return undefined;
    }

    return value;
}

// =============================================================================
// Number parameters
// =============================================================================

export interface NumberParamOptions {
    required?: boolean;
    integer?: boolean;
    label?: string;
}

/**
 * Read a number parameter from tool arguments.
 *
 * @param params - The raw parameter object.
 * @param key - The parameter name.
 * @param options - Reading options.
 * @returns The number value, or undefined if not present and not required.
 * @throws ToolInputError if required and missing, or if the value isn't a valid number.
 */
export function readNumberParam(
    params: Record<string, unknown>,
    key: string,
    options?: NumberParamOptions & { required: true },
): number;
export function readNumberParam(
    params: Record<string, unknown>,
    key: string,
    options?: NumberParamOptions,
): number | undefined;
export function readNumberParam(
    params: Record<string, unknown>,
    key: string,
    options: NumberParamOptions = {},
): number | undefined {
    const { required = false, integer = false, label = key } = options;
    const raw = readParamRaw(params, key);

    if (raw === undefined || raw === null) {
        if (required) throw new ToolInputError(`${label} required`);
        return undefined;
    }

    const num = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
    if (typeof num !== "number" || Number.isNaN(num)) {
        throw new ToolInputError(`${label} must be a number`);
    }

    return integer ? Math.floor(num) : num;
}

// =============================================================================
// Boolean parameters
// =============================================================================

export interface BooleanParamOptions {
    /** Throw ToolInputError if the parameter is absent. */
    required?: boolean;
    /** Value to return when absent and not required. Defaults to `false`. */
    defaultValue?: boolean;
    /** Human-readable name used in error messages. Defaults to `key`. */
    label?: string;
}

/**
 * Read a boolean parameter from tool arguments.
 *
 * Supports both camelCase and snake_case keys. Coerces string `"true"` / `"1"`
 * to `true` and everything else to `false` via `Boolean()`.
 *
 * Accepts either the legacy positional `defaultValue` (third arg as `boolean`)
 * or a {@link BooleanParamOptions} object for structured access including
 * `required: true`.
 *
 * @param params - The raw parameter object.
 * @param key - The parameter name (camelCase).
 * @param optionsOrDefault - Options object or legacy positional default value.
 * @returns The boolean value, or `defaultValue` if absent and not required.
 * @throws ToolInputError if `required: true` and the parameter is absent.
 */
export function readBooleanParam(
    params: Record<string, unknown>,
    key: string,
    optionsOrDefault: BooleanParamOptions & { required: true },
): boolean;
export function readBooleanParam(
    params: Record<string, unknown>,
    key: string,
    optionsOrDefault?: boolean | BooleanParamOptions,
): boolean;
export function readBooleanParam(
    params: Record<string, unknown>,
    key: string,
    optionsOrDefault: boolean | BooleanParamOptions = false,
): boolean {
    let required = false;
    let defaultValue = false;
    let label = key;

    if (typeof optionsOrDefault === "boolean") {
        defaultValue = optionsOrDefault;
    } else {
        required = optionsOrDefault.required ?? false;
        defaultValue = optionsOrDefault.defaultValue ?? false;
        label = optionsOrDefault.label ?? key;
    }

    const raw = readParamRaw(params, key);
    if (raw === undefined || raw === null) {
        if (required) throw new ToolInputError(`${label} required`);
        return defaultValue;
    }
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
        return raw.toLowerCase() === "true" || raw === "1";
    }
    return Boolean(raw);
}

// =============================================================================
// String array parameters
// =============================================================================

/**
 * Read a string array parameter. Auto-wraps a single string into an array.
 *
 * @param params - The raw parameter object.
 * @param key - The parameter name.
 * @param options - Reading options.
 * @returns A string array, or undefined if not present and not required.
 * @throws ToolInputError if required and missing.
 */
export function readStringArrayParam(
    params: Record<string, unknown>,
    key: string,
    options?: { required?: boolean; label?: string },
): string[] | undefined {
    const { required = false, label = key } = options ?? {};
    const raw = readParamRaw(params, key);

    if (raw === undefined || raw === null) {
        if (required) throw new ToolInputError(`${label} required`);
        return undefined;
    }

    if (typeof raw === "string") return [raw];
    if (Array.isArray(raw)) return raw.map(String);

    throw new ToolInputError(`${label} must be a string or string array`);
}

// =============================================================================
// Required parameter assertion
// =============================================================================

/**
 * Assert that required parameters are present.
 *
 * @param params - The raw parameter object.
 * @param required - List of required parameter names.
 * @throws ToolInputError if any required parameter is missing.
 */
export function assertRequiredParams(
    params: Record<string, unknown>,
    required: string[],
): void {
    for (const key of required) {
        const value = readParamRaw(params, key);
        if (value === undefined || value === null || value === "") {
            throw new ToolInputError(`${key} required`);
        }
    }
}
