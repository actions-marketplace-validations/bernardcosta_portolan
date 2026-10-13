---
title: The action no longer reads .env or bunfig.toml files from the repository it checks
kind: fixed
pr: 17
coverage: full
docs:
  - docs/setup.md
---

In CI, the action now starts Bun so that it ignores any `.env*` file and any `bunfig.toml` in the repository under review. Those files are not trusted, and the step holds the provider key and the token. If a setting sits in a committed `.env` in your repository, it no longer reaches Spriggs in CI. Move it under `env:` on the workflow step. Local runs still load your own `.env`.
