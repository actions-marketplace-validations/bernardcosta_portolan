---
title: The check pass now runs on every pull request, with SPRIGGS_EFFORT and edit_doc
kind: added
pr: 40
coverage: full
docs:
  - docs/spriggs/agent-harness.md
  - docs/spriggs/survey.md
  - docs/reference/configuration.md
  - docs/spriggs/pull-request-run.md
---

A pull request run now checks its pages after writing them: fresh agents read the pages the run wrote, and the pages whose covers match the change, against the code and correct wrong claims. New settings: SPRIGGS_EFFORT=low skips the check pass and halves the survey budget, and SPRIGGS_CHECK_TOKENS bounds the pass. Checkers use the new edit_doc tool. Nothing to do to keep the defaults.
