---
summary: Get a working copy running with Bun on the host. No Docker.
covers:
  - package.json
  - packages/spriggs/package.json
  - packages/spriggs/src/cli.ts
  - packages/spriggs/src/forge/local.ts
  - packages/spriggs/src/agent/model.ts
  - .github/workflows/ci.yml
  - .github/workflows/spriggs.yml
  - .env.example
  - action.yml
  - scripts/open-survey-pr.sh
  - scripts/bunfig.toml
---

# Setup

## Requirements

- Bun 1.3.11. The `packageManager` field in `package.json` pins it. On macOS: `brew install oven-sh/bun/bun`.
- Git.

## Steps

1. Clone the repo.
2. Copy `.env.example` to `.env` and add one provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`). Set `SPRIGGS_MODEL` too, unless you only use Anthropic (see [Model](#model)). `.env` is gitignored.
3. Install dependencies: `bun install`.
4. Run the checks: `bun run check` and `bun run typecheck`. This runs Biome (lint and format) and `tsc`. The `ci` workflow (`.github/workflows/ci.yml`) runs the same two checks, after `bun install --frozen-lockfile`, on every pull request and on pushes to `main`.

## Commands

| Command | Does |
| --- | --- |
| `bun run check` | Lint and format check (`biome ci .`) |
| `bun run typecheck` | Typecheck (`tsc --noEmit -p packages/spriggs`) |
| `bun run fix` | Apply Biome fixes |
| `bun run spriggs run --local --base <ref>` | Run Spriggs on the working copy against `<ref>`, with no GitHub |
| `bun run spriggs survey` | Check the docs of the whole repository against the code and fill the gaps (see [Survey](#survey-spriggs-survey)) |

Full usage:

```
portolan spriggs run [--local --base <ref> [--reason <text>]] [--model <provider/model>]
portolan spriggs survey [--model <provider/model>]
```

- `--reason <text>` (local only) takes the place of the pull request description's **Why** section, so the gate can pass without GitHub. Without it, a local run has no description.
- `--model <provider/model>` overrides `SPRIGGS_MODEL`.

Every flag and environment variable is listed in [configuration.md](reference/configuration.md).

## Local run

In `--local` mode the diff is the working copy (uncommitted and untracked files included) against the merge-base with `<ref>`. The commit messages between the merge-base and `HEAD` are passed to the model too. The repo does not need an `origin` remote, so a fresh or throwaway repo works. A local run is not skipped when the head commit is Spriggs's own, so you can run right after a Spriggs commit. The comment, label and status are printed to the console, not posted. There is no pull request number, so Spriggs prints the change entry to the console instead of writing a file under `docs/changes/`. The post-run check still runs, but it skips the working-tree part, because a local copy holds your own uncommitted changes. Docs edits stay in the working tree for you to review; nothing is committed. When no docs were written and no entry is needed, the run reports no docs change.

What each step of a run does is in [A pull request run](spriggs/pull-request-run.md).

## Survey: spriggs survey

A pull request run only sees one diff. On a repository with no docs yet, or with docs far behind the code, run `bun run spriggs survey` from the repository root. A separate agent explores the whole repository, checks the docs against the code and writes `docs/` in the working tree. It leaves a `docs/todo.md` listing what it did not write or check, and the next run starts with that list. Locally nothing is committed: review the result, then commit it and open a pull request yourself. The run prints a report between the lines `--- survey result ---` and `--- end ---`, and exits with 0 (done), 1 (the post-run check failed) or 3 (stopped early; the pages so far stay).

You can also run it from the GitHub Action, which opens the pull request for you. Add `workflow_dispatch:` under `on:` in your Spriggs workflow, then open **Actions → spriggs → Run workflow**.

The steps, the report, the exit codes and the pull request the action opens are in [The survey](spriggs/cold-start.md).

## Model

The model is `provider/model`. Precedence: the `--model` flag, then `SPRIGGS_MODEL`, then `anthropic/claude-opus-5-5` when `ANTHROPIC_API_KEY` is set. Providers:

| Prefix | Key |
| --- | --- |
| `anthropic/<model>` | `ANTHROPIC_API_KEY` |
| `openai/<model>` | `OPENAI_API_KEY` |
| `openrouter/<vendor>/<model>` | `OPENROUTER_API_KEY` |

A missing model or key fails the run before any network call, naming the missing variable.

## Use Spriggs in another repository

Spriggs is a GitHub Action. The `action.yml` at the root of this repository is the action; it checks out the pull request, installs Bun and Spriggs's dependencies, and runs the harness. Add this workflow to the repository as `.github/workflows/spriggs.yml`, and add the secret `ANTHROPIC_API_KEY` (or the key of the provider you choose):

```yaml
name: spriggs
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
  workflow_dispatch:
concurrency:
  group: spriggs-${{ github.event.pull_request.number || 'survey' }}
  cancel-in-progress: false
permissions:
  contents: write
  pull-requests: write
  statuses: write
jobs:
  spriggs:
    if: github.actor != 'github-actions[bot]'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: bernardcosta/portolan@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

