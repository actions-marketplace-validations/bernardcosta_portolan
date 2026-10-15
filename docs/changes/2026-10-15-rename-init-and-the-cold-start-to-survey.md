---
title: Rename init and the cold start to survey
kind: changed
breaking: true
pr: 29
coverage: full
docs:
  - docs/overview.md
  - docs/setup.md
  - docs/reference/configuration.md
  - docs/reference/docs-contract.md
  - docs/reference/github-action.md
  - docs/spriggs/agent-harness.md
  - docs/spriggs/cold-start.md
  - docs/spriggs/pull-request-run.md
---

The run that checks a whole repository's docs against the code is now `spriggs survey`, not `spriggs init`. The action's `command` input takes `survey`, `SPRIGGS_SURVEY_TOKENS` replaces `SPRIGGS_INIT_TOKENS`, the script is `scripts/open-survey-pr.sh`, and the report title and branch `spriggs/survey-<run id>` follow.

What to do: use `survey` and `SPRIGGS_SURVEY_TOKENS`. The old names no longer work.
