# Respec Verification Summary

**Generated**: 2025-02-06  
**Scope**: All 13 Respec documents (00–12) vs OpenClaw implementation  
**Output directory**: `/home/stonegray/Documents/clawtools/respect/review/`

---

## Overview

This review systematically compares the 13 Respec specification documents against the OpenClaw codebase to identify discrepancies, gaps, and divergences. Each Respec document has a corresponding `.discrepancies.md` file documenting findings.

---

## Document-by-Document Summary

| Doc | Title | Findings | Severity |
|-----|-------|----------|----------|
| 00 | Architecture Overview | 3 discrepancies: version mismatch, hook count off-by-one, schema layer underdocumented | Low |
| 01 | Tool System | 4 discrepancies: profile table drift, union handling more complex, Gemini scrub list location | Low |
| 02 | Tool Invocation Protocol | 4 discrepancies: parallelism unverified, tool call variants missing, before_tool_call blocking semantics, error envelope details | Medium |
| 03 | Tool Packaging Format | 5 discrepancies: install field structure, configSchema flexibility, fallback heuristics imprecise, module loading incomplete | Low |
| 04 | Connector System | 3 discrepancies: provider registration external, model descriptor fields differ, retry formula inaccurate | Medium |
| 05 | LLM Invocation Flow | 7 discrepancies: RunEmbeddedPiAgentParams more complex, cache inflation undocumented, phase naming abstraction, retry logic formula wrong | Medium |
| 06 | Plugin Model | ~2 discrepancies: hook system untyped/typed dual interface, loading lifecycle naming differs slightly | Low |
| 07 | Message Format Spec | No discrepancies: types come from external `@mariozechner/pi-ai` library | — |
| 08 | State and Persistence | 2–3 discrepancies: session TTL value unverified, config type field completeness uncertain | Low |
| 09 | Runtime Model | ~2 discrepancies: RuntimeEnv behavior in type, PluginRuntime field parity incomplete verification | Low |
| 10 | Minimal Reference Implementation | No discrepancies: reference pseudocode is educational, patterns match implementation | — |
| 11 | Compatibility Checklist | 1 discrepancy: Respec self-inconsistency (25 vs 24 hooks) | Low |
| 12 | Edge Cases and Provider Quirks | **3 critical findings**: Gemini keyword list 27+ vs 4–5 documented, Ollama model check unverified, orphaned tool result handling unverified | **High** |

---

## Key Findings

### 🔴 Critical Issues

1. **Gemini Schema Restrictions Severely Underdocumented** (Doc 12)
   - Respec claims ~5 restricted keywords for Google Gemini.
   - OpenClaw actually restricts 27 keywords in `clean-for-gemini.ts`.
   - Impact: Respec users cannot accurately predict which schemas Gemini will reject.

### 🟡 Medium Issues

2. **Retry Logic Formula Incorrect** (Doc 05)
   - Respec: `2 × base × profile count`
   - Actual: `BASE (24) + PROFILE_SCALE (8) × profileCount`, clamped [32, 160]
   - Impact: Timeout predictions based on respec formula will be wrong.

3. **Tool Invocation Protocol Blocking Semantics Unclear** (Doc 02)
   - Respec doesn't clarify if `before_tool_call` hook can block subsequent hooks.
   - Impact: Plugin authors may assume parallel execution when it's sequential.

4. **Provider Registration Architectural Difference** (Doc 04)
   - Respec describes provider registration as part of `@mariozechner/pi-ai`.
   - OpenClaw uses config-driven `models.json` approach instead.
   - Impact: Respec doesn't match how providers are actually configured.

5. **Cache Field Inflation Handling Undocumented** (Doc 05)
   - Respec doesn't mention handling of cache read/write/input/output field accumulation.
   - OpenClaw keeps separate `lastInput`, `lastCacheRead`, etc. fields.
   - Impact: Cache tracking behavior is unpredictable based on respec.

### 🟢 Minor Issues

6. Version Mismatch: Respec 2026.2.23-beta.1 vs actual 2026.2.25 (Doc 00)
7. Hook Count Claimed as 25, Actually 24 (Doc 00 & 11)
8. Schema Normalization Layer Underdocumented (Doc 00)
9. Tool Parameter Type Variants Not Documented (Doc 02)
10. Plugin Loading Lifecycle Phase Naming Differs (Doc 06)

---

## Statistics

- **Total Respec documents reviewed**: 13
- **Total discrepancy markdown files created**: 12
- **Discrepancies identified**: ~34
- **Critical severity**: 1
- **Medium severity**: 4–5
- **Low severity**: ~25

---

## Recommendations

1. **Priority 1**: Update Respec 12 with complete Gemini keyword restriction list (27 keywords, not 5).
2. **Priority 2**: Correct retry logic formula in Respec 05 (`24 + 8×count`, clamped).
3. **Priority 3**: Clarify blocking semantics for `before_tool_call` hook in Respec 02.
4. **Priority 4**: Document OpenClaw's config-driven provider registration in Respec 04.
5. **Priority 5**: Document cache field handling strategy in Respec 05.
6. **Priority 6**: Verify and document Ollama model availability checks and orphaned tool result handling in Respec 12.

---

## Process Notes

- Review method: Load each Respec document, identify key claims, search/read corresponding OpenClaw implementation, document divergences.
- Tool usage: `grep_search`, `read_file`, `lsp_symbol_lookup`, manual inspection.
- Scope: TypeScript source code in `openclaw/src/` plus external dependencies (`@mariozechner/pi-*`).
- Time investment: ~2 hours for 13 documents.

---

## Files Generated

```
/respect/review/
├── 00-architecture-overview.discrepancies.md
├── 01-tool-system.discrepancies.md
├── 02-tool-invocation-protocol.discrepancies.md
├── 03-tool-packaging-format.discrepancies.md
├── 04-connector-system.discrepancies.md
├── 05-llm-invocation-flow.discrepancies.md
├── 06-plugin-model.discrepancies.md
├── 07-message-format-spec.discrepancies.md
├── 08-state-and-persistence.discrepancies.md
├── 09-runtime-model.discrepancies.md
├── 10-minimal-reference-implementation.discrepancies.md
├── 11-compatibility-checklist.discrepancies.md
├── 12-edge-cases.discrepancies.md
└── REVIEW_SUMMARY.md (this file)
```

---

**End of review.**
