---
summary: Get a working copy running with Bun on the host. No Docker.
covers:
  - packages/spriggs/src/run.ts
  - packages/spriggs/src/forge/local.ts
  - packages/spriggs/src/forge/github.ts
  - packages/spriggs/src/context.ts
  - packages/spriggs/src/gate/signals.ts
  - packages/spriggs/src/agent/model.ts
  - packages/spriggs/src/agent/loop.ts
  - packages/spriggs/src/agent/tools.ts
  - packages/spriggs/src/agent/prompt.ts
  - packages/spriggs/src/agent/providers/types.ts
  - packages/spriggs/src/agent/providers/anthropic.ts
  - packages/spriggs/src/cli.ts
  - packages/spriggs/src/gate/decide.ts
  - packages/spriggs/src/docs/tree.ts
  - packages/spriggs/src/enforce.ts
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

## Use Spriggs in another repository

Spriggs is a GitHub Action. The `action.yml` at the root of this repository is the action; it checks out the pull request, installs Bun and Spriggs's dependencies, and runs the harness. Add this workflow to the repository as `.github/workflows/spriggs.yml`, and add the secret `ANTHROPIC_API_KEY` (or the key of the provider you choose):

```yaml
name: spriggs
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
concurrency:
  group: spriggs-${{ github.event.pull_request.number }}
  cancel-in-progress: false
permissions:
  contents: write
  pull-requests: write
  statuses: write
jobs:
  spriggs:
    if: github.actor != 'github-actions[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: bernardcosta/portolan@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Inputs, all optional: `model` (`provider/model`, default `anthropic/claude-opus-5-5` when the Anthropic key is set), `anthropic-api-key`, `openai-api-key`, `openrouter-api-key`, `github-token` (default: the workflow's own token), `app-id` and `app-private-key` (see [Run as a GitHub App](#run-as-a-github-app-optional)), and `max-lines` (default 5000). Other settings go through `env:` on the step, for example `SPRIGGS_CONTEXT_TOKENS` and `SPRIGGS_BLOCKING`. No checkout step is needed: the action checks out the head commit itself. The repository needs no `docs/` folder to start; Spriggs creates the required pages on the first pull request that needs them.

While this repository is private, other repositories can use the action only when they belong to the same owner and the repository setting **Actions → General → Access** allows it.

## CI

`.github/workflows/spriggs.yml` in this repository uses the action itself (`uses: ./`) on pull requests (opened, synchronize, reopened, edited), one run at a time per pull request. It needs the repository secret `ANTHROPIC_API_KEY` and, optionally, the repository variable `SPRIGGS_MODEL`. It uses the workflow's `GITHUB_TOKEN` with `contents`, `pull-requests` and `statuses` write permissions, unless you set up a GitHub App (see [Run as a GitHub App](#run-as-a-github-app-optional)).

Each run posts one sticky comment, sets exactly one label (`docs:done`, `docs:partial`, `docs:none` or `docs:needs-input`) and sets a `spriggs` commit status on the head commit. Spriggs reads the current labels from GitHub before it sets its own, so a run that waited in the queue still leaves one label. Only a comment posted by Spriggs itself counts as the sticky comment. The comment is written in plain first-person words. Its first line is the docs label in bold, followed by what that label means for this change (for example, why it is partial and what to add). Then comes what the run did, including the list of files in the `docs:` commit; files the run created are marked "(new page)". Then a folded **What I saw** table with the signals the gate read, including the size and the line limit. The commit status carries a one-line form of the result, starting with `done:`, `partial:` or `stopped:`. Runs are skipped for pull requests from forks or Dependabot, pull requests opened from the default branch, pull requests that change only `docs/`, and Spriggs's own commits. For Spriggs's own pushes the job does not start at all: the workflow skips it when the actor is `github-actions[bot]` or the App's bot, and the harness checks again. Editing the description reruns Spriggs only when the body changed and the pull request is labelled `docs:needs-input` or `docs:partial`.

The status is `success` in most cases. It is `failure` when the run fails (missing model or key, agent error, failed post-run check, failed push of the docs commit), which also sets `docs:needs-input`. When the gate stops, the status is `failure` only if the change is breaking or the environment variable `SPRIGGS_BLOCKING` is `true`; otherwise it stays `success`. A change is breaking when the title or a commit subject has a `!` after its type (for example `feat!:`), or when the description or any commit body has a line that starts with `BREAKING CHANGE:`. The words quoted inside a sentence do not count.

The model sees the subject and body of each commit in the pull request, oldest first. If the description has not changed since the last run but new commits were pushed, the comment shows a **Heads up** note with the number of newer commits and asks whether the reason still holds. Spriggs's own docs commit is not counted. The model is told to prefer the commit messages for those commits. This note never blocks the run.

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

The workflow mints a one-hour token from the key before each run and passes it to Spriggs as `GITHUB_TOKEN`, with the slug in `SPRIGGS_APP_SLUG`. For pull requests from forks, which get no secrets, the workflow skips this step. Spriggs commits as `<slug>[bot] <id+slug[bot]@users.noreply.github.com>`, the address GitHub links to the App, and treats commits by either identity as its own. Without the variables, nothing changes.

### Size and coverage

The model gets the whole diff of each changed file inline, up to about 320 KB in total (about 5,000 changed lines). Files that do not fit are listed as "not shown". If the model tries to finish before reading them, Spriggs reminds it once; a second finish is accepted. The model's `read_file` tool returns up to 64 KB per call and takes a start line and a line count, so it can read a large file in parts. A single line longer than 64 KB is cut at that size and marked as cut. `read_file` only reads regular files inside the repo, not symlinks.

The budget depends on the size of the change, counted in changed lines with generated files left out:

| Size | Turns | Tokens | Time |
| --- | --- | --- | --- |
| Up to 1,500 lines | 30 | 600,000 | 10 minutes |
| 1,501 lines up to the limit | 40 | 1,500,000 | 15 minutes |

Tokens are input tokens not served from the provider's cache, plus output tokens.

The limit is 5,000 lines. Set the environment variable `SPRIGGS_MAX_LINES` to change it. Above the limit, Spriggs writes nothing, sets `docs:needs-input` and asks you to split the pull request.

Spriggs counts which changed files (generated files left out) the model actually saw, inline or by reading them with `read_diff` or `read_file`, and logs `coverage: read N/M`. A `read_diff` result cut at 64 KB does not count as seen; the model must use `read_file` for the rest. If the model finishes with some changed files never seen, for example by finishing again after the reminder, the run is marked `docs:partial` (even when the docs needed no change), the comment lists the unread files under **Not read:**, and the change entry records partial coverage. A run that runs out of turns, tokens or time before it finishes fails instead and sets `docs:needs-input`.

The model gets a list of every tracked file under `docs/` except change entries. Markdown pages show their `summary` (and `audience: agent` when set). Other files, such as `portolan.yml`, are listed by path only. Generated specs under `docs/api/` are marked as read-only: the model can read them but never edit them.

The model edits existing pages in place. It creates a new page only when the change adds a new area with its own behaviour (a service, an API, a command group, a data format), no page's `covers` touches it, and the facts do not fit in one section of an existing page. A new page always gets a `summary` and `covers`. The model does not split, move or delete pages. When it edits a page that has no `covers`, it adds them.

A doc written back with its original content does not count as a write. In a repo with no `docs/` folder yet, `write_doc` creates it.

### Output limit

The model may write up to 32,000 tokens in one reply, and one doc file written with `write_doc` may be up to 80,000 characters. If a reply is cut at the output limit, Spriggs runs none of its tool calls. It asks the model once to write the file in a shorter form or split it into two files, and logs `reply cut at the output limit; asked for a shorter one`. If the next reply is cut too, the run fails and sets `docs:needs-input`.

### Context window

Once a single request to the model goes over `SPRIGGS_CONTEXT_TOKENS` input tokens (default 600,000, which suits a model with a 1M-token window), Spriggs clears the contents of tool results older than the last three tool turns from the history. The model can call the tool again if it needs that content. The console logs `context: cleared N older tool result(s)`. For a model with a 200K-token window, set `SPRIGGS_CONTEXT_TOKENS` to about 120000.

If a request is still larger than the model's context window, the provider rejects it; nothing is cut. The run fails and sets `docs:needs-input`, with a message that says the change does not fit the model's window. With Anthropic, a reply stopped because the context window filled up gets the same message. To fix it, use a model with a larger window, lower `SPRIGGS_CONTEXT_TOKENS` so older tool results are cleared sooner, or split the pull request.

## Layout

```
packages/spriggs/   the harness and the `portolan` CLI
docs/               this repo's own docs, per the /docs contract
.github/workflows/  ci.yml (checks), spriggs.yml (the harness on pull requests)
```

## Pull requests

Fill in the **Why** section of the pull request template. The gate reads it; a description of 20 words or more also counts as a reason. Without a reason, Spriggs still updates the docs from the diff of a change up to 1,500 lines, but marks the run `docs:partial` and asks for one. With no reason and a diff over 1,500 changed lines, Spriggs abstains: it writes nothing and sets `docs:needs-input`. Any change over the line limit (5,000 by default) is also stopped, reason or not. When you push new commits that change the intent, update the description too, or write the reason in the commit messages.
