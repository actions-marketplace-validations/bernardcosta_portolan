---
title: Spriggs reads the whole change up to 5,000 lines and reports how many files it read
kind: added
pr: 3
coverage: full
docs:
  - docs/setup.md
---

Spriggs now sends the whole diff to the model for changes up to 5,000 lines, and gives changes over 1,500 lines a larger budget. It counts the changed files the model read. If any were left unread, it marks the run docs:partial and lists them in the comment. Changes above the limit are stopped with a request to split the pull request. Set SPRIGGS_MAX_LINES to change the limit. The read_file tool can now read a large file in parts.
