# Contributing

## Branch model

| Branch | Purpose |
|--------|---------|
| `main` | Always releasable. Every push triggers CI. Pushing a `v*` tag triggers a publish to NPM. |
| `dev`  | Active development. CI runs on every push. Merge into `main` only when ready to release. |

## Workflow

```
dev  ──── feature work ────► dev  ──── PR ────► main  ──── tag ────► NPM
```

### Day-to-day development

```bash
git checkout dev
# ... make changes ...
git push origin dev          # CI runs (typecheck + test × 3 Node versions + build)
```

### Merging to main

```bash
git checkout main
git merge --no-ff dev
git push origin main         # CI runs again on main
```

### Releasing to NPM

Bump the version, tag, and push — the publish workflow handles the rest:

```bash
# On main, after merging dev:
npm run release:patch    # → 0.1.0 → 0.1.1
npm run release:minor    # → 0.1.0 → 0.2.0
npm run release:major    # → 0.1.0 → 1.0.0
```

This runs `npm version <level>`, commits the version bump, tags it `v<version>`,
and pushes both the commit and the tag to `main`. GitHub Actions picks up the tag
and runs the publish workflow.

For pre-releases (tags containing `-` are marked as pre-release on GitHub):

```bash
npm version 1.0.0-beta.1
git push origin main --follow-tags
```

## Required GitHub setup (one-time)

1. **NPM token** — go to [npmjs.com](https://www.npmjs.com) → Account → Access Tokens → Generate New Token (Automation). Then in the repo: **Settings → Environments → New environment** named `npm`, add secret `NPM_TOKEN`.

2. **Branch protection** — Settings → Branches → Add rule:
   - Branch name pattern: `main`
   - ✅ Require status checks to pass: `Type check`, `Test (Node 22)`, `Build`
   - ✅ Require branches to be up to date before merging
   - ✅ Restrict who can push (optional)

3. Same protection on `dev` with just the CI checks (no release restriction needed).

## Running CI locally

```bash
npm run typecheck           # tsc --noEmit (src/)
npm run typecheck:test      # tsc --noEmit (test/)
npm test                    # vitest run
npm run test:coverage       # vitest run --coverage
npm run build               # tsc → dist/
```
