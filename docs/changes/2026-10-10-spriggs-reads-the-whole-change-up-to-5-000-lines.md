---
title: Spriggs reads the whole change up to 5,000 lines and reports what it read
kind: added
pr: 3
coverage: full
docs:
  - docs/setup.md
---

Spriggs used to read only part of a change above 1,500 lines. Now it sends the whole diff to the model for changes up to 5,000 lines, and gives changes over 1,500 lines a larger budget. It reports how many changed files it read, and marks the run docs:partial if some were never read. Changes above the limit are stopped, with a request to split the pull request. You can change the limit with SPRIGGS_MAX_LINES.
