import { ref } from 'vue'
import type { CodeChange, CodeEntityType, CodeField } from '@/types'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Cross-device audit log for door-code edits, sourced from the
 * `code_edit_history` table. The DB triggers on `stations` and
 * `hospitals` write rows automatically when a code changes — clients
 * never call a `record()` function. The Phase 1 localStorage layer is
 * gone; the legacy key is removed on init.
 *
 * The module-level `all` ref is a shared singleton across components.
 * It loads once on first import and is currently not refreshed
 * automatically after a code edit — `lastChanged()` callers fall back to
 * the row's own `*_updated_at`/`*_updated_by` stamp, which is fresh
 * after every update. A future improvement is realtime subscription;
 * not needed for the first ship.
 */

interface CodeEditHistoryRow {
  id: string
  entity_type: CodeEntityType
  entity_id: string
  code_field: CodeField
  old_value: string
  new_value: string
  changed_by: string
  changed_at: string
}

function rowToCodeChange(r: CodeEditHistoryRow): CodeChange {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    codeField: r.code_field,
    oldValue: r.old_value,
    newValue: r.new_value,
    changedBy: r.changed_by,
    changedAt: r.changed_at,
  }
}

const all = ref<CodeChange[]>([])
const ready = ref(false)
let loadStarted = false

async function load() {
  if (loadStarted) return
  loadStarted = true
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('wcems:code-changes')
  }
  const auth = useAuthStore()
  if (auth.usingDevStub || !auth.appUser) {
    all.value = []
    ready.value = true
    return
  }
  const { data, error } = await supabase
    .from('code_edit_history')
    .select('id, entity_type, entity_id, code_field, old_value, new_value, changed_by, changed_at')
    .order('changed_at', { ascending: false })
    .limit(500)
  if (error) {
    console.error('[code-history] failed to load:', error.message)
    ready.value = true
    return
  }
  all.value = (data ?? []).map((d) => rowToCodeChange(d as CodeEditHistoryRow))
  ready.value = true
  subscribeRealtime()
}

/**
 * Live INSERT events from `code_edit_history`. The table is append-only
 * (triggers on stations / hospitals write rows when a code changes; no
 * UPDATE or DELETE path exists), so we only handle INSERT and prepend
 * to the local cache since the list is sorted by `changed_at DESC`.
 *
 * Echoes of our own edit aren't a problem: the trigger writes one row
 * per code change with a fresh UUID, so dedupe on id and the second
 * arrival (if any) is a no-op.
 */
function subscribeRealtime() {
  supabase
    .channel('code_edit_history')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'code_edit_history' },
      (payload) => {
        const row = rowToCodeChange(payload.new as CodeEditHistoryRow)
        if (all.value.some((c) => c.id === row.id)) return
        all.value = [row, ...all.value]
      },
    )
    .subscribe()
}

export function useCodeEditHistory() {
  void load()

  function historyFor(entityType: CodeEntityType, entityId: string): CodeChange[] {
    return all.value.filter(
      (c) => c.entityType === entityType && c.entityId === entityId,
    )
  }

  function latestFor(
    entityType: CodeEntityType,
    entityId: string,
    codeField: CodeField,
  ): CodeChange | null {
    return (
      all.value.find(
        (c) =>
          c.entityType === entityType &&
          c.entityId === entityId &&
          c.codeField === codeField,
      ) ?? null
    )
  }

  return { all, ready, historyFor, latestFor }
}
