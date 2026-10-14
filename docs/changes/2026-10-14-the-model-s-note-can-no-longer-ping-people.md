---
title: The model's note can no longer ping people or close issues, and paths with control characters are refused
kind: fixed
pr: 24
coverage: full
docs:
  - docs/spriggs/agent-harness.md
  - docs/spriggs/pull-request-run.md
---

In the cold start pull request and the sticky comment, the model's note now puts @mentions, issue references and links in code. GitHub then ignores them, so the note cannot notify people or close issues. Tool paths with any control character are now refused, and the cold start "check failed" line is printed as one line. The action docs now warn never to run it on pull_request_target. Nothing to do.
