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

Spriggs now runs through the spriggs.yml workflow on each pull request. It posts one sticky comment with the gate result, sets one docs:* label and a spriggs commit status, and updates docs/ when the gate allows. Docker is gone. Install Bun 1.3.11 on the host and set a provider key. If only ANTHROPIC_API_KEY is set, the model defaults to anthropic/claude-opus-5-5. Local runs use --local, --base, --reason and --model.
