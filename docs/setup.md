---
summary: Get a working copy running with Bun on the host. No Docker.
covers:
  - packages/spriggs/src/run.ts
  - packages/spriggs/src/forge/local.ts
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

In `--local` mode there is no pull request number, so Spriggs prints the change entry to the console instead of writing a file under `docs/changes/`. The post-run check still runs, but it skips the working-tree part, because a local copy holds your own uncommitted changes. Docs edits stay in the working tree for you to review; nothing is committed. When no docs were written and no entry is needed, the run reports no docs change.

## Layout

```
packages/spriggs/   the harness and the `portolan` CLI
docs/               this repo's own docs, per the /docs contract
.github/workflows/  ci.yml (checks), spriggs.yml (the harness on pull requests)
```

## Pull requests

Fill in the **Why** section of the pull request template. The gate reads it. Without a reason, Spriggs asks for one and writes no entry.
