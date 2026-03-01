// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
    // ── Ignore patterns ────────────────────────────────────────────────────────
    {
        ignores: [
            // Read-only submodule — never lint it
            "openclaw/**",
            // Build output
            "dist/**",
            ".build-tmp/**",
            // Examples (separate tsconfig, separate concern)
            "examples/**",
            "tmp/**",
            // Plain JS config / build scripts
            "scripts/**",
        ],
    },

    // ── src/ — type-aware linting against tsconfig.json ───────────────────────
    {
        files: ["src/**/*.ts"],
        extends: tseslint.configs.recommended,
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Type-aware rules
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",

            // `as any` is sometimes unavoidable at third-party API boundaries
            "@typescript-eslint/no-explicit-any": "warn",
            // Allow empty catch blocks used as intentional swallow patterns
            "@typescript-eslint/no-empty-object-type": "warn",
            // Allow unused identifiers/args when prefixed with _
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            // Non-null assertions are a warning — prefer ?? or explicit guards
            "@typescript-eslint/no-non-null-assertion": "warn",
        },
    },

    // ── test/ — type-aware linting against tsconfig.test.json ─────────────────
    {
        files: ["test/**/*.ts"],
        extends: tseslint.configs.recommended,
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.test.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Type-aware rules (relaxed for test code)
            "@typescript-eslint/no-floating-promises": "warn",
            "@typescript-eslint/no-misused-promises": "warn",
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",

            // Tests routinely inspect internal shapes typed as any
            "@typescript-eslint/no-explicit-any": "off",
            // Test helpers use unused stubs intentionally
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/no-non-null-assertion": "off",
        },
    },

    // ── vitest config files ────────────────────────────────────────────────────
    {
        files: ["vitest*.config.ts"],
        extends: tseslint.configs.recommended,
    },
);
