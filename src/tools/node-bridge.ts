/**
 * createNodeBridge — local Node.js FsBridge implementation.
 *
 * Creates a {@link FsBridge} that reads and writes files via `node:fs/promises`
 * directly on the host filesystem. Suitable for development, testing, and
 * any scenario where no sandbox isolation is needed.
 *
 * Pass the result to `ToolContext.bridge` (and set `ToolContext.root`) when
 * calling `registry.resolveAll()` to enable the core fs tools (`read`, `write`,
 * `edit`).
 *
 * @example
 * ```ts
 * import { createClawtoolsAsync } from "clawtools";
 * import { createNodeBridge } from "clawtools/tools";
 *
 * const ct = await createClawtoolsAsync();
 * const root = process.cwd();
 *
 * const tools = ct.tools.resolveAll({
 *   workspaceDir: root,
 *   root,
 *   bridge: createNodeBridge(root),
 * });
 * ```
 *
 * @module
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { FsBridge, FsStat } from "../types.js";

/**
 * Create a {@link FsBridge} backed by the local Node.js filesystem.
 *
 * @param root - The workspace root directory. Relative paths are resolved
 *   relative to this directory (unless `cwd` is passed to individual calls).
 */
export function createNodeBridge(root: string): FsBridge {
    const resolvedRoot = path.resolve(root);

    function abs(filePath: string, cwd?: string): string {
        if (path.isAbsolute(filePath)) return filePath;
        return path.resolve(cwd ?? resolvedRoot, filePath);
    }

    return {
        async stat({ filePath, cwd }): Promise<FsStat | null> {
            try {
                const s = await fs.stat(abs(filePath, cwd));
                return {
                    type: s.isFile() ? "file" : s.isDirectory() ? "directory" : "other",
                    size: s.size,
                    mtimeMs: s.mtimeMs,
                };
            } catch {
                return null;
            }
        },

        async readFile({ filePath, cwd }): Promise<Buffer> {
            return fs.readFile(abs(filePath, cwd));
        },

        async mkdirp({ filePath, cwd }): Promise<void> {
            await fs.mkdir(abs(filePath, cwd), { recursive: true });
        },

        async writeFile({ filePath, cwd, data }): Promise<void> {
            const target = abs(filePath, cwd);
            await fs.mkdir(path.dirname(target), { recursive: true });
            const buf = typeof data === "string" ? Buffer.from(data) : data;
            await fs.writeFile(target, buf);
        },
    };
}
