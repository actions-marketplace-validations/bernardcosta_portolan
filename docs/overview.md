---
summary: Portolan keeps a repo's docs accurate on every pull request and publishes them to one hub for people and agents.
covers:
  - action.yml
  - .github/workflows/spriggs.yml
  - packages/spriggs/src/cli.ts
  - packages/spriggs/src/survey.ts
---

# Overview

Portolan is a doc harness. It has two parts.

**Spriggs** is a documentation agent that runs in CI on every pull request. It reads the diff, the pull request description and the commit messages. A gate decides whether there is enough information to write docs. When there is, Spriggs updates the `/docs` folder, writes a change entry and commits to the pull request branch. The reviewer sees the doc changes beside the code. When there is not, Spriggs says so on the pull request and does not guess. Each run posts one sticky comment, sets one `docs:*` label and a `spriggs` commit status. A run also catches up on merged pull requests whose docs were left unchecked, because it only ever reads its own diff.

`spriggs survey` is the full check of the doc set: an agent explores the whole repository, checks its docs against the code and fills the gaps. Run it on a repository with no docs yet, and again whenever the docs may have fallen behind the code. It may also clean up repeated text, history and migration notes, and text about code that no longer exists. It leaves a `docs/todo.md` listing what it did not write or check, and the next run starts with that list. Run locally, it leaves the docs in the working tree. Run from the action, it opens a pull request with them, and the pull request body is a report of the run.

**Portolan** is a self-hosted hub. It shows every project's docs, API playground and change feed at one address. People read it in a browser. Agents read it over MCP.

The repo is the source of truth. Each project keeps a `/docs` folder with a small fixed spine: `portolan.yml`, `overview.md`, `setup.md`, `changes/` and `api/`. Portolan only displays what is in git.

## Status

Early development. Spriggs is built first and runs on this repo's own pull requests. Portolan comes later.

## How to call it

In CI: Spriggs is a GitHub Action. Another repository adds one workflow with a step `uses: bernardcosta/portolan@main` and a provider key. The event picks the command: a pull request runs the normal check, and a start by hand (`workflow_dispatch`) runs the survey and opens a pull request with the new docs. The action's `command` input forces one or the other. This repository's own `spriggs.yml` workflow uses the action from its own checkout (`uses: ./`). Local run: `bun run spriggs run --local --base <ref>` (the `portolan spriggs run` CLI). Survey: `bun run spriggs survey` (`portolan spriggs survey`). See [setup.md](setup.md).

## Read next

- [The docs contract](reference/docs-contract.md): the `docs/` layout, frontmatter, `portolan.yml` and change entries.
- [A pull request run](spriggs/pull-request-run.md): each step of a run, the gate rules, and the labels and statuses.
- [The survey](spriggs/cold-start.md): each step of `spriggs survey`, its report and exit codes, and the pull request the action opens.
- [The GitHub Action](reference/github-action.md): the action's inputs and steps, and why it ignores Bun settings from the repository under review.
- [Configuration](reference/configuration.md): every flag and environment variable, with defaults.
- [The agent harness](spriggs/agent-harness.md): the model loop, tools, budgets and providers.
- [Forges](spriggs/forges.md): how Spriggs talks to GitHub, or to your working copy in `--local` mode.

## Owner

bernardcosta.
