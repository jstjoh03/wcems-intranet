---
title: Ask WCEMS assistant — admin view
audience: admin
route: /admin/assistant
---

[Assistant](/admin/assistant) is the visibility page for this assistant. Two tabs:

- **Questions** — month-to-date question count and estimated API spend, plus the recent exchange log: who asked what, when, the answer (expandable), and per-exchange token counts and cost. Every answered question is logged automatically.
- **Requests** — the feature-request inbox. When the assistant can't answer something, the asker can send it to the dev team (there's also a quiet "Suggest a feature" link in the panel); each request lands here with the verbatim question and any note. Triage with **Kind** (feature / docs gap / bug / other), **Status** (new / planned / done / declined), and an internal admin note — new ones are badged.

Operating notes: users are limited to 40 questions a day. Answers come from a curated knowledge base about the intranet **plus live lookups** — schedule and who's on duty, leave balances, pending requests, outstanding training/policies, directory, hospitals, classes, announcements, and equipment status. Every lookup runs under the asker's own permissions, so the assistant can never show someone more than the app itself would, and it structurally cannot return door codes. It refuses medical guidance and HR topics by design. The knowledge base ships with the app — updating it is a developer task (see docs/assistant.md in the repo).