The `workflow_dispatch:` line lets you run the [survey](spriggs/cold-start.md#in-ci) by hand from the same file. The concurrency group runs one job at a time per pull request, and one survey at a time. The 60-minute timeout is a backstop: the agent checks its own time budget only between turns.

The action's inputs (`command`, `model`, the provider keys, `github-token`, `app-id`, `app-private-key`, `max-lines`) are listed in [the action reference](reference/github-action.md#inputs). Other settings go through `env:` on the step, for example `SPRIGGS_CONTEXT_TOKENS` and `SPRIGGS_BLOCKING`. The action does not read a `.env` or `bunfig.toml` from your repository, so a setting kept in a committed `.env` does not reach Spriggs in CI: put it under `env:` on the step (see [why](reference/github-action.md#bun-settings-from-the-repository-are-ignored)). Local runs are not affected: `bun run spriggs` still loads your own `.env`.

Any provider from the [Model](#model) section works. The default is a convenience, not a requirement. For example, a Gemini model through OpenRouter:

```yaml
      - uses: bernardcosta/portolan@main
        with:
          model: openrouter/google/gemini-2.5-pro
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

No checkout step is needed: the action checks out the head commit itself. The repository needs no `docs/` folder to start; Spriggs creates the required pages on the first pull request that needs them. While the repository has no doc pages, the sticky comment of each pull request run points to the survey. For a fuller first set of docs, run [`spriggs survey`](#survey-spriggs-survey) first, locally or from the action.

If you use a GitHub App, you can also skip the job on the App's own pushes by adding `&& github.actor != '<slug>[bot]'` to the `if:` line. Without it the job starts, and the harness skips its own commits anyway.

While this repository is private, other repositories can use the action only when they belong to the same owner and the repository setting **Actions → General → Access** allows it.

## CI

This repository has two workflows:

- `ci.yml` runs `bun run check` and `bun run typecheck` on pull requests and on pushes to `main`.
- `spriggs.yml` uses the action from its own checkout (`uses: ./`). It runs on pull requests (opened, synchronize, reopened, edited), one run at a time per pull request, and by hand (`workflow_dispatch`) for the survey, one at a time. The job has a 60-minute timeout. It needs the repository secret `ANTHROPIC_API_KEY` and, optionally, the repository variable `SPRIGGS_MODEL`; an `openrouter/` model also needs the repository secret `OPENROUTER_API_KEY`. It uses the workflow's `GITHUB_TOKEN` with `contents`, `pull-requests` and `statuses` write permissions, unless the variables `SPRIGGS_APP_ID` and `SPRIGGS_APP_SLUG` and the secret `SPRIGGS_APP_PRIVATE_KEY` are set (see [Run as a GitHub App](#run-as-a-github-app-optional)). The job does not start for Spriggs's own pushes: it is skipped when the actor is `github-actions[bot]` or the App's bot, and the harness checks again.

Each Spriggs run posts one sticky comment, sets exactly one label (`docs:done`, `docs:partial`, `docs:none` or `docs:needs-input`) and sets a `spriggs` commit status. When a run ends `docs:done` or `docs:none`, it also marks the earlier merged pull requests it caught up on `docs:done`. What each outcome means, when a run is skipped, and when the status fails are in [A pull request run](spriggs/pull-request-run.md#10-report).

### Run as a GitHub App (optional)

With the workflow's own token, comments and commits appear as `github-actions[bot]`, and GitHub does not start workflows for Spriggs's pushes, so `ci` never checks the docs commit. A GitHub App fixes both: Spriggs then acts as `<your-app>[bot]`, its pushes start workflows like anyone's, and the `spriggs` job skips itself on them. Each team registers its own App; the private key never leaves the team.

1. Register the App at **Settings → Developer settings → GitHub Apps → New GitHub App** (on your user or your organisation). Name it, for example `spriggs`. Any homepage URL. Untick **Webhook → Active**. Under **Repository permissions** set Contents: Read and write, Pull requests: Read and write, Commit statuses: Read and write. Leave the rest at No access. Create it.
2. On the App's page note the **App ID** and the **slug** (the lower-case name in the App's URL). Generate a **private key** and keep the `.pem` file.
3. Install the App on the repositories that run Spriggs: **Install App** in the left menu.
4. In each repository set two variables and one secret:
   ```
   gh variable set SPRIGGS_APP_ID --body "<App ID>"
   gh variable set SPRIGGS_APP_SLUG --body "<slug>"
   gh secret set SPRIGGS_APP_PRIVATE_KEY < spriggs.private-key.pem
   ```
5. Pass them to the action: `app-id: ${{ vars.SPRIGGS_APP_ID }}` and `app-private-key: ${{ secrets.SPRIGGS_APP_PRIVATE_KEY }}` under `with:`. This repository's own workflow already does.

When `app-id` is set, the action mints a one-hour token from the key before each run and passes it to Spriggs as `GITHUB_TOKEN`, with the slug in `SPRIGGS_APP_SLUG`. This also works on events that are not pull requests, such as a `workflow_dispatch` survey run. For pull requests from forks, which get no secrets, the action skips this step. Spriggs commits as `<slug>[bot] <id+slug[bot]@users.noreply.github.com>`, the address GitHub links to the App, and treats commits by either identity as its own. Without `app-id`, nothing changes.

## Layout

```
action.yml          the GitHub Action other repositories use
scripts/            open-survey-pr.sh (commits docs/ and opens the pull request after a survey run in CI),
                    bunfig.toml (empty on purpose; the action points Bun at it)
packages/spriggs/   the harness and the `portolan` CLI
docs/               this repo's own docs, per the /docs contract
.github/workflows/  ci.yml (checks), spriggs.yml (the harness on pull requests and the survey
                    by hand, through action.yml)
```

## Pull requests

Fill in the **Why** section of the pull request template. The gate reads it; a description of 20 words or more also counts as a reason. Without a reason, Spriggs still updates the docs from the diff of a change up to 1,500 lines, but marks the run `docs:partial` and asks for one. With no reason and a diff over 1,500 changed lines, Spriggs abstains: it writes nothing and sets `docs:needs-input`. Any change over the line limit (5,000 by default) is also stopped, reason or not. When you push new commits that change the intent, update the description too, or write the reason in the commit messages.
