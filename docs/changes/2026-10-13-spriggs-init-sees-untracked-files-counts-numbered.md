---
title: spriggs init sees untracked files, counts numbered todos and exits with code 3 on an early stop
kind: fixed
pr: 15
coverage: full
docs:
  - docs/setup.md
  - docs/spriggs/agent-harness.md
---

`spriggs init` now lists and searches untracked files that git does not ignore, so it works on a repository with no commits. A numbered todo is no longer deleted as empty. When the run stops before it finishes, `init` exits with code 3. The action still opens the docs pull request, with the reason in its body, and then fails the job. If a script checks the exit code of `init`, treat 3 as a partial result.
