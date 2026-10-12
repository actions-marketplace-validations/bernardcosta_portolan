---
title: Run spriggs init from the GitHub Action and get the docs as a pull request
kind: added
pr: 12
coverage: full
docs:
  - docs/setup.md
  - docs/overview.md
---

The action has a new `command` input. `run`, the default, works as before. `init` runs the cold start, then commits `docs/` to a new `spriggs/init-<run id>` branch and opens a pull request against the branch the workflow ran on. To use it, add a `workflow_dispatch` workflow with `command: init`. If you use the workflow's own token, turn on "Allow GitHub Actions to create and approve pull requests". With a GitHub App you don't need that setting.
