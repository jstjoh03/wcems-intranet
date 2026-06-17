import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import seedJson from '@/data/admin-staff.json'
import type { AdminStaff } from '@/types'

/**
 * Admin Staff directory — backing data for /admin-staff (crew view)
 * and /admin/admin-staff (admin CRUD).
 *
 * Module-singleton ref pattern (matches stations / hospitals /
 * quick_links). One load on first use, realtime keeps it fresh so
 * edits from the admin page show up on every other tab within
 * seconds.
 *
 * Dev-stub falls back to the legacy admin-staff.json so dev iteration
 * keeps working without a real Supabase session.
 */

interface StaffRow {
  id: string
  title: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  sort_order: number
  active: boolean
}

function rowToStaff(r: StaffRow): AdminStaff {
  return {
    id: r.id,
    title: r.title,
    name: r.name,
    email: r.email,
    phone: r.phone,
    notes: r.notes,
    sortOrder: r.sort_order,
    active: r.active,
  }
}

const COLUMNS =
  'id, title, name, email, phone, notes, sort_order, active'

const staff = ref<AdminStaff[]>([])
const ready = ref(false)
let loadStarted = false
let channel: ReturnType<typeof supabase.channel> | null = null

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    /* Dev: surface the JSON in the new shape so the UI doesn't have
       to branch on session mode. Fake ids + sortOrder mirror the
       real-DB shape. */
    const seed = seedJson as Array<{
      title: string
      name: string
      email: string | null
      phone: string | null
      notes: string | null
    }>
    staff.value = seed.map((s, i) => ({
      id: `dev-${i}`,
      title: s.title,
      name: s.name,
      email: s.email,
      phone: s.phone,
      notes: s.notes,
      sortOrder: i,
      active: true,
    }))
    ready.value = true
    return
  }

  const { data, error } = await supabase
    .from('admin_staff')
    .select(COLUMNS)
    .order('sort_order')
  if (error) {
    console.error('[admin-staff] load failed:', error.message)
    ready.value = true
    return
  }
  staff.value = (data ?? []).map((r) => rowToStaff(r as StaffRow))
  ready.value = true

  subscribeRealtime()
}

function subscribeRealtime() {
  if (channel) return
  channel = supabase
    .channel('admin_staff')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'admin_staff' },
      (payload) => {
        const r = rowToStaff(payload.new as StaffRow)
        if (staff.value.some((s) => s.id === r.id)) return
        staff.value = [...staff.value, r].sort(
          (a, b) => a.sortOrder - b.sortOrder,
        )
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'admin_staff' },
      (payload) => {
        const r = rowToStaff(payload.new as StaffRow)
        staff.value = staff.value
          .map((s) => (s.id === r.id ? r : s))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'admin_staff' },
      (payload) => {
        const old = payload.old as { id?: string }
        if (!old.id) return
        staff.value = staff.value.filter((s) => s.id !== old.id)
      },
    )
    .subscribe()
}

export interface SaveStaffInput {
  id?: string
  title: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  active: boolean
}

export function useAdminStaff() {
  const auth = useAuthStore()
  void load()

  /* Crew see active only; admins see everything. The component
     decides which list it wants. */
  const activeStaff = computed(() => staff.value.filter((s) => s.active))

  async function save(
    input: SaveStaffInput,
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    if (auth.usingDevStub) {
      /* Dev: update the in-memory list. */
      if (input.id) {
        staff.value = staff.value.map((s) =>
          s.id === input.id ? { ...s, ...input, id: s.id, sortOrder: s.sortOrder } : s,
        )
        return { ok: true, id: input.id }
      }
      const id = `dev-${crypto.randomUUID()}`
      const sortOrder = staff.value.length
      staff.value = [
        ...staff.value,
        {
          id,
          title: input.title,
          name: input.name,
          email: input.email,
          phone: input.phone,
          notes: input.notes,
          sortOrder,
          active: input.active,
        },
      ]
      return { ok: true, id }
    }

    const row = {
      title: input.title.trim(),
      name: input.name.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      notes: input.notes?.trim() || null,
      active: input.active,
    }
    if (input.id) {
      const { data, error } = await supabase
        .from('admin_staff')
        .update(row)
        .eq('id', input.id)
        .select(COLUMNS)
        .single()
      if (error) return { ok: false, error: error.message }
      const next = rowToStaff(data as StaffRow)
      staff.value = staff.value
        .map((s) => (s.id === next.id ? next : s))
        .sort((a, b) => a.sortOrder - b.sortOrder)
      return { ok: true, id: next.id }
    }
    /* New row — append to the end (sort_order = current length). */
    const { data, error } = await supabase
      .from('admin_staff')
      .insert({ ...row, sort_order: staff.value.length })
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const inserted = rowToStaff(data as StaffRow)
    staff.value = [...staff.value, inserted].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    )
    return { ok: true, id: inserted.id }
  }

  async function remove(
    id: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) {
      staff.value = staff.value.filter((s) => s.id !== id)
      return { ok: true }
    }
    const { error } = await supabase.from('admin_staff').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    staff.value = staff.value.filter((s) => s.id !== id)
    return { ok: true }
  }

  /* Move a row up or down by swapping sort_order with its neighbor.
     Renumbers the whole list afterwards so the array stays 0..N-1. */
  async function move(
    id: string,
    direction: 'up' | 'down',
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const sorted = [...staff.value].sort((a, b) => a.sortOrder - b.sortOrder)
    const i = sorted.findIndex((s) => s.id === id)
    if (i === -1) return { ok: false, error: 'Row not found.' }
    const swap = direction === 'up' ? i - 1 : i + 1
    if (swap < 0 || swap >= sorted.length) return { ok: true }
    ;[sorted[i], sorted[swap]] = [sorted[swap], sorted[i]]

    /* Renumber and persist. */
    const updates = sorted.map((s, idx) => ({ ...s, sortOrder: idx }))
    staff.value = updates
    if (auth.usingDevStub) return { ok: true }

    /* Two-row UPDATE is enough — only the swapped pair changed. */
    const a = updates[swap]
    const b = updates[i]
    const { error: errA } = await supabase
      .from('admin_staff')
      .update({ sort_order: a.sortOrder })
      .eq('id', a.id)
    if (errA) return { ok: false, error: errA.message }
    const { error: errB } = await supabase
      .from('admin_staff')
      .update({ sort_order: b.sortOrder })
      .eq('id', b.id)
    if (errB) return { ok: false, error: errB.message }
    return { ok: true }
  }

  return {
    staff,
    activeStaff,
    ready,
    save,
    remove,
    move,
  }
}
