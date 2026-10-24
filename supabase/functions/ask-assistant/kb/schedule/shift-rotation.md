---
title: How the shift rotation works (and which shift works a date)
audience: all
route: /schedule
---

WCEMS runs a **48/96 rotation** with three platoons — A, B, and C Shift. Each shift works two consecutive 24-hour days (starting at **0600 Central**), then has four days off. Shift change is 0600, so "today's shift" before 6 a.m. is still yesterday's platoon.

**The pattern** repeats every 6 days: B, B, C, C, A, A — anchored at **Monday, April 6, 2026 = B Shift, Day 1**.

To work out which shift holds a given date:

1. Count the days from April 6, 2026 to the date (in Central time).
2. Take that count mod 6.
3. Map it: 0 → B (Day 1), 1 → B (Day 2), 2 → C (Day 1), 3 → C (Day 2), 4 → A (Day 1), 5 → A (Day 2).

Worked example: October 24, 2026 is 201 days after the anchor; 201 mod 6 = 3 → **C Shift, Day 2**.

Where to see it in the app:

- The dashboard hero says "X-Shift holds the county today" with the duty day.
- [Schedule](/schedule) → Day board header shows "X Shift on duty" with the actual roster — always trust the board over mental math, because trades, time off, and unit-specific patterns change who's really on.

Your own shift letter (in your profile and the directory) comes from your rotation seat automatically.
