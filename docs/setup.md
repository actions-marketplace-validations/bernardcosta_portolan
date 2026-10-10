---
summary: Get a working copy running with Bun on the host. No Docker.
covers:
  - packages/spriggs/src/run.ts
  - packages/spriggs/src/forge/local.ts
  - packages/spriggs/src/agent/model.ts
  - packages/spriggs/src/cli.ts
  - packages/spriggs/src/gate/decide.ts
  - packages/spriggs/src/report.ts
  - .github/workflows/spriggs.yml
  - .env.example
---

# Setup

## Requirements

- Bun 1.3.11. The `packageManager` field in `package.json` pins it. On macOS: `brew install oven-sh/bun/bun`.
- Git.

## Steps

1. Clone the repo.
2. Copy `.env.example` to `.env` and add one provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`). Set `SPRIGGS_MODEL` too, unless you only use Anthropic (see [Model](#model)). `.env` is gitignored.
3. Install dependencies: `bun install`.
4. Run the checks: `bun run check` and `bun run typecheck`. This runs Biome (lint and format) and `tsc`.

## Commands

| Command | Does |
| --- | --- |
| `bun run check` | Lint and format check |
| `bun run typecheck` | Typecheck |
| `bun run fix` | Apply Biome fixes |
| `bun run spriggs run --local --base <ref>` | Run Spriggs on the working copy against `<ref>`, with no GitHub |

Full usage: `portolan spriggs run [--local --base <ref> [--reason <text>]] [--model <provider/model>]`.

- `--reason <text>` (local only) takes the place of the pull request description's **Why** section, so the gate can pass without GitHub. Without it, a local run has no description.
- `--model <provider/model>` overrides `SPRIGGS_MODEL`.

In `--local` mode the diff is the working copy (uncommitted and untracked files included) against the merge-base with `<ref>`. The commit messages between the merge-base and `HEAD` are passed to the model too. A local run is not skipped when the head commit is Spriggs's own, so you can run right after a Spriggs commit. The comment, label and status are printed to the console, not posted. There is no pull request number, so Spriggs prints the change entry to the console instead of writing a file under `docs/changes/`. The post-run check still runs, but it skips the working-tree part, because a local copy holds your own uncommitted changes. Docs edits stay in the working tree for you to review; nothing is committed. When no docs were written and no entry is needed, the run reports no docs change.

## Model

The model is `provider/model`. Precedence: the `--model` flag, then `SPRIGGS_MODEL`, then `anthropic/claude-opus-5-5` when `ANTHROPIC_API_KEY` is set. Providers:

| Prefix | Key |
| --- | --- |
| `anthropic/<model>` | `ANTHROPIC_API_KEY` |
| `openai/<model>` | `OPENAI_API_KEY` |
| `openrouter/<vendor>/<model>` | `OPENROUTER_API_KEY` |

A missing model or key fails the run before any network call, naming the missing variable.

## CI

`.github/workflows/spriggs.yml` runs `bun run spriggs run` on pull requests (opened, synchronize, reopened, edited), one run at a time per pull request. It needs the repository secret `ANTHROPIC_API_KEY` and, optionally, the repository variable `SPRIGGS_MODEL`. It uses the workflow's `GITHUB_TOKEN` with `contents`, `pull-requests` and `statuses` write permissions.

Each run posts one sticky comment, sets exactly one label (`docs:done`, `docs:partial`, `docs:none` or `docs:needs-input`) and sets a `spriggs` commit status on the head commit. The comment is written in plain first-person words. It starts with the gate result (**Gate: go**, **Gate: partial** or **Gate: stopped**) and why, then what the run did, then a folded **What I saw** table with the signals the gate read. The commit status carries a one-line form of the gate result. Runs are skipped for pull requests from forks or Dependabot, pull requests that change only `docs/`, and Spriggs's own commits. Editing the description reruns Spriggs only when the body changed and the pull request is labelled `docs:needs-input` or `docs:partial`.

The status is `success` in most cases. It is `failure` when the run fails (missing model or key, agent error, failed post-run check), which also sets `docs:needs-input`. When the gate stops, the status is `failure` only if the change is breaking or the environment variable `SPRIGGS_BLOCKING` is `true`; otherwise it stays `success`.

The model sees the subject and body of each commit in the pull request, oldest first. If the description has not changed since the last run but new commits were pushed, the comment shows a **Heads up** note with the number of newer commits and asks whether the reason still holds. The model is told to prefer the commit messages for those commits. This note never blocks the run.

## Layout

```
packages/spriggs/   the harness and the `portolan` CLI
docs/               this repo's own docs, per the /docs contract
.github/workflows/  ci.yml (checks), spriggs.yml (the harness on pull requests)
```

## Pull requests

Fill in the **Why** section of the pull request template. The gate reads it; a description of 20 words or more also counts as a reason. Without a reason, Spriggs still updates the docs from the diff but marks the run `docs:partial` and asks for one. With no reason and a diff over 1500 changed lines, Spriggs abstains: it writes nothing and sets `docs:needs-input`. When you push new commits that change the intent, update the description too, or write the reason in the commit messages.
