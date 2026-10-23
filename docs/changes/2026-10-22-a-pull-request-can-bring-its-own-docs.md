---
title: A pull request can bring its own docs and change entry
kind: added
pr: 43
coverage: full
docs:
  - docs/reference/docs-contract.md
  - docs/setup.md
  - docs/spriggs/agent-harness.md
  - docs/spriggs/pull-request-run.md
  - docs/spriggs/survey.md
---

A change entry may now leave out `pr` for entries written before the pull request, and when the newest entry-adding commit has no code commit after it Spriggs runs no model: it checks the entry fields, the changed pages' frontmatter and their dead links, then reports. A later code commit gets a full run that adopts the same entry. Their docs now say so, and `docs/setup.md` lists `bun run test`, which CI now runs.
