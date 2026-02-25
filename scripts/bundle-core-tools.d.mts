/**
 * Type declarations for bundle-core-tools.mjs.
 * Enables typed imports from the test suite.
 */

export interface ToolCatalogEntry {
    readonly id: string;
    readonly entry: string;
    readonly factory: string;
}

/** Parsed import surface for a single package specifier. */
export interface ImportInfo {
    /** Named bindings: `import { A, B }` — holds the original names, not aliases. */
    names: Set<string>;
    /** True when the import has a default binding: `import Foo from "pkg"`. */
    hasDefault: boolean;
    /** True when the import has a namespace binding: `import * as Foo from "pkg"`. */
    hasNamespace: boolean;
}

/** The 23 openclaw tool factory entries the bundler processes. */
export declare const TOOL_CATALOG: readonly ToolCatalogEntry[];

/**
 * Packages that are always kept external (native addons, Node built-ins, etc.).
 * These are never inlined into bundles.
 */
export declare const ALWAYS_EXTERNAL: Set<string>;

/**
 * Bare Node.js built-in module names (without `node:` prefix).
 * `import { x } from "fs"` is treated the same as `import { x } from "node:fs"`.
 */
export declare const NODE_BUILTINS: Set<string>;

/**
 * Parse all `import` statements from TypeScript/JavaScript source.
 *
 * - Handles multi-line named imports
 * - Skips `import type { … }` and inline `type` modifiers
 * - Skips `node:` prefixed and bare Node.js built-in specifiers
 * - Skips relative and absolute path specifiers
 * - Records dynamic `import("pkg")` calls
 *
 * @returns Map from package specifier to its collected import bindings.
 */
export declare function parseAllImports(source: string): Map<string, ImportInfo>;

/**
 * Recursively walk a directory and return all `.ts` source files.
 * Skips `.d.ts` declaration files, `node_modules/`, and `.git/`.
 */
export declare function walkTs(dir: string): string[];

/**
 * Generate an ESM stub module for a package that cannot be resolved at build time.
 *
 * Uses real `class` exports (not Proxies) so that `class Foo extends StubClass {}`
 * patterns in the openclaw source compile correctly.
 *
 * Heuristic: names starting with an uppercase letter get `export class`;
 * lowercase names get `export const = () => undefined`.
 */
export declare function generateEsmStub(specifier: string, importInfo: ImportInfo): string;
