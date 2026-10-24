---
title: Managing employees (and what's automated)
audience: admin
route: /admin/employees
---

[Manage Employees](/admin/employees) sets each person's **role** (crew / supervisor / admin), title, employment type, account type (person vs. station kiosk), fuel #, phone, date of birth, and active flag. Search, filter by Full-Time/Part-Time, and use Edit or Deactivate per row.

**Most identity data is automated — don't hand-edit it:**

- **New employees appear automatically.** HR's master roster feeds a SharePoint list; the hourly roster sync creates portal accounts (first.last@wallercountyems.com, role crew), updates **employment type** from HR's Category, fills blank fuel #/DOB, and **deactivates** people who leave the roster. There is deliberately no Add button.
- **Shift and station come from the schedule's rotation seats** (trigger + nightly sync). Editing them here gets overwritten — change the rotation template in Schedule → Setup instead.
- **Microsoft 365 accounts** are provisioned/offboarded by the M365 lifecycle automation (licenses, groups, welcome kit, GAL contact info), and **job titles + office locations in the GAL sync daily** from the clinical pipeline and schedule. Hand-written GAL titles that don't match the managed patterns are left alone.

What *is* yours to edit here: role, title, account type, fuel #, phone, DOB, birthday visibility, and active (for exceptions — normal departures deactivate via the roster sync).

The email field must match the person's Microsoft sign-in email until their first login (that's how the account links); after that it's contact info only.
