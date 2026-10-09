---
summary: Get a working copy running. Everything runs inside Docker; nothing is installed on the host.
---

# Setup

## Requirements

- Docker with Compose v2.
- `make`.
- Git.

Do not install Bun or Node on the host. The container has them.

## Steps

1. Clone the repo.
2. Copy `.env.example` to `.env`. Add one provider key and `SPRIGGS_MODEL`. `.env` is gitignored.
3. Build the image: `make build`.
4. Install dependencies: `make install`.
5. Run the checks: `make check`. This runs Biome (lint and format) and `tsc`.

## Commands

| Command | Does |
| --- | --- |
| `make check` | Lint, format check and typecheck |
| `make fix` | Apply Biome fixes |
| `make spriggs-local BASE=<ref>` | Run Spriggs on the working copy against `<ref>`, with no GitHub |
| `make sh` | A shell in the container |

Any other command: `docker compose run --rm dev <command>`.

## Layout

```
packages/spriggs/   the harness and the `portolan` CLI
docs/               this repo's own docs, per the /docs contract
.github/workflows/  ci.yml (checks), spriggs.yml (the harness on pull requests)
```

## Pull requests

Fill in the **Why** section of the pull request template. The gate reads it. Without a reason, Spriggs asks for one and writes no entry.
