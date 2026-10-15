---
title: Spriggs can move and delete doc pages
kind: added
pr: 30
coverage: full
docs:
  - docs/spriggs/agent-harness.md
  - docs/reference/docs-contract.md
  - docs/spriggs/pull-request-run.md
  - docs/spriggs/cold-start.md
---

The model now has two more tools: move_doc renames or moves one page under docs/, and delete_doc removes a page whose subject is gone. Both obey the same path rules as write_doc, never touch the required pages, and are undone if the run fails. Reports mark deleted pages, and the pull request comment no longer lists them. Nothing you must do.
