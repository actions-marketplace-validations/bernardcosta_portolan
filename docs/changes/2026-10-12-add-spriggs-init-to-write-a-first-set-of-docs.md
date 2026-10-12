---
title: Add spriggs init to write a first set of docs for a whole repository
kind: added
pr: 11
coverage: full
docs:
  - docs/setup.md
  - docs/overview.md
---

New command `bun run spriggs init [--model]`. It explores a repository and writes a first set of docs in the working tree. Pages it planned but did not write are listed in docs/todo.md. Nothing is committed: review the docs, commit them and open a pull request. `SPRIGGS_INIT_TOKENS` caps its token use (default 2,000,000). Pull request runs work as before, except that write_doc now refuses paths more than two folders deep under docs/.
