---
title: Clear older tool results on long runs, explain context-window errors, and retry cut replies
kind: fixed
pr: 4
coverage: full
docs:
  - docs/setup.md
---

Long runs no longer fail with a raw provider error. Once a request goes over SPRIGGS_CONTEXT_TOKENS input tokens (default 600,000), older tool results are cleared. A request that still doesn't fit fails with a plain message that says what to do. Replies may now be 32,000 tokens and doc files 80,000 characters, and a cut reply gets one retry. With a 200K-window model, set SPRIGGS_CONTEXT_TOKENS to about 120000.
