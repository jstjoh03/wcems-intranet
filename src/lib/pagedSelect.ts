import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Supabase caps every select at 1,000 rows and silently truncates the
 * rest — which un-counted FTEP training days once sched_entries grew
 * past the cap (2026-11-16). Any query whose result can keep growing
 * goes through here: `build` is called per page and MUST apply a
 * stable order ending in a unique tiebreaker (e.g. `.order('id')`),
 * or page boundaries can skip/duplicate rows.
 */
export async function allRows<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  pageSize = 1000,
): Promise<{ rows: T[]; error: PostgrestError | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) return { rows, error }
    rows.push(...(data ?? []))
    if ((data ?? []).length < pageSize) break
  }
  return { rows, error: null }
}
