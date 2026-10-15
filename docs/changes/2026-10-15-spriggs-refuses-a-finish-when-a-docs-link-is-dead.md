---
title: Spriggs refuses a finish when a docs link is dead
kind: added
pr: 28
coverage: full
docs:
  - docs/spriggs/agent-harness.md
  - docs/spriggs/pull-request-run.md
  - docs/spriggs/cold-start.md
  - docs/reference/docs-contract.md
---

Spriggs now runs code checks when the model calls finish and refuses the first finish with problems. The new check reports relative links in docs/ that point to no file or heading; both the pull request run and the cold start use it, and the unread-changed-files reminder moved to the same place. Nothing to do unless you move or rename pages.
