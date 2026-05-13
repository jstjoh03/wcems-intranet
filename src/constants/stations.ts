/**
 * Closed list of station values exposed to users in self-edit selects
 * (user dropdown + profile modal). Centralized so renames flow to every
 * surface in one place — the previous duplicated arrays got out of sync
 * the first time we renamed FLOAT/PRN.
 *
 * The DB column is plain text so legacy/admin-only values can still
 * exist on rows (e.g. an admin types something custom via
 * /admin/employees); the self-edit pickers just won't offer them as
 * options.
 */
export const STATION_OPTIONS = [
  'S201',
  'S202',
  'Medic 206',
  'Medic 211',
  'Medic 221',
  'Medic 231',
  'Medic 242',
  'Medic 271',
  'Medic 281',
  'EMS Admin',
  'Part-Time',
] as const

export type StationOption = (typeof STATION_OPTIONS)[number]
