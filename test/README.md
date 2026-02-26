# test/

Test suite for clawtools. Run everything with:

```
npm test
```

All tests use [vitest](https://vitest.dev/) and TypeScript. No build step is needed to run most tests — vitest resolves `import … from "clawtools"` directly to `src/` via path aliases (see [vitest.config.ts](../vitest.config.ts)).

---

## Directory map

```
test/
├── helpers/              Shared test utilities imported by every test file
│   ├── fixtures.ts       Static fixture data (echoTool, mockModel, makeMockConnector, …)
│   ├── registry.ts       Pre-built ToolRegistry / ConnectorRegistry factories
│   ├── plugin.ts         loadTestPlugin() / loadTestPlugins() helpers
│   ├── mock-server.ts    withMockServer() lifecycle wrapper
│   └── index.ts          Re-export barrel — import from "helpers/index.js"
│
├── openai-mock/          Self-contained OpenAI-compatible HTTP mock server
│   ├── server.ts         OpenAIMockServer class
│   ├── types.ts          MockScenario, CapturedRequest type definitions
│   └── index.ts          Public re-export barrel
│
├── resources/            Static test fixtures loaded by tests at runtime
│   ├── plugins/
│   │   ├── echo-plugin/        Valid plugin — registers one tool + one connector
│   │   ├── hook-compat-plugin/ Calls every PluginApi method (incl. all no-ops)
│   │   └── bad-plugin/         Manifest only, no entry point — loader must skip it
│   ├── connectors/
│   │   └── mock-connector.ts   A static Connector fixture for direct import
│   └── tools/
│       └── counter-tool.ts     Stateful counter tool for call-count assertions
│
├── testapp/
│   └── index.ts          End-to-end consumer app — see agents.md
│
├── test-build/
│   └── bundler.test.ts   Build regression tests for bundle-core-tools pipeline
│
├── tests-unit/           Fast, no-network, no-submodule tests
│   ├── connectors/
│   │   └── registry.test.ts    ConnectorRegistry + resolveAuth
│   ├── plugins/
│   │   └── loader.test.ts      Plugin loader, filtering, tool/connector collection
│   └── tools/
│       ├── discovery.test.ts   getCoreToolCatalog, getCoreSections, discoverCoreTools
│       ├── helpers.test.ts     jsonResult, textResult, errorResult, imageResult
│       ├── params.test.ts      readStringParam, readNumberParam, assertRequiredParams, …
│       ├── registry.test.ts    ToolRegistry: register, resolve, filter, factory
│       └── schema.test.ts      extractToolSchema, normalizeSchema, cleanSchemaForGemini
│
└── tests-integration/
    └── app.test.ts       Full request/response cycle via testapp + mock server
```

---

## Suites at a glance

| Suite | What it tests | Speed | Requires |
|---|---|---|---|
| `tests-unit/` | Individual classes and pure functions | ~1 s | Nothing |
| `tests-integration/` | Testapp + mock HTTP server, real fetch() calls | ~3 s | Nothing |
| `test-build/` | Build pipeline correctness; bundle loading | ~60 s | openclaw submodule + `npm run build` |

`test-build/` will skip individual sub-tests automatically when the submodule or `dist/` is absent rather than failing the whole run.

---

## Import aliases

Tests import from the `clawtools` package name without a build step. `vitest.config.ts` maps the bare package names to TypeScript source:

| Import | Resolves to |
|---|---|
| `"clawtools"` | `src/index.ts` |
| `"clawtools/tools"` | `src/tools/index.ts` |
| `"clawtools/connectors"` | `src/connectors/index.ts` |
| `"clawtools/plugins"` | `src/plugins/index.ts` |

`tsconfig.test.json` mirrors the same paths so `tsc --noEmit` (used by `typecheck:test`) agrees with vitest's resolver.

---

## Helpers reference

Import everything from `"../helpers/index.js"`:

### Fixtures (`fixtures.ts`)

| Export | What it is |
|---|---|
| `echoTool` | Minimal working tool; echoes `message` param |
| `fullTool` | Tool with all parameter types (string, number, boolean, array) |
| `throwingTool` | Always throws — for error-path tests |
| `contextAwareToolFactory` | Factory that captures `ToolContext` at creation |
| `baseContext` | Baseline `ToolContext` populated with test values |
| `mockModel(baseUrl)` | `ModelDescriptor` targeting a given URL |
| `makeMockConnector(overrides?)` | Minimal `Connector` yielding a two-event stream |

### Registries (`registry.ts`)

| Export | What it is |
|---|---|
| `emptyToolRegistry()` | Blank registry; register tools manually |
| `fixtureToolRegistry()` | Pre-loaded with `echoTool` + `fullTool` — fast, no deps |
| `coreToolRegistry()` | Runs `discoverCoreToolsAsync` — slow, use only in integration tests |
| `emptyConnectorRegistry()` | Blank connector registry |
| `mockConnectorRegistry(overrides?)` | Registry with one mock connector |

### Plugin helpers (`plugin.ts`)

| Export | What it is |
|---|---|
| `RESOURCES_DIR` | Absolute path to `test/resources/` |
| `TEST_PLUGINS_DIR` | Absolute path to `test/resources/plugins/` |
| `loadTestPlugins(opts?)` | Load all plugins from `resources/plugins/` |
| `loadTestPlugin(id)` | Load exactly one plugin by manifest ID |

### Mock server (`mock-server.ts`)

| Export | What it is |
|---|---|
| `withMockServer()` | Creates + starts/stops `OpenAIMockServer` via vitest hooks |
| `MockScenario` | Re-exported type for `setScenario()` |

---

## Adding a new test

**Unit test:** create `tests-unit/<subsystem>/your-thing.test.ts`. Use fixtures from `helpers/`. Keep it fast — no file I/O, no network.

**Integration test:** add a new `describe` block to `tests-integration/app.test.ts`, or create a new file there. Use `withMockServer()` and `createTestApp()`. Call `mock.setScenario()` in `beforeEach`.

**New resource plugin:** add a directory under `resources/plugins/` with an `openclaw.plugin.json` manifest and an `index.ts` that exports `register(api)`.

**Build regression:** add cases to `test-build/bundler.test.ts`. Guard slow/destructive work with `if (!BUNDLES_BUILT) return`.
