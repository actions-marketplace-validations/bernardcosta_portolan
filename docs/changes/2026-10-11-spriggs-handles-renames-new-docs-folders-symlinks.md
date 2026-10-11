---
title: Spriggs handles renames, new docs folders, symlinks and cut replies correctly
kind: fixed
breaking: true
pr: 6
coverage: full
docs:
  - docs/setup.md
---

Several fixes so ordinary pull requests no longer fail or get the wrong label. Examples: renamed files, non-English characters in paths, a repo with no docs/ folder yet, and runs that waited in the queue. Spriggs now skips pull requests opened from the default branch. A `BREAKING CHANGE:` footer in a commit body now marks the change as breaking. A failed push fails the run with a report, and the token budget counts only input not served from cache. Nobody needs to do anything.
