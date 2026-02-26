# Respec Review — 03 Tool Packaging Format

Source of truth: `openclaw/` (current workspace).

## Discrepancies

### Manifest schema: `configSchema` is required (correct), but Respec over-specifies its shape
- OpenClaw requires `configSchema` to be an object, but does not enforce `type/properties/required` at load time (`openclaw/src/plugins/manifest.ts`).
- Respec presents `configSchema` as a strict JSON Schema object with `type/properties/required`. That’s a *convention*, not a loader-enforced rule.

### package.json `openclaw` install metadata differs
- Respec uses `install: { source: 'npm' }`.
- OpenClaw’s `PluginPackageInstall` type is `{ npmSpec?: string; localPath?: string; defaultChoice?: 'npm' | 'local' }` (`openclaw/src/plugins/manifest.ts`). There is no `source` field.

### Discovery: fallback entry point heuristics
- Respec claims a fallback search for `src/index.ts` or `index.ts` in directories.
- OpenClaw discovery is driven primarily by:
  - explicit extension files under configured dirs, and
  - `package.json` `openclaw.extensions` entries (`openclaw/src/plugins/discovery.ts`).
- If there is an additional "src/index.ts" fallback, it must be confirmed in later sections of `discovery.ts`; Respec currently states it as a guaranteed behavior.

### Security checks are real but phrased differently
- Respec lists: symlink escape, world-writable, ownership.
- OpenClaw implements candidate blocking with reasons:
  - `source_escapes_root`, `path_world_writable`, `path_suspicious_ownership`, `path_stat_failed` (`openclaw/src/plugins/discovery.ts`).
- Respec should align wording ("blocked plugin candidate") and note that these are recorded as **warn diagnostics** (not hard errors) and candidate is skipped.

### Module loading details
- Respec’s jiti snippet shows `await jiti.import(candidate.source)`.
- OpenClaw uses a lazily-created jiti instance in `openclaw/src/plugins/loader.ts` with `interopDefault: true` and a full `extensions` allowlist. Respec should include these details since they affect supported module types.

## Confirmed matches
- `openclaw.plugin.json` filename is canonical (`PLUGIN_MANIFEST_FILENAME`).
- Manifest fields include `channels`, `providers`, `skills`, `uiHints` (all supported by loader).
