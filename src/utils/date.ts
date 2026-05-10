/**
 * Date-only formatting helpers.
 *
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, which shifts back a
 * full day in any negative-UTC-offset timezone (Central Time included).
 * Constructing the Date with explicit y/m/d values gives a local-time
 * Date that displays correctly via toLocaleDateString.
 */

/** Parse a 'YYYY-MM-DD' string into a local-time Date, or null if input
 *  is missing/malformed. */
export function parseDateOnly(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const parts = iso.split('-')
  if (parts.length < 3) return null
  const [y, m, d] = parts.map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/** Format a 'YYYY-MM-DD' as a short month/day, e.g. 'Apr 3'. */
export function formatShortDate(iso: string | null | undefined): string {
  const d = parseDateOnly(iso)
  if (!d) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Format a 'YYYY-MM-DD' as 'Apr 3, 1991' style. */
export function formatLongDate(iso: string | null | undefined): string {
  const d = parseDateOnly(iso)
  if (!d) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
