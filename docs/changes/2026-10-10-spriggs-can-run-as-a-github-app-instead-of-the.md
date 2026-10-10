---
title: Spriggs can run as a GitHub App instead of the workflow token
kind: added
pr: 5
coverage: full
docs:
  - docs/setup.md
---

Spriggs can now comment, set statuses and commit as your own GitHub App instead of github-actions[bot]. With the App, the `ci` checks run on Spriggs's docs commits too, because GitHub does not start workflows for pushes made with the workflow's own token. Nothing changes unless you set it up. To use it, register an App, then set SPRIGGS_APP_ID, SPRIGGS_APP_SLUG and the SPRIGGS_APP_PRIVATE_KEY secret, as described in setup.md.
