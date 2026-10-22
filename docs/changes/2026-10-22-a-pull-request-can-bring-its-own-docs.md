---
title: A pull request can bring its own docs and change entry
kind: added
coverage: full
docs:
  - docs/reference/docs-contract.md
  - docs/spriggs/pull-request-run.md
---

A change entry may now leave out `pr`, so a person or a coding agent can write it before the pull request exists. When a pull request adds an entry after its last code commit, Spriggs runs no model and commits nothing; it only runs the free checks on the entry and the changed pages. A later code commit gets a full run that rewrites the same entry. Nothing to do to keep the old behaviour.
