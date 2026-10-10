---
title: Clear older tool results on long runs, explain context-window errors, and retry cut replies
kind: fixed
pr: 4
coverage: full
docs:
  - docs/setup.md
---

Long runs no longer fail with a raw provider error or let the history grow without limit. Once a request goes over SPRIGGS_CONTEXT_TOKENS input tokens (default 600,000), older tool results are cleared, and a request that still doesn't fit fails with a plain message. Replies may now be 32,000 tokens long, doc files up to 80,000 characters, and a cut reply gets one retry. If your model has a 200K window, set SPRIGGS_CONTEXT_TOKENS to about 120000.
