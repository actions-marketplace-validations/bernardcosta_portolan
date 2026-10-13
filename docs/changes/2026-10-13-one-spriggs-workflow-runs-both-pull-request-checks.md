---
title: One Spriggs workflow runs both pull request checks and the cold start
kind: added
pr: 16
coverage: full
docs:
  - docs/setup.md
  - docs/overview.md
  - docs/spriggs/pull-request-run.md
---

The action's `command` input is now empty by default, and the event picks the command: a pull request runs `run`, and a start by hand (`workflow_dispatch`) runs `init`. The cold start now prints a report that becomes the body of the docs pull request. Pull request comments now point to the cold start when a repository has no docs.

What to do: add `workflow_dispatch:` under `on:` in your Spriggs workflow. You can then delete any separate init workflow.
