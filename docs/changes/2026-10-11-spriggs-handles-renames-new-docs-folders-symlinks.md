---
title: Spriggs handles renames, new docs folders, symlinks and cut replies correctly
kind: fixed
pr: 6
coverage: full
docs:
  - docs/setup.md
---

Spriggs got several fixes so that ordinary pull requests no longer fail or get the wrong label. This covers renamed files, non-English characters in paths, repos with no docs/ folder yet and runs that waited in the queue. It now skips pull requests opened from the default branch. A failed push fails the run with a report. The token budget counts only input not served from cache. A line that starts with `BREAKING CHANGE:` marks the change as breaking. Nobody needs to do anything.
