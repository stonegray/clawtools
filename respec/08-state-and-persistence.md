# 08 — State and Persistence Specification

> Formal specification of state management, session persistence, and configuration.
> Extracted from: `src/config/config.ts`, `src/config/sessions.ts`

---

## 1. Directory Structure

### 1.1 State Directory

```
~/.openclaw/                              # State root (OPENCLAW_STATE_DIR override)
  openclaw.json                           # Main config file (JSON5)
  credentials/                            # Web provider credentials
  extensions/                             # Global plugin extensions
  agents/
    <agentId>/
      sessions/
        sessions.json                     # Session store
        <sessionId>.jsonl                 # Session transcripts
      auth/                               # Auth profile store
      models.json                         # Auto-generated model config
      skills/                             # Agent-specific skills
```

### 1.2 State Root Resolution

```typescript
function resolveStateDir(): string {
  // Priority order:
  // 1. OPENCLAW_STATE_DIR env var
  // 2. ~/.openclaw (preferred)
  // 3. Legacy: ~/.clawdbot, ~/.moldbot, ~/.moltbot
}
```

---

## 2. Configuration File

### 2.1 Location

```
~/.openclaw/openclaw.json
```

Format: JSON5 (comments and trailing commas allowed).

Legacy names: `clawdbot.json`, `moldbot.json`, `moltbot.json`.

### 2.2 Config Type (Top-Level)

```typescript
type OpenClawConfig = {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: number;
  };

  auth?: AuthConfig;
  env?: { shellEnv?: string; vars?: Record<string, string> };
  wizard?: { lastRunAt?: number; lastRunVersion?: string };

  skills?: SkillsConfig;
  plugins?: PluginsConfig;
  models?: ModelsConfig;
  agents?: AgentsConfig;
  tools?: ToolsConfig;

  bindings?: AgentBinding[];
  messages?: MessagesConfig;
  commands?: CommandsConfig;
  approvals?: ApprovalsConfig;
  session?: SessionConfig;
  channels?: ChannelsConfig;

  cron?: CronConfig;
  hooks?: HooksConfig;
  discovery?: DiscoveryConfig;
  gateway?: GatewayConfig;
  memory?: MemoryConfig;

  diagnostics?: DiagnosticsConfig;
  logging?: LoggingConfig;
  update?: UpdateConfig;
  browser?: BrowserConfig;
  ui?: UiConfig;
};
```

### 2.3 Config Loading Pipeline

```
loadConfig(configPath?)
     │
     ├── 1. resolveConfigPath()
     ├── 2. Check in-memory cache (TTL-based, mtime invalidation)
     ├── 3. fs.readFileSync → JSON5.parse
     ├── 4. resolveConfigIncludes()       — $include directive
     ├── 5. resolveConfigEnvVars()        — ${ENV_VAR} substitution
     ├── 6. applyConfigEnvVars()          — env.vars overlay
     ├── 7. validateConfigObject()        — Zod schema validation
     ├── 8. applyMergePatch()             — Merge-patch overlays
     ├── 9. loadDotEnv()                  — .env file loading
     ├── 10. loadShellEnvFallback()       — Login shell env import
     ├── 11. applyDefaults()              — Default values
     ├── 12. normalizeConfigPaths()       — Path resolution
     └── 13. applyConfigOverrides()       — CLI flag overrides
```

### 2.4 Example Config

```json5
{
  // Model configuration
  "models": {
    "default": "anthropic/claude-opus-4-6",
    "providers": {
      "anthropic": {
        "baseUrl": "https://api.anthropic.com"
      },
      "openai": {
        "baseUrl": "https://api.openai.com/v1"
      }
    }
  },

  // Tool configuration
  "tools": {
    "exec": {
      "security": "safe-bin",
      "host": "host",
      "timeoutSec": 120
    },
    "fs": {
      "workspaceOnly": false
    },
    "allow": ["read", "write", "edit", "exec", "process"],
    "profile": "coding"
  },

  // Channel configuration
  "channels": {
    "telegram": {
      "accounts": {
        "default": {
          "token": "${TELEGRAM_BOT_TOKEN}",
          "allowFrom": ["+1234567890"]
        }
      }
    }
  },

  // Plugin configuration
  "plugins": {
    "enabled": true,
    "entries": {
      "memory-lancedb": {
        "enabled": true,
        "dbPath": "~/.openclaw/memory"
      }
    }
  },

  // Gateway configuration
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "mode": "local"
  }
}
```

---

## 3. Session Store

### 3.1 Location

```
~/.openclaw/agents/<agentId>/sessions/sessions.json
```

### 3.2 Format

The session store is a JSON object mapping session keys to session entries:

```json
{
  "telegram:+1234567890": {
    "sessionId": "abc123-def456",
    "updatedAt": 1740000000000,
    "sessionFile": "abc123-def456.jsonl",
    "model": "claude-opus-4-6",
    "modelProvider": "anthropic",
    "totalTokens": 15000,
    "compactionCount": 0,
    "channel": "telegram"
  },
  "discord:guild123:channel456": {
    "sessionId": "xyz789",
    "updatedAt": 1740000001000,
    "sessionFile": "xyz789.jsonl"
  }
}
```

### 3.3 Session Entry Type

