# Security Policy

clawtools is a compatibility adapter for [OpenClaw](https://github.com/openclaw/openclaw). Because it bundles upstream tool and connector implementations, security issues may originate in either project.

## Where to Report

### Report to **OpenClaw** when the issue is in:

- A **bundled tool implementation** (code that originates from `openclaw/src/agents/tools/`)
- A **bundled connector** backed by `@mariozechner/pi-ai` provider SDKs
- **Extension metadata** read from `openclaw/extensions/`
- The **OpenClaw runtime**, CLI, gateway, channels, or any other OpenClaw component

Follow the [OpenClaw Security Policy](https://github.com/openclaw/openclaw/blob/main/SECURITY.md) and report via their private disclosure process or email **[security@openclaw.ai](mailto:security@openclaw.ai)**.

### Report to **clawtools** when the issue is in:

- The **clawtools adapter layer** — code in `src/` (registries, discovery, types, schema utilities, parameter helpers)
- The **build/bundle scripts** (`scripts/bundle-core-tools.mjs`, `scripts/bundle-core-connectors.mjs`)
- **Auth resolution** logic (`resolveAuth` in `src/connectors/registry.ts`)
- **Plugin loading** (`src/plugins/loader.ts`)
- A **dependency** listed in clawtools' own `package.json` (e.g., `ajv`, `@sinclair/typebox`, `undici`)
- **Examples, tests, or documentation** shipped in this repository

Use [GitHub Private Vulnerability Reporting](https://github.com/stonegray/clawtools/security/advisories/new) to file a report.

### Not sure?

If you're uncertain which project is affected, report to **clawtools** — we'll triage and redirect to OpenClaw if needed.


## Out of Scope

- Issues in the `openclaw/` git submodule (report upstream — see above).
- Vulnerabilities that require the attacker to already have arbitrary code execution on the host.
- Denial-of-service via intentionally malformed tool parameters when the caller controls the input (clawtools trusts its caller to provide valid parameters, same as any library).
