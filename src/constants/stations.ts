/**
 * "Extras" — assignment options that don't live in the `stations`
 * table. The Medic units (Medic 206, 211, 221, etc.) are admin-
 * editable on /admin/stations and surface via the `useStationOptions`
 * composable; this file keeps the buildings and admin tags.
 *
 * If an admin adds a new Medic unit on /admin/stations it appears in
 * the self-edit dropdown automatically — no code change needed.
 *
 * The DB column is plain text so legacy/admin-only values can still
 * exist on rows (an admin can type something custom via
 * /admin/employees); the self-edit pickers just won't offer them.
 */

/** Render above the live medic units (physical station buildings). */
export const STATION_EXTRAS_TOP = ['S201', 'S202'] as const

/** Render after the live medic units (non-mobile assignments). */
export const STATION_EXTRAS_BOTTOM = ['EMS Admin'] as const

export type StationExtra =
  | (typeof STATION_EXTRAS_TOP)[number]
  | (typeof STATION_EXTRAS_BOTTOM)[number]