```typescript
type SessionEntry = {
  // Core identity
  sessionId: string;              // UUID
  updatedAt: number;              // Unix ms timestamp

  // Transcript
  sessionFile?: string;           // Path to .jsonl file

  // Hierarchy
  spawnedBy?: string;             // Parent session key
  spawnDepth?: number;            // Nesting depth (0=main)

  // Chat context
  chatType?: SessionChatType;     // "direct" | "group" | "channel" | "thread"

  // Model overrides (per-session)
  thinkingLevel?: string;
  modelOverride?: string;
  providerOverride?: string;
  authProfileOverride?: string;

  // Token tracking
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  cacheRead?: number;
  cacheWrite?: number;

  // Model info (last used)
  model?: string;
  modelProvider?: string;

  // Session state
  compactionCount?: number;
  channel?: string;
  groupId?: string;
  origin?: SessionOrigin;
  deliveryContext?: DeliveryContext;
  lastChannel?: string;
  lastTo?: string;
  label?: string;
};
```

### 3.4 Session Store Operations

```typescript
// Load session store (with TTL cache)
function loadSessionStore(params: {
  agentDir: string;
  agentId?: string;
}): SessionStore;

// Save session store (atomic write with lock)
function saveSessionStore(params: {
  agentDir: string;
  store: SessionStore;
}): void;

// Derive session key from routing context
function deriveSessionKey(params: {
  channel: string;
  from: string;
  to?: string;
  threadId?: string;
}): string;

// Resolve session key with normalization
function resolveSessionKey(params: {
  sessionKey: string;
  config?: OpenClawConfig;
}): string;
```

### 3.5 Caching Behavior

```
SessionStore Cache
     │
     ├── TTL: 45 seconds (default)
     ├── Invalidation: mtime check on file
     ├── Write: temp-file → rename (atomic)
     ├── Lock: async queue per store path
     └── Deep copy: structuredClone on read (mutation protection)
```

---

## 4. Session Transcripts

### 4.1 Format

Line-delimited JSON (JSONL). Each line is one `AgentMessage`.

### 4.2 File Location

```
~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
```

### 4.3 Message Ordering

Messages are appended in chronological order:

```
Line 1: UserMessage       (user prompt)
Line 2: AssistantMessage   (LLM response, may include tool calls)
Line 3: ToolResultMessage  (tool execution result)
Line 4: AssistantMessage   (LLM response to tool result)
Line 5: UserMessage        (next user prompt)
...
```

### 4.4 Compaction

When context overflow occurs:

```
Before compaction:
  [user1] [assistant1] [tool1] [assistant2] [user2] [assistant3] ...

After compaction:
  [compaction_summary] [user_recent] [assistant_recent] ...
```

The compacted transcript replaces older messages with a summary message while preserving recent context.

---

## 5. Auth Profile Store

### 5.1 Location

```
~/.openclaw/agents/<agentId>/auth/
```

### 5.2 Profile Structure

```typescript
type AuthProfileCredential =
  | { type: "api-key"; apiKey: string }
  | { type: "oauth"; accessToken: string; refreshToken?: string; expiresAt?: number }
  | { type: "token"; token: string }
  | { type: "aws-sdk" };
```

### 5.3 Profile Metadata

```typescript
type AuthProfile = {
  id: string;
  provider: string;
  credential: AuthProfileCredential;
  lastUsed?: number;
  lastFailed?: number;
  failureCount?: number;
  cooldownUntil?: number;
};
```

---

## 6. Models Configuration

### 6.1 Location

```
~/.openclaw/agents/<agentId>/models.json
```

### 6.2 Auto-Generated

This file is auto-generated by `writeModelsConfig()` from:
- Auth profiles (discovered providers)
- Config providers (explicit configuration)
- Environment variables

### 6.3 Format

```json
{
  "providers": {
    "<providerId>": {
      "baseUrl": "string",
      "api": "string",
      "models": [
        {
          "id": "string",
          "name": "string",
          "reasoning": true,
          "input": ["text", "image"],
          "cost": { "input": 15, "output": 75, "cacheRead": 1.5, "cacheWrite": 18.75 },
          "contextWindow": 200000,
          "maxTokens": 32768
        }
      ]
    }
  }
}
```

---

## 7. Write Lock Semantics

### 7.1 Session Store Lock

Writes to the session store are serialized via an async lock queue:

```typescript
// Pseudo-implementation
const lockQueues = new Map<string, Promise<void>>();

async function withStoreLock(path: string, fn: () => Promise<void>) {
  const prev = lockQueues.get(path) ?? Promise.resolve();
  const next = prev.then(fn).catch(() => {});
  lockQueues.set(path, next);
  return next;
}
```

### 7.2 Atomic Writes

Session store writes use temp-file-then-rename for atomicity:

```
1. Write to <path>.tmp.<random>
2. fsync the temp file
3. rename temp → target (atomic on POSIX)
```

### 7.3 Windows Workaround

On Windows, read retries with 50ms backoff handle partially-written files.

---

## 8. Session Key Format

### 8.1 Derivation

```typescript
function deriveSessionKey(params): string {
  // Format: <channel>:<normalized_from>
  // Examples:
  //   "telegram:+1234567890"
  //   "discord:guild123:channel456"
  //   "slack:team123:C123456"
  //   "web:session_abc123"
  //   "cli:local"
}
```

### 8.2 Normalization

- All session keys are lowercased
- Phone numbers are E.164 normalized
- Legacy key formats are migrated on read
