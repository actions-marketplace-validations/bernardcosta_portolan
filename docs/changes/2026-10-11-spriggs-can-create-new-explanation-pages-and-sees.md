---
title: Spriggs can create new explanation pages and sees every file under docs/
kind: added
pr: 7
coverage: full
docs:
  - docs/setup.md
---

Spriggs used to put every change into an existing page. Now it may create a new page when a change adds a new area that no page covers and that doesn't fit in one section. New pages always get a summary and covers. Spriggs now also sees every file under docs/, including portolan.yml and generated specs under docs/api/ (which it can read but not edit). The pull request comment marks created files with "(new page)". You don't need to do anything.
