---
title: Spriggs ships as a GitHub Action other repositories can use
kind: added
pr: 9
coverage: full
docs:
  - docs/setup.md
  - docs/overview.md
---

Spriggs is now a GitHub Action (action.yml at the repository root). Another repository runs it by adding one workflow step, `uses: bernardcosta/portolan@main`, plus a provider key. This repository's own workflow uses the action too. Local runs now also work in a repository with no `origin` remote. To use the action, copy the workflow from setup.md and add your provider key as a secret.
