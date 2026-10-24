---
title: Ask WCEMS assistant — admin view
audience: admin
route: /admin/assistant
---

[Assistant](/admin/assistant) is the visibility page for this assistant. Two tabs:

- **Questions** — month-to-date question count and estimated API spend, plus the recent exchange log: who asked what, when, the answer (expandable), and per-exchange token counts and cost. Every answered question is logged automatically.
- **Requests** — the feature-request inbox. When the assistant can't answer something, the asker can send it to the dev team (there's also a quiet "Suggest a feature" link in the panel); each request lands here with the verbatim question and any note. Triage with **Kind** (feature / docs gap / bug / other), **Status** (new / planned / done / declined), and an internal admin note — new ones are badged.

Operating notes: users are limited to 40 questions a day; answers come only from a curated knowledge base about the intranet (it refuses medical guidance, door codes, and HR topics by design). The knowledge base ships with the app — updating it is a developer task (see docs/assistant.md in the repo).
