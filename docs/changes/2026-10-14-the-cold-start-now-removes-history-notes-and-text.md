---
title: The cold start now removes history notes and text about code that no longer exists
kind: added
pr: 22
coverage: full
docs: []
---

`spriggs init` now removes history and migration notes from the docs, and text about files, commands, options or behaviour the code no longer has. Docs describe how things work now, and the change entries in `docs/changes/` keep the history. Each removal is named in the run's notes, so reviewers can check it in the cold start pull request. Pull request runs are unchanged.
