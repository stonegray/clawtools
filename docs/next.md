Missing peer dependency. undici is required at runtime but not listed as a dependency — crashes on first run with a cryptic module-not-found error. Should be a hard dependency, not assumed to exist.

Noisy startup warning. "Config was last written by a newer OpenClaw (2026.2.22-2); current version is 0.0.0" prints on every run. It's meaningless to anyone not running the OpenClaw daemon and should be suppressed or at least routed to stderr conditionally.

messages typed as Record<string, unknown>[]. Pragmatic for forward-compatibility but gives up all type-safety on the most critical parameter. At minimum a documented UserMessage/AssistantMessage type alias would help.

createClawtoolsAsync() loads everything eagerly. For listing providers or running a single query, pulling in the full connector bundle (all provider SDKs) is heavy. A lazy/on-demand load would be better.
