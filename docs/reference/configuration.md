---
summary: Every command-line flag and environment variable Spriggs reads, with its default, in one place.
covers:
  - packages/spriggs/src/cli.ts
  - packages/spriggs/src/agent/model.ts
  - packages/spriggs/src/agent/agents.ts
  - packages/spriggs/src/agent/loop.ts
  - packages/spriggs/src/gate/decide.ts
  - packages/spriggs/src/run.ts
  - packages/spriggs/src/forge/github.ts
  - .env.example
---

# Configuration

Spriggs reads its settings from command-line flags and environment variables. It does not read a config file of its own. Locally, `bun run spriggs` loads your `.env` (copy it from `.env.example`). In CI, the action passes its inputs as environment variables and ignores any `.env` in the repository (see [the action reference](github-action.md#bun-settings-from-the-repository-are-ignored)). Project metadata, such as the issue pattern, lives in `docs/portolan.yml` (see [the docs contract](docs-contract.md#portolanyml)).

## Commands and flags

```
portolan spriggs run [--local --base <ref> [--reason <text>]] [--model <provider/model>]
portolan spriggs survey [--model <provider/model>]
```

From the repository root, `bun run spriggs ...` runs the same CLI (`packages/spriggs/src/cli.ts`). The leading word `spriggs` is optional.

| Flag | Command | Does |
| --- | --- | --- |
| `--local` | `run` | Use the working copy instead of GitHub. Needs `--base`; without it the CLI exits with code 2. |
| `--base <ref>` | `run` | The ref to compare the working copy against (through the merge base). |
| `--reason <text>` | `run --local` | Stands in for the pull request description's **Why** section. |
| `--model <provider/model>` | both | Overrides `SPRIGGS_MODEL`. |

An unknown command prints the usage and exits with code 2. An unexpected error prints `spriggs: <message>` and exits with code 1.

## Environment variables

| Variable | Default | Read by | Does |
| --- | --- | --- | --- |
| `SPRIGGS_MODEL` | `anthropic/claude-opus-5-5` when `ANTHROPIC_API_KEY` is set, else none | `agent/model.ts` | The model as `provider/model`. Providers: `anthropic`, `openai`, `openrouter`. |
| `ANTHROPIC_API_KEY` | none | `agent/model.ts` | Key for `anthropic/` models. |
| `OPENAI_API_KEY` | none | `agent/model.ts` | Key for `openai/` models. |
| `OPENROUTER_API_KEY` | none | `agent/model.ts` | Key for `openrouter/<vendor>/<model>` models, sent to OpenRouter's OpenAI-style endpoint. |
| `SPRIGGS_MAX_LINES` | 5000 | `gate/decide.ts` | Changed lines above which a pull request run writes nothing and asks to split the change. |
| `SPRIGGS_BLOCKING` | not set | `run.ts` | When `true`, a gate stop sets the `spriggs` status to `failure`. Breaking changes do that anyway. |
| `SPRIGGS_SURVEY_TOKENS` | 2000000 | `agent/agents.ts` | Token cap of the `survey` agent. |
| `GITHUB_TOKEN` | none | `forge/github.ts` | Required for `run` without `--local`. Used for the comment, label, status and push. |
| `GITHUB_EVENT_PATH` | set by GitHub Actions | `forge/github.ts` | Required for `run` without `--local`. Must point to a `pull_request` event. |
| `SPRIGGS_APP_SLUG` | not set | `forge/github.ts` | Set by the action when it runs as a GitHub App. Spriggs then commits and comments as `<slug>[bot]`. |

For the number settings, a value that is empty, zero or not a number falls back to the default.

## How the model is picked

1. The `--model` flag, if given.
2. Else `SPRIGGS_MODEL`.
3. Else `anthropic/claude-opus-5-5`, if `ANTHROPIC_API_KEY` is set.

The run then fails before any network call when no model is set, when the value has no `/`, when the provider is not one of the three, or when that provider's key is missing. The error names the missing variable.
