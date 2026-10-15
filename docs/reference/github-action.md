---
summary: Reference for the Spriggs GitHub Action in action.yml. Its inputs, the steps it runs, how it picks run or survey, and how it keeps the repository under review from changing Bun's settings.
covers:
  - action.yml
  - scripts/bunfig.toml
  - scripts/open-survey-pr.sh
  - .github/workflows/spriggs.yml
---

# The GitHub Action

`action.yml` at the root of this repository is the action. Other repositories call it with `uses: bernardcosta/portolan@main`. This repository calls it from its own checkout with `uses: ./` in `.github/workflows/spriggs.yml`. For a ready-to-copy workflow and the GitHub App setup, see [setup.md](../setup.md#use-spriggs-in-another-repository).

It is a composite action. It needs the workflow permissions `contents: write`, `pull-requests: write` and `statuses: write`.

Run it on the `pull_request` event, never on `pull_request_target`. With `pull_request_target`, a pull request from a fork runs with the repository's secrets and a write token. With `uses: ./`, the action's own code would then come from the fork.

## Inputs

All inputs are optional. Each one becomes an environment variable for the step that runs Spriggs, except `app-id` and `app-private-key`, which mint a token instead.

| Input | Default | Becomes | Notes |
| --- | --- | --- | --- |
| `command` | empty | picks the command | Empty: `survey` on `workflow_dispatch`, `run` on anything else. `run` or `survey` forces one. Any other value stops the step with exit code 2. |
| `model` | empty | `SPRIGGS_MODEL` | `provider/model`. Empty picks `anthropic/claude-opus-5-5` when the Anthropic key is set. |
| `anthropic-api-key` | empty | `ANTHROPIC_API_KEY` | For `anthropic/` models. |
| `openai-api-key` | empty | `OPENAI_API_KEY` | For `openai/` models. |
| `openrouter-api-key` | empty | `OPENROUTER_API_KEY` | For `openrouter/` models. |
| `github-token` | the workflow's token | `GITHUB_TOKEN` | Used for the comment, label, status and push. Pushes made with the workflow's own token do not start other workflows. |
| `app-id` | empty | (mints a token) | With `app-private-key`, Spriggs acts as a GitHub App. |
| `app-private-key` | empty | (mints a token) | The App's private key (PEM). |
| `max-lines` | empty (5000) | `SPRIGGS_MAX_LINES` | Changed lines above which Spriggs asks to split the pull request. |

Other settings, such as `SPRIGGS_CONTEXT_TOKENS`, `SPRIGGS_BLOCKING` or `SPRIGGS_SURVEY_TOKENS`, go under `env:` on the step. See [configuration.md](configuration.md).

## Steps

1. **Check out** the pull request's head commit (not the merge commit), with full history so Spriggs can find the merge base. Credentials are not saved in the checkout. On `workflow_dispatch` there is no pull request, so the commit the workflow ran on is used.
2. **Install Bun** 1.3.11.
3. **Install Spriggs** in the action's own folder: `bun install --frozen-lockfile --production`.
4. **Mint an App token**, only when `app-id` is set and the event is not a pull request from a fork (forks get no secrets). It uses `actions/create-github-app-token@v2`. The token replaces `github-token`, and the App's slug goes to Spriggs as `SPRIGGS_APP_SLUG`.
5. **Run Spriggs.** The step picks the command, then runs `spriggs run` or `spriggs survey`. For `survey`, the output is also saved to a log file in the runner's temporary folder. Exit codes 0 and 3 let the job go on; any other code fails the step.
6. **Open the docs pull request**, only for `survey`. It runs `scripts/open-survey-pr.sh`. See [the survey](../spriggs/survey.md#in-ci).
7. **Report an early stop**, only when `survey` exited with 3. It prints an error that points to `docs/todo.md` and fails the job, after the pull request was opened.

## Bun settings from the repository are ignored

The working folder is the repository under review, and its files are not trusted. The step that runs Spriggs holds the provider keys. So Bun starts with:

- `--no-env-file`, so no `.env*` file in the repository is loaded. A `.env` could otherwise set a provider address.
- `--config=<action folder>/scripts/bunfig.toml`, an empty file shipped with the action. So Bun does not read the repository's `bunfig.toml`, which could preload code.

The comments in `action.yml` say to keep the exact form `--config=<absolute path>`. With `--config <path>`, `-c <path>` or an empty value, Bun reads the repository's `bunfig.toml` with no error.

A setting kept in a committed `.env` therefore never reaches Spriggs in CI. Put it under `env:` on the step instead. This protection does not hold with `uses: ./`, where the action's own files come from the pull request.
