---
title: Clear older tool results on long runs and explain context-window errors plainly
kind: fixed
pr: 4
coverage: full
docs:
  - docs/setup.md
---

Long runs no longer let the history grow without limit. Once a request goes over `SPRIGGS_CONTEXT_TOKENS` input tokens (default 600,000), Spriggs clears older tool results. If a request still doesn't fit the model's context window, the run fails with a plain message instead of a raw provider error. If your model has a 200K window, set `SPRIGGS_CONTEXT_TOKENS` to about 120000.
