---
title: Managing required training
audience: admin
route: /admin/required-training
---

[Manage Required Training](/admin/required-training) creates and tracks compliance modules.

**New training:** title, description, the content source — YouTube, Cloudflare Stream, direct MP4, SharePoint, or **External course (link)** — approximate duration, a **Required by** date (blank = ongoing), the attestation statement (editable, with defaults), an optional **thumbnail** (shows on crew cards and the module page; max 5 MB), **"Also show in Training Library"** (cross-lists it with a Required tag), and Active.

**Audience** has two modes:

- **Everyone matching filters** — role, shift, and employment-type chips; an empty axis means "any", so no chips at all = the whole agency.
- **Scheduled on an event** — the audience is whoever is on a schedule event in a date window, kept current automatically; event crews get an assignment notice and a reminder ~2 days before their shift. (Filter-based modules have no automatic reminder — the dashboard banner does that work.)

**The roster** (per module): completion %, filters, a per-person **Required?** override (force-include or exclude anyone), **Mark complete** with a note ("Attended A-shift Teams session…"), **Export sign-off sheet (PDF)** with everyone's signature images, and **CSV**.

The anti-skip video player, attestation signature, and auto-downloaded certificates are built in — see the crew-facing required training article for the completion flow.
