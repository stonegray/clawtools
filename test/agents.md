# Integration testing with testapp + openai-mock

This document explains the "agent consumer" integration test pattern used in
`tests-integration/app.test.ts`. The goal is to exercise the full
connector → stream → event path the same way a real application would,
without a real API key or a live LLM.

---

## The three components

```
test/testapp/index.ts          ← fake consumer application
test/openai-mock/              ← local HTTP server that speaks OpenAI's wire format
test/tests-integration/app.test.ts  ← the actual test assertions
```

They are kept in separate directories so each piece can be read and reasoned
about independently.

---

## testapp (`test/testapp/index.ts`)

`testapp` is written as if it were a real downstream consumer of clawtools. It:

- Imports from `"clawtools"`, `"clawtools/tools"`, and `"clawtools/connectors"` (bare package names, not relative paths)
- Calls `createClawtools()` with `skipCoreTools: true` to keep tests fast
- Registers one custom `Connector` that uses `fetch()` to POST to an OpenAI-compatible endpoint
- Implements a `query(prompt)` function that drives the full stream loop and returns all collected `StreamEvent`s

The connector in `testapp` is the same code you would write in a real app — it has no test-specific logic. That is the point: if it breaks, something in the `Connector` interface, `StreamContext`, `StreamOptions`, or `StreamEvent` types has regressed.

**`AppResult`** — returned by `query()`:

| Field | Content |
|---|---|
| `events` | Every `StreamEvent` yielded, in order |
| `text` | Full text assembled from `text_delta` events |
| `toolCalls` | Parsed tool calls from `toolcall_end` events |
| `toolCount` | Number of tools the app had registered when it sent the request |

---

## openai-mock (`test/openai-mock/`)

A real Node.js HTTP server (`node:http`) bound to a random ephemeral port on
`127.0.0.1`. It implements two routes:

| Route | Behaviour |
|---|---|
| `GET /v1/models` | Returns a static two-model list |
| `POST /v1/chat/completions` | Streams or returns a response based on the active scenario |

### Scenarios

Set the server's behaviour before each test with `server.setScenario(scenario)`:

**`TextScenario`**
```ts
{ type: "text", content: "Hello from the mock!", chunkSize?: 1, model?: string }
```
Streams the content as individual word-chunk SSE events. Ends with
`finish_reason: "stop"`.

**`ToolCallScenario`**
```ts
{ type: "tool_call", name: "echo", id: "call_abc123", args: { message: "ping" }, model?: string }
```
Streams a single tool call with the arguments serialised and emitted in parts.
Ends with `finish_reason: "tool_calls"`.

**`ErrorScenario`**
```ts
{ type: "error", status: 429, message: "rate limited", code?: "rate_limit" }
```
Returns an HTTP error before any SSE data. The connector is expected to convert
this to a `{ type: "error" }` `StreamEvent`.

### Request capture

Every request the mock receives is stored and can be asserted on:

```ts
mock.getRequests()   // all requests since last clearRequests()
mock.lastRequest()   // most recent request
mock.clearRequests() // reset between tests
```

A `CapturedRequest` has: `method`, `path`, `headers`, `body` (parsed JSON), and `timestamp`.

---

## The integration test (`tests-integration/app.test.ts`)

One `OpenAIMockServer` is started for the whole file via `withMockServer()`.
A fresh `testapp` instance is created per test via the local `app()` factory
(prevents state leaking between tests).

The test suites mirror the scenario types:

| Describe block | Scenario | What it asserts |
|---|---|---|
| `"text response"` | `TextScenario` | event order, assembled text, stop reason |
| `"tool_call response"` | `ToolCallScenario` | toolcall events, parsed name/id/args, stop reason |
| `"error scenario"` | `ErrorScenario` | error event emitted, no throw from `query()` |
| `"request capture"` | `TextScenario` | what the connector actually sent over the wire |
| `"scenario isolation"` | alternating scenarios | each `setScenario` only affects one request |

### Typical test shape

```ts
describe("text response", () => {
    beforeEach(() => {
        mock.setScenario({ type: "text", content: "Hello from the mock!" });
    });

    it("assembles full text from deltas", async () => {
        const result = await app().query("hi");
        expect(result.text).toBe("Hello from the mock!");
    });
});
```

No mocking of `fetch`, no monkey-patching, no sinon — real HTTP over loopback.

---

## withMockServer() lifecycle helper

`withMockServer()` is defined in `test/helpers/mock-server.ts`. It creates an
`OpenAIMockServer`, registers `beforeAll(server.start)` and `afterAll(server.stop)`
with vitest automatically, and returns the server instance.

Call it at the top level of a `describe` block or test file — not inside a test
or `beforeEach`, because the lifecycle hooks must be registered during the
describe-collection phase:

```ts
// ✅ correct — top level of file or describe
const mock = withMockServer();

// ❌ wrong — too late, hooks won't fire correctly
it("test", async () => {
    const mock = withMockServer(); // don't do this
});
```

---

## Adding a new integration scenario

1. **Add a scenario type** to `openai-mock/types.ts` if the existing three
   (text, tool_call, error) don't cover it.

2. **Handle it in `openai-mock/server.ts`** — add a branch in `sendCompletions()`
   or `streamText()`.

3. **Add a `describe` block** in `tests-integration/app.test.ts`:
   ```ts
   describe("my new scenario", () => {
       beforeEach(() => {
           mock.setScenario({ type: "my_type", … });
       });

       it("emits the expected event", async () => {
           const result = await app().query("trigger phrase");
           expect(result.events.some(e => e.type === "my_event")).toBe(true);
       });
   });
   ```

4. If the new scenario changes what `testapp` needs to do (e.g. a new event type
   in `StreamEvent`), update `testapp/index.ts` accordingly — then update
   `AppResult` and `query()` to expose the new data.

---

## Why a real HTTP server instead of mocked fetch?

The connector in `testapp` uses the standard Web `fetch()` API and parses raw
SSE text. Testing it with a mock server means:

- The HTTP framing, chunking, and SSE parsing are all exercised
- The `Authorization` header, `stream: true`, message/tool serialisation are
  verified against what was actually sent
- Any regression in the connector's wire-level behaviour is caught immediately

If you use `vi.mock("fetch", …)` instead, you skip all of that and end up with
tests that pass even when the real network path is broken.
