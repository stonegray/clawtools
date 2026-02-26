# CLAUDE.md

## Project Context

**clawtools** is a platform-agnostic adapter NPM library that exposes OpenClaw's tools and connectors to external services.

### Compatibility guarantee

clawtools is designed to be **100% compatible with OpenClaw** by building directly against the latest upstream OpenClaw source (via the `openclaw/` git submodule) and bundling the actual tool implementations.

In particular, `scripts/bundle-core-tools.mjs` compiles OpenClaw tool factories into standalone ESM modules under `dist/core-tools/`. This avoids version drift and “out-of-date copy” problems while still not shipping the full OpenClaw runtime.

### Purpose
This library serves as a bridge between OpenClaw's tool and connector systems and third-party software.

- It implements **no domain-specific features**—it only exposes underlying tool/connector capabilities.
- It does **not** provide the OpenClaw runtime (agent loop, session store, gateway, or channels).
- **Channels are intentionally not supported** in clawtools (by design).

### Architecture

Repository layout (subdirectories only):

```
docs/       # user-facing library docs (usage + feature notes)
examples/   # runnable examples showcasing how to use clawtools
openclaw/   # upstream OpenClaw git submodule (READ-ONLY source-of-truth)
respec/     # specs + PoCs capturing OpenClaw behavior/shape
scripts/    # build helpers (notably: bundle OpenClaw core tools)
src/        # clawtools library implementation
test/       # vitest test suite + fixtures + test app
docs/planning/  # architecture drafts and planning documents (not user-facing)
```

`src/` is intentionally small and stable (registries, types, discovery). The heavy lifting of “staying compatible with upstream OpenClaw” happens via `openclaw/` + `scripts/bundle-core-tools.mjs`.

### Key Principles
1. **100% source compatibility**: core implementations are bundled from the latest `openclaw/` submodule to prevent version drift.
2. **Read-only submodule**: `openclaw/` is never written to. Only deep-links/bundling of tool implementations from it.
3. **No domain logic**: Pure compatibility layer. No features specific to any single tool.
4. **Standalone public types**: exported types are maintained in `src/` and kept compatible with OpenClaw.
5. **Modular exports**: Three subpath exports (`clawtools/tools`, `clawtools/connectors`, `clawtools/plugins`).
6. **Extensible**: Registries accept custom tools/connectors alongside openclaw's built-ins.

### Rules for Accessing `./openclaw` (IMPORTANT)

The `openclaw/` submodule is **read-only**. Never modify, write to, or add files inside it.

**What you MAY do:**
- Deep-link into `./openclaw` to access **individual tool and connector plugin implementations** (e.g., importing a specific tool factory from `openclaw/src/agents/tools/`).
- Read `openclaw.plugin.json` manifests and `package.json` metadata from extensions.
- Copy code **verbatim** from the openclaw directory (it is MIT licensed). If you do, include a comment citing the license and original source file in any files or code blocks you copy.

**What you MUST NOT do:**
- Import openclaw's runtime, config system, CLI, gateway, plugin loader, channel adapters, or any other infrastructure — only the actual tool/connector implementations.
- Add openclaw as a dependency or import from its package entry point.
- Rely on any openclaw internal module beyond the individual plugins themselves.

**What you MUST reimplement:**
- Everything that is not a specific tool or connector implementation. Types, registries, discovery, parameter handling, schema utilities — all reimplemented in `src/` to avoid pulling in unnecessary code.
- Prefer reimplementation over copying. Only copy code verbatim when reimplementing would produce an inferior or incompatible result.

### Key Files
- `src/types.ts` — All public type definitions (Tool, Connector, PluginApi, etc.)
- `src/tools/registry.ts` — ToolRegistry class (register, resolve, list, filter by profile)
- `src/tools/discovery.ts` — Scans openclaw's tool-catalog for 23 core tools
- `src/connectors/discovery.ts` — Discovers extension metadata from `openclaw/extensions/` (metadata only; no channel runtime)
- `src/plugins/loader.ts` — Loads OpenClaw-compatible plugins from filesystem
- `scripts/bundle-core-tools.mjs` — Bundles core tool implementations from the OpenClaw submodule
- `examples/openai-connector/index.ts` — Minimal example connector that streams “Hello world!”
- `docs/usage.md` — Usage guide with tool/connector/plugin examples

### Agent Notes (read before making changes)

- **Do not add channels.** clawtools intentionally does not implement channel adapters or messaging runtimes; treat channels as an OpenClaw-only concern.
- **Keep diffs tight.** Prefer the smallest possible changes; avoid sweeping refactors and avoid touching unrelated files.
- **Never edit `openclaw/`.** It is a read-only upstream submodule. If you need behavior from OpenClaw, consume it via discovery/bundling patterns.
- **Bundling is part of build.** `npm run build` runs TypeScript compilation and then `scripts/bundle-core-tools.mjs` to emit `dist/core-tools/`.
- **Docs live in `docs/` and examples in `examples/`.** README should stay short; push longer walkthroughs into `docs/usage.md` or `examples/*`.
- **Prefer compatibility over cleverness.** When unsure, mirror OpenClaw shapes/types and keep output/events aligned with `src/types.ts`.

### Dependencies
- OpenClaw (git submodule at `./openclaw`) — read-only source for tool/connector implementations
- TypeScript, @types/node — dev only
- Zero runtime npm dependencies

### Build & Test
```bash
npm run build        # tsc → dist/ + bundle latest OpenClaw core tools
npm run build:tools  # run only the OpenClaw tool bundler
npm run dev          # tsc --watch
npm run typecheck    # tsc --noEmit
npm test             # vitest
```

### Subpath Exports
```typescript
import { createClawtools } from "clawtools";           // Full convenience API
import { ToolRegistry } from "clawtools/tools";         // Tools only
import { ConnectorRegistry } from "clawtools/connectors"; // Connectors only
import { loadPlugins } from "clawtools/plugins";         // Plugin loader
```
