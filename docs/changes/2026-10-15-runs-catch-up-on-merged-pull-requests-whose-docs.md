---
title: Runs catch up on merged pull requests whose docs were unchecked
kind: added
pr: 27
coverage: full
docs:
  - docs/spriggs/pull-request-run.md
  - docs/spriggs/forges.md
  - docs/overview.md
  - docs/setup.md
---

Each run now lists up to 10 merged pull requests on the base branch still labelled `docs:needs-input` or `docs:partial`, gives the model their changed file paths, and marks them `docs:done` when the run is complete. A failed run now shows the raw error in a fenced code block. A reader must do nothing; if more than 10 pull requests are in debt, run the cold start.
