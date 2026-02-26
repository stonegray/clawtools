import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    test: {
        environment: "node",
        testTimeout: 60_000,
        include: [
            "test/tests-unit/**/*.test.ts",
            "test/tests-integration/**/*.test.ts",
            "test/tests-e2e/**/*.test.ts",
            "test/test-build/**/*.test.ts",
        ],
        reporters: ["verbose"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/*.d.ts"],
            reportsDirectory: "./coverage",
        },
    },
    resolve: {
        // Map bare "clawtools" imports to source files so tests exercise
        // the real implementation without requiring a build step.
        // More-specific subpath patterns must come before the catch-all.
        alias: [
            {
                find: /^clawtools\/tools$/,
                replacement: resolve(root, "src/tools/index.ts"),
            },
            {
                find: /^clawtools\/connectors$/,
                replacement: resolve(root, "src/connectors/index.ts"),
            },
            {
                find: /^clawtools\/plugins$/,
                replacement: resolve(root, "src/plugins/index.ts"),
            },
            {
                find: /^clawtools$/,
                replacement: resolve(root, "src/index.ts"),
            },
        ],
    },
});
