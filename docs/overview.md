---
summary: Portolan keeps a repo's docs accurate on every pull request and publishes them to one hub for people and agents.
---

# Overview

Portolan is a doc harness. It has two parts.

**Spriggs** is a documentation agent that runs in CI on every pull request. It reads the diff and the pull request description. A gate decides whether there is enough information to write docs. When there is, Spriggs updates the `/docs` folder, writes a change entry and commits to the pull request branch. The reviewer sees the doc changes beside the code. When there is not, Spriggs says so on the pull request and does not guess.

**Portolan** is a self-hosted hub. It shows every project's docs, API playground and change feed at one address. People read it in a browser. Agents read it over MCP.

The repo is the source of truth. Each project keeps a `/docs` folder with a small fixed spine: `portolan.yml`, `overview.md`, `setup.md`, `changes/` and `api/`. Portolan only displays what is in git.

## Status

Early development. Spriggs is built first and runs on this repo's own pull requests. Portolan comes later.

## How to call it

Local run: `bun run spriggs run --local --base <ref>`. In CI: the `spriggs.yml` workflow runs `portolan spriggs run` on each pull request. See [setup.md](setup.md).

## Owner

bernardcosta.
