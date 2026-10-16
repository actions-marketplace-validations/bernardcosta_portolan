---
title: Clear older tool results only when a request does not fit
kind: fixed
pr: 38
coverage: full
docs:
  - docs/spriggs/agent-harness.md
  - docs/reference/configuration.md
---

Spriggs no longer clears older tool results at a fixed token count. It clears them only when the provider says a request does not fit the model's context window, then sends it again; if that does not help, the run fails as before. This suits any model window and breaks the prompt cache only when it must. `SPRIGGS_CONTEXT_TOKENS` is removed, and a value still set is ignored. A billed overflow now counts toward the budget and the cost. Nothing to do beyond dropping the old setting.
