---
title: Running protocol exams (editors)
audience: admin
route: /clinical/exams
---

[Exams](/clinical/exams) (clinical editors) manages proctored protocol examinations: "Assign → release when the candidate is seated → auto-graded on submit."

1. Pick the exam, choose the candidate in **Assign to…**, and **Assign**. The candidate sees it on their My Progress page, locked.
2. When they're seated, hit **Release** under Open assignments — their page unlocks live and the clock starts when they begin.
3. Grading is automatic and server-side (answer keys never reach the browser). Results show score, pass/fail, any critical items missed (informational — they don't block a pass), and a **Completed exam** PDF with the candidate's answers (wrong ones marked, no answer key).

A pass auto-checks the candidate's protocol gate and files a completion certificate to their documents. The credentialing checklist surfaces alongside each assignment, and **Run a megacode** opens the digital megacode evaluation sheet (examiner script, scoring sections, dual signatures — a pass checks the megacode gate and files the signed PDF).

Exam content itself isn't edited in the UI — question sets are loaded through the controlled import, so changes go through the CDO.
