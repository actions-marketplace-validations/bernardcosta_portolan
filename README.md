# Portolan

**Docs that keep up with the code.** Spriggs is a GitHub Action that reads every pull request, updates your repository's `docs/` folder to match, and commits the change to the same branch. Reviewers see the doc changes beside the code, before the merge.

Portolan, the hub that publishes those docs for people and agents, comes later. This repository holds both.

## What Spriggs does

- **On every pull request.** It reads the diff, the pull request description and the commit messages. A gate checks that the change has a reason. Spriggs then edits `docs/`, writes a short change entry under `docs/changes/` and pushes one commit to the branch.
- **When it cannot tell why a change was made, it asks instead of guessing.** It writes nothing and asks for a reason in the description.
- **One clear signal per pull request.** Each run posts one sticky comment, sets one label and one `spriggs` commit status.
- **A full survey on demand.** Start the workflow by hand and Spriggs explores the whole repository. It checks the existing docs against the code, fills the gaps, and opens a pull request with the result. Use it on a repository with no docs, or when the docs have fallen behind.

| Label | Meaning |
| --- | --- |
| `docs:done` | The docs match the change. |
| `docs:partial` | Docs were updated, but a reason was missing or some files were not read. The comment says which. |
| `docs:none` | The change needs no doc update. |
| `docs:needs-input` | Spriggs wrote nothing. Add a reason to the description, or split a very large pull request. |

## Quick start

**1. Add a model key** as a repository secret, for example `ANTHROPIC_API_KEY`.

**2. Add the workflow** as `.github/workflows/spriggs.yml`:

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
      - uses: bernardcosta/portolan@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

You need no checkout step, because the action checks out the pull request itself. Use `pull_request`, never `pull_request_target`.

**3. Run a survey (optional, recommended).** Open **Actions → spriggs → Run workflow**. Spriggs writes a first full set of docs and opens a pull request for you to review.

**4. Say why in each pull request.** Spriggs reads the description. A **Why** section, or any description of 20 words or more, is enough. This repository's [pull request template](.github/pull_request_template.md) is a good start.

## Models

Choose any supported provider with the `model` input, as `provider/model`. Spriggs uses each provider's standard key name.

| Provider | `model` | Input |
| --- | --- | --- |
| Anthropic | `anthropic/<model>` | `anthropic-api-key` |
| OpenAI | `openai/<model>` | `openai-api-key` |
| OpenRouter | `openrouter/<vendor>/<model>` | `openrouter-api-key` |

With only an Anthropic key set, the default is `anthropic/claude-opus-5-5`. For example, a Gemini model through OpenRouter:

```yaml
      - uses: bernardcosta/portolan@v1
        with:
          model: openrouter/google/gemini-2.5-pro
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

You pay your provider directly. Spriggs reads as much of a change as it needs to get the docs right, so a capable model gives better docs. A cheaper model costs less.

## Safety

- The model has a small fixed set of tools and nothing else. It can list, search and read files, read the diff, and write, move or delete doc pages. It has no shell, no network access, and it never sees your GitHub token.
- Spriggs writes only under `docs/`. The doc tools refuse any other path, and a check after the run reverts any other change.
- It never commits to the default branch, and it skips its own commits and pull requests that change only `docs/`.
- On any failure it commits nothing.
- The pull request text and the diff go to the model as untrusted data, not as instructions.
- The action does not load a `.env` or `bunfig.toml` from your repository, so the code under review cannot change how Spriggs runs.

## Run as your own bot (optional)

With the default token, Spriggs commits as `github-actions[bot]`, and GitHub does not start other workflows on those commits. So your CI does not check the docs commit. A GitHub App that you register yourself fixes this. Pass `app-id` and `app-private-key` to the action. The steps are in [docs/setup.md](docs/setup.md#run-as-a-github-app-optional).

## The docs layout

Spriggs keeps a small fixed spine in `docs/`. Everything else is up to you.

```
docs/
  portolan.yml   project metadata (only `name` is required)
  overview.md    what the project is, about 300 words
  setup.md       how to get it running
  changes/       one entry per pull request, written by Spriggs
  api/           generated API specs, never edited by hand
```

Every page starts with a short frontmatter block that has a one-line `summary`. The full rules are in [the docs contract](docs/reference/docs-contract.md). You do not need a `docs/` folder to start. Spriggs creates the required pages on the first pull request that needs them.

## Configuration

| Input | Default | Does |
| --- | --- | --- |
| `command` | empty | Empty: the event decides (`run` on a pull request, `survey` on a manual start). Set `run` or `survey` to force one. |
| `model` | see [Models](#models) | `provider/model`. |
| `anthropic-api-key`, `openai-api-key`, `openrouter-api-key` | empty | The key for the chosen provider. |
| `github-token` | the workflow token | Token for the comment, label, status and push. |
| `app-id`, `app-private-key` | empty | Run as your own GitHub App. |
| `max-lines` | 5000 | Above this many changed lines, Spriggs asks you to split the pull request. |

Other settings go under `env:` on the step. All of them are in [docs/reference/configuration.md](docs/reference/configuration.md).

## Try it locally

You need [Bun](https://bun.sh) 1.3.11 and Git.

```sh
git clone https://github.com/bernardcosta/portolan.git
cd portolan && bun install
export ANTHROPIC_API_KEY=...   # or another provider's key and SPRIGGS_MODEL

cd /path/to/your/repo
bun /path/to/portolan/packages/spriggs/src/cli.ts run --local --base main --reason "Why this change was made"
bun /path/to/portolan/packages/spriggs/src/cli.ts survey
```

A local run uses your working copy, posts nothing and commits nothing. The doc edits stay in the working tree for you to review.

## Learn more

- [Overview](docs/overview.md): the whole product, Spriggs and Portolan.
- [A pull request run](docs/spriggs/pull-request-run.md): each step, the gate rules, the labels and statuses.
- [The survey](docs/spriggs/cold-start.md): how the full check works and what its pull request contains.
- [The GitHub Action](docs/reference/github-action.md): inputs, steps and the security notes.
- [The agent harness](docs/spriggs/agent-harness.md): the model loop, tools, budgets and providers.

## Status

Spriggs is at `v1` and runs on this repository's own pull requests. Portolan, the hub, is not built yet.

## Development

```sh
bun install
bun run check       # lint and format (Biome)
bun run typecheck   # tsc
```

The full setup is in [docs/setup.md](docs/setup.md).

## License

[Apache-2.0](LICENSE)
