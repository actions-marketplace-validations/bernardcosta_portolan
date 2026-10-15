---
title: The pull request agent can search docs for stale facts
kind: added
pr: 25
coverage: full
docs:
  - docs/spriggs/agent-harness.md
  - docs/spriggs/pull-request-run.md
---

On a pull request, Spriggs's docs agent now has the search tool. It searches docs/ in several wordings for pages that still state an old name, value, limit or behaviour, and fixes them even when the page's covers do not match the diff. Search now takes Perl-style patterns. A git without Perl regex support falls back to POSIX patterns, and the result says so. You don't need to do anything.
