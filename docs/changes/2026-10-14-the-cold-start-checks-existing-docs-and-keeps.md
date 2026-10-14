---
title: The cold start checks existing docs and keeps a todo between runs
kind: added
pr: 19
coverage: full
docs:
  - docs/overview.md
  - docs/setup.md
  - docs/spriggs/cold-start.md
  - docs/spriggs/agent-harness.md
---

`spriggs init` can now be run again on a repository that already has docs. It checks the docs against the code, fills the gaps, and may replace repeated text with a link or move a section to a better page. `docs/todo.md` now has a "To write" and a "To check" list. The next run starts with it, and Spriggs only deletes a todo the model wrote. The pull request title is now "docs: Spriggs catches the docs up with the code".
