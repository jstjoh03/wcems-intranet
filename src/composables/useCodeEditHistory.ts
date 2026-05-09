import { ref, watch } from 'vue'
import type { CodeChange, CodeEntityType, CodeField } from '@/types'

/**
 * Audit log for door-code edits — stations and hospitals share this
 * machinery. Crews can update a code in the field and the change is logged
 * with their identity, the previous value, and the new value so future
 * crews can see "Updated by X · 3 days ago" inline near the code.
 *
 * Phase 1: localStorage. Phase 2: swap to a Supabase
 * `code_change_log` table — the public surface stays identical.
 */

const STORAGE_KEY = 'wcems:code-changes'

function load(): CodeChange[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CodeChange[]) : []
  } catch {
    return []
  }
}

function persist(items: CodeChange[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

const all = ref<CodeChange[]>(load())

watch(all, persist, { deep: true })

export function useCodeEditHistory() {
  function record(opts: {
    entityType: CodeEntityType
    entityId: string
    codeField: CodeField
    oldValue: string
    newValue: string
    changedBy: string
  }): CodeChange {
    const change: CodeChange = {
      id: crypto.randomUUID(),
      entityType: opts.entityType,
      entityId: opts.entityId,
      codeField: opts.codeField,
      oldValue: opts.oldValue,
      newValue: opts.newValue,
      changedBy: opts.changedBy,
      changedAt: new Date().toISOString(),
    }
    all.value = [change, ...all.value]
    return change
  }

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

  return { all, record, historyFor, latestFor }
}
