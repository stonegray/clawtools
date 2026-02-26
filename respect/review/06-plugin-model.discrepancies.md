# Respec Review — 06 Plugin Model

Source of truth: `openclaw/` (current workspace).

## Discrepancies

### Plugin API `registerHook` signature differs
- Respec lists `registerHook: (events, handler, opts?) => void` where handler is `InternalHookHandler`.
- OpenClaw's actual signature in `src/plugins/types.ts` is identical.
  - However, Respec describes the hook system with both untyped (string-based) and typed (`on<K>(hookName, handler)`) variants. Both are present in OpenClaw's API: `registerHook()` for string-based and `on()` for typed hooks. Respec should clarify this dual interface.

### Plugin loading lifecycle naming differs
- Respec numbers phases 1–13 and describes the full loading pipeline.
- OpenClaw's `loadOpenClawPlugins()` in `src/plugins/loader.ts` implements this, but exact phase boundaries and naming may differ from Respec's idealized version. This is mostly a documentation abstraction and not a real issue.

### Enable state resolution "Origin-based defaults"
- Respec claims "Bundled plugins: enabled by default, Other origins: enabled by default (unless restricted)".
- OpenClaw's `resolveEffectiveEnableState()` logic in `loader.ts` may have more nuanced behavior. The description is reasonable but simplified.

## Confirmed matches
- PluginHookName list matches exactly (24 hooks).
- OpenClawPluginApi interface matches respec exactly, with all registration methods present.
- Plugin registry structure matches respec.
- Plugin definition patterns (function export, object export, async patterns) all work.
