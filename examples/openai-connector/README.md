# OpenAI Connector Example

Demonstrates how to create a minimal OpenAI connector and stream a "Hello world" response.

## Usage

```bash
# Set your API key
export OPENAI_API_KEY=sk-...

# Run from the repository root
npx tsx examples/openai-connector/index.ts

# Or with pnpm from the example directory
cd examples/openai-connector
pnpm start
```

## What it does

1. **Creates a connector** implementing the `Connector` interface with the `openai-completions` API transport
2. **Resolves auth** from the `OPENAI_API_KEY` environment variable using `resolveAuth()`
3. **Streams a response** to "Hello world!" using `gpt-4o-mini`
4. **Prints events** including text deltas, token usage, and stop reason

## Key concepts

- **Connector interface** — wraps an LLM API into a standardized streaming shape
- **Auth resolution** — automatic environment variable lookup via `resolveAuth()`
- **Stream events** — `start`, `text_delta`, `text_end`, `done`, `error`
- **SSE parsing** — manual parsing of OpenAI's Server-Sent Events stream

## Extending

To connect to other OpenAI-compatible APIs (Azure, Ollama, LM Studio), change:
- The `fetch()` URL in the `stream()` method
- The `api` field on the connector (if using a custom transport)
- The `envVars` array for auth resolution
