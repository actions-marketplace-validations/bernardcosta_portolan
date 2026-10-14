---
title: Agent log shows the model's text and each tool call
kind: added
pr: 21
coverage: full
docs: []
---

The agent log now shows the model's text for each turn, on one line and cut at 400 characters. It also shows one line per tool call with its main argument, such as the path, the search pattern, or the page and its line count. When a call is refused, the line ends with the reason. Each value is kept on one line so nothing can pass for a CI workflow command. You don't need to do anything.
