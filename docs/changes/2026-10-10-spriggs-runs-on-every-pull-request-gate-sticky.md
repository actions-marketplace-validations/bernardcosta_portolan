---
title: "Spriggs runs on every pull request: gate, sticky comment, docs label and commit status"
kind: added
pr: 1
coverage: partial
reason: diff-too-large
docs:
  - docs/setup.md
  - docs/overview.md
---

Spriggs now runs through the spriggs.yml workflow on each pull request. It posts one sticky comment with the gate verdict and sets one docs:* label and a spriggs commit status. It also runs locally with --local, --reason and --model. Docker is gone, so install Bun 1.3.11 on the host and set a provider key. If only ANTHROPIC_API_KEY is set, the model defaults to anthropic/claude-opus-5-5.
