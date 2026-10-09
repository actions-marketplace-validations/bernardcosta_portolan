---
summary: Get a working copy running with Bun on the host. No Docker.
---

# Setup

## Requirements

- Bun 1.3.11. The `packageManager` field in `package.json` pins it. On macOS: `brew install oven-sh/bun/bun`.
- Git.

## Steps

1. Clone the repo.
2. Copy `.env.example` to `.env`. Add one provider key and `SPRIGGS_MODEL`. `.env` is gitignored.
3. Install dependencies: `bun install`.
4. Run the checks: `bun run check` and `bun run typecheck`. This runs Biome (lint and format) and `tsc`.

## Commands

| Command | Does |
| --- | --- |
| `bun run check` | Lint and format check |
| `bun run typecheck` | Typecheck |
| `bun run fix` | Apply Biome fixes |
| `bun run spriggs run --local --base <ref>` | Run Spriggs on the working copy against `<ref>`, with no GitHub |

## Layout

```
packages/spriggs/   the harness and the `portolan` CLI
docs/               this repo's own docs, per the /docs contract
.github/workflows/  ci.yml (checks), spriggs.yml (the harness on pull requests)
```

## Pull requests

Fill in the **Why** section of the pull request template. The gate reads it. Without a reason, Spriggs asks for one and writes no entry.
