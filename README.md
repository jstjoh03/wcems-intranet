# WCEMS Intranet

Employee portal for **Waller County EMS** — Vue 3 + Vite PWA replacing an unloved SharePoint site.

> Phase 1 build (Supabase regional outage): frontend skeleton wired to mock JSON.
> Phase 2 swaps mocks for live Supabase + MSAL/Entra auth.

## Stack

- **Vue 3** with `<script setup lang="ts">` SFCs and the Composition API
- **Vite 8** for build tooling, **TypeScript 6**
- **Vue Router 4** for the SPA shell, **Pinia 3** for state (auth + user prefs)
- **Tailwind CSS v4** with `@theme` directive (no config file — design tokens live in `src/assets/main.css`)
- **Lucide Vue Next** for icons
- **MSAL.js** (`@azure/msal-browser`) for Microsoft Entra ID SSO (single-tenant, WCEMS only)
- **Supabase** for Postgres + storage (deferred — currently mock JSON)
- **vite-plugin-pwa** for installable PWA + service worker
- **Cloudflare Pages** for hosting (`employee.wallercountyems.com`)

## Routes

| Path | View | Purpose |
| --- | --- | --- |
| `/` | `DashboardView` | Hero greeting, on-call strip, quick links, station directory, sidebar (newsletter / training / announcements / call volume tile), photos, people |
| `/hospitals` | `HospitalsView` | 23-hospital directory with filter chips (trauma I–IV, stroke, PCI, pediatric, maternal), inline-editable codes, change history |
| `/insights` | `InsightsView` | Full call-volume dashboard — metric cards + trend / by-unit / by-zone tabs |
| `/admin-staff` | `AdminStaffView` | Direct contact info for WCEMS admin staff |

## Design system

Brand navy `oklch(0.35 0.14 250)` (`--color-brand-600`), accent gold `oklch(0.734 0.114 86.8)` (`--color-accent-500`). Trauma-level palette in `--color-trauma-{1..4}`.

Typography:
- **Display** — `Instrument Serif` (greetings, names, card titles, station numbers, italic-navy first name)
- **Sans** — `Geist` (body, UI, eyebrows, navigation)
- **Mono** — `Geist Mono` (codes, phone numbers, dates, identifiers — tabular numerics)

All tokens live in `@theme` inside `src/assets/main.css`.

## Composables

| Composable | Purpose |
| --- | --- |
| `useShift` | Real WCEMS rotation — anchor `2026-04-06`, B → C → A every 48h, in `America/Chicago` |
| `useGreeting` | Greeting + today's date, also exposes today's holiday from `holidays-2026.json` |
| `useCodeReveal` | 20-second auto-hide reveal for door codes & Fuel #, with progress bar (uses single `setTimeout` + `requestAnimationFrame` — no per-tick re-renders) |
| `useUserLinkPreferences` | Quick-link pin/hide/sort. localStorage-backed dev stub; swaps to Supabase `user_link_preferences` in Phase 2 |
| `useCodeEditHistory` | Audit log for door-code changes (stations + hospitals). Same swap pattern |

## Mock data

`src/data/*.json` — hardcoded for Phase 1, sourced from the project's `xlsx` files:

- `stations.json` — all 7 medics (206, 211, 221, 231, 242, 271, 281)
- `hospitals.json` — 23 hospitals with trauma/stroke/PCI/maternal/NICU designations
- `quicklinks.json` — 16 links across 6 categories
- `admin-staff.json` — 9 admin contacts
- `on-call.json` — Sup 201, Sup 202 shift cells
- `holidays-2026.json` — Waller County 2026 holiday schedule
- `call-volume.json` — Jan/Feb/Mar 2026 summaries, per-unit, per-zone
- `announcements.json`, `training.json`, `people.json`, `photos.json` — currently empty / placeholder

## Decisions locked

See `memory/project_wcems_decisions.md` (private). Highlights:

- Single-tenant Entra app reg, separate from supply portal (multi-tenant)
- `employee.wallercountyems.com` subdomain on Cloudflare DNS
- Birthday default: opt-**in** (with opt-out toggle)
- Quick Links pinning: DB-backed in Phase 2 (localStorage dev stub now)
- Door codes: tap-to-reveal + 20s auto-hide, inline-editable by any user, every change logged
- Call Volume visible to **all crews** (not gated)
- Initial admin: Justin only; admins can promote others post-launch

## Scripts

```bash
npm run dev       # Vite dev server (default: http://localhost:5173)
npm run build     # Production build → dist/
npm run preview   # Preview the production build locally
```

## Next steps (Phase 2, when Supabase is restored)

1. Initialize Supabase project + RLS policies (schema in handoff doc)
2. Wire MSAL in `src/stores/auth.ts` against the WCEMS Entra app reg
3. Swap `data/*.json` imports for Supabase queries
4. Swap `useUserLinkPreferences` and `useCodeEditHistory` bodies to Supabase mutations
5. Configure Cloudflare Pages deploy + `employee.wallercountyems.com` DNS
6. Migrate hospital + station data into Supabase via seed scripts
