---
summary: Portolan keeps a repo's docs accurate on every pull request and publishes them to one hub for people and agents.
covers:
  - action.yml
  - .github/workflows/spriggs.yml
  - .github/workflows/spriggs-init.yml
  - packages/spriggs/src/cli.ts
  - packages/spriggs/src/init.ts
---

# Overview

Portolan is a doc harness. It has two parts.

**Spriggs** is a documentation agent that runs in CI on every pull request. It reads the diff, the pull request description and the commit messages. A gate decides whether there is enough information to write docs. When there is, Spriggs updates the `/docs` folder, writes a change entry and commits to the pull request branch. The reviewer sees the doc changes beside the code. When there is not, Spriggs says so on the pull request and does not guess. Each run posts one sticky comment, sets one `docs:*` label and a `spriggs` commit status.

For a repository with no docs yet, `spriggs init` is a one-time cold start: an agent explores the whole repository and writes a first set of docs, with a `docs/todo.md` listing any pages it planned but did not write. Run locally, it leaves the docs in the working tree. Run from the action, it opens a pull request with them.

**Portolan** is a self-hosted hub. It shows every project's docs, API playground and change feed at one address. People read it in a browser. Agents read it over MCP.

The repo is the source of truth. Each project keeps a `/docs` folder with a small fixed spine: `portolan.yml`, `overview.md`, `setup.md`, `changes/` and `api/`. Portolan only displays what is in git.

## Status

Early development. Spriggs is built first and runs on this repo's own pull requests. Portolan comes later.

## How to call it

In CI: Spriggs is a GitHub Action. Another repository adds a workflow step `uses: bernardcosta/portolan@main` with a provider key. With `command: init` in a hand-started (`workflow_dispatch`) workflow, the action runs the cold start and opens a pull request with the new docs. This repository's own `spriggs.yml` and `spriggs-init.yml` workflows use the action from their own checkout (`uses: ./`). Local run: `bun run spriggs run --local --base <ref>` (the `portolan spriggs run` CLI). Cold start: `bun run spriggs init` (`portolan spriggs init`). See [setup.md](setup.md).

## Owner

bernardcosta.
