<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import AppShell from '@/training/components/AppShell.vue'
import { useAuthStore } from '@/training/stores/auth'
import { supabase } from '@/training/lib/supabase'
import type { Discipline, Instructor, Role } from '@/training/types'
import {
  ShieldCheck,
  Plus,
  Search,
  Mail,
  IdCard,
  Calendar,
  Save,
  X,
  Pencil,
  CheckCircle2,
  CircleSlash2,
  UserPlus,
  Stethoscope,
  Users,
} from 'lucide-vue-next'

/* ─── Clinical Development access (app_users.role) ─────────────────────
 *  Cross-domain access. An AHA instructor doesn't necessarily need
 *  CD access, and vice versa — managed here so admins have one place
 *  to grant/revoke either kind.
 */
interface CdUserRow {
  id: string
  email: string
  fullName: string
  role: Role
  active: boolean
}
const cdUsers = ref<CdUserRow[]>([])
const cdLoading = ref(false)
const cdErr = ref<string | null>(null)
const cdGrantOpen = ref(false)
const cdSearch = ref('')
const cdCandidates = ref<CdUserRow[]>([])
const cdCandLoading = ref(false)
const cdSaving = ref<string | null>(null)

/** Inline edit for a CD user row — admin can fix stale name/email
 *  on the app_users record. Keyed on the user id; when set, that
 *  row swaps to a small inline form. */
const cdEditingId = ref<string | null>(null)
const cdEditForm = ref<{ email: string; fullName: string }>({
  email: '',
  fullName: '',
})

/* ───────────────────────── State ───────────────────────── */

const auth = useAuthStore()

const disciplines = ref<Discipline[]>([])
const instructors = ref<Instructor[]>([])
const loading = ref(false)
const search = ref('')
const showInactive = ref(false)

const editing = ref<Instructor | null>(null)
const formOpen = ref(false)
const saving = ref(false)
const err = ref<string | null>(null)

interface FormState {
  email: string
  fullName: string
  instructorNumber: string
  isAdmin: boolean
  active: boolean
  discipline: Record<
    string,
    { authorized: boolean; cardExp: string }
  >
}
function emptyForm(): FormState {
  const discMap: FormState['discipline'] = {}
  for (const d of disciplines.value) {
    discMap[d.code] = { authorized: false, cardExp: '' }
  }
  return {
    email: '',
    fullName: '',
    instructorNumber: '',
    isAdmin: false,
    active: true,
    discipline: discMap,
  }
}
const form = ref<FormState>(emptyForm())

/* ───────────────────────── Loading ───────────────────────── */

interface DisciplineRow {
  id: string
  code: string
  name: string
  category: 'aha_card' | 'inhouse_card' | 'lecture'
  uses_app_checkin: boolean
  wix_service_id: string | null
  wix_schedule_id: string | null
  active: boolean
  sort_order: number
}
interface InstructorRow {
  id: string
  email: string
  full_name: string
  instructor_number: string | null
  is_admin: boolean
  active: boolean
  created_at: string
  training_instructor_disciplines:
    | Array<{
        discipline_id: string
        card_exp: string | null
        training_disciplines: { code: string } | null
      }>
    | null
}

async function loadDisciplines() {
  const { data, error } = await supabase
    .from('training_disciplines')
    .select(
      'id, code, name, category, uses_app_checkin, wix_service_id, wix_schedule_id, active, sort_order',
    )
    .eq('active', true)
    .order('sort_order')
  if (error) throw new Error(error.message)
  disciplines.value = (data as DisciplineRow[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    usesAppCheckin: r.uses_app_checkin,
    wixServiceId: r.wix_service_id,
    wixScheduleId: r.wix_schedule_id,
    active: r.active,
    sortOrder: r.sort_order,
  }))
}

async function loadInstructors() {
  const { data, error } = await supabase
    .from('training_instructors')
    .select(
      `id, email, full_name, instructor_number, is_admin, active, created_at,
       training_instructor_disciplines (
         discipline_id,
         card_exp,
         training_disciplines ( code )
       )`,
    )
    .order('full_name')
  if (error) throw new Error(error.message)
  instructors.value = (data as unknown as InstructorRow[]).map((r) => {
    const codes: string[] = []
    const cardExpByCode: Record<string, string | null> = {}
    for (const link of r.training_instructor_disciplines ?? []) {
      const c = link.training_disciplines?.code
      if (!c) continue
      codes.push(c)
      cardExpByCode[c] = link.card_exp
    }
    return {
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      instructorNumber: r.instructor_number,
      isAdmin: r.is_admin,
      active: r.active,
      disciplineCodes: codes,
      cardExpByCode,
      createdAt: r.created_at,
    }
  })
}

async function reloadAll() {
  loading.value = true
  err.value = null
  try {
    await loadDisciplines()
    await loadInstructors()
    await loadCdUsers()
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Failed to load.'
  } finally {
    loading.value = false
  }
}

onMounted(reloadAll)

/* ─── CD access loaders + actions ─────────────────────────────────── */

async function loadCdUsers() {
  cdLoading.value = true
  cdErr.value = null
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, email, full_name, role, active')
      .in('role', ['supervisor', 'admin'])
      .order('role', { ascending: false })
      .order('full_name')
    if (error) throw new Error(error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdUsers.value = (data as any[]).map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      role: r.role as Role,
      active: r.active,
    }))
  } catch (e) {
    cdErr.value = e instanceof Error ? e.message : 'Failed to load CD access.'
  } finally {
    cdLoading.value = false
  }
}

/** Type-ahead search of app_users for the "Grant access" picker.
 *  Excludes anyone already in cdUsers so we don't offer to "grant"
 *  someone who's already a supervisor/admin. */
async function searchCdCandidates() {
  const q = cdSearch.value.trim()
  if (q.length < 2) {
    cdCandidates.value = []
    return
  }
  cdCandLoading.value = true
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, email, full_name, role, active')
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .eq('role', 'crew')
      .eq('active', true)
      .limit(8)
    if (error) throw new Error(error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdCandidates.value = (data as any[]).map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      role: r.role as Role,
      active: r.active,
    }))
  } catch (e) {
    cdErr.value = e instanceof Error ? e.message : 'Search failed.'
  } finally {
    cdCandLoading.value = false
  }
}

watch(cdSearch, () => {
  if (cdGrantOpen.value) void searchCdCandidates()
})

async function grantCdAccess(userId: string, role: 'supervisor' | 'admin') {
  cdSaving.value = userId
  cdErr.value = null
  try {
    const { error } = await supabase
      .from('app_users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) throw new Error(error.message)
    cdGrantOpen.value = false
    cdSearch.value = ''
    cdCandidates.value = []
    await loadCdUsers()
  } catch (e) {
    cdErr.value = e instanceof Error ? e.message : 'Grant failed.'
  } finally {
    cdSaving.value = null
  }
}

async function changeCdRole(u: CdUserRow, role: Role) {
  if (u.role === role) return
  cdSaving.value = u.id
  cdErr.value = null
  try {
    const { error } = await supabase
      .from('app_users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', u.id)
    if (error) throw new Error(error.message)
    await loadCdUsers()
  } catch (e) {
    cdErr.value = e instanceof Error ? e.message : 'Update failed.'
  } finally {
    cdSaving.value = null
  }
}

async function revokeCdAccess(u: CdUserRow) {
  if (
    !confirm(
      `Revoke Clinical Development access for ${u.fullName}? They'll keep their AHA instructor access (if any) but lose access to the pipeline.`,
    )
  )
    return
  await changeCdRole(u, 'crew')
}

/* ─── Inline edit on app_users (CD users) ─────────────────────────── */
function startCdEdit(u: CdUserRow) {
  cdEditingId.value = u.id
  cdEditForm.value = { email: u.email, fullName: u.fullName }
}
function cancelCdEdit() {
  cdEditingId.value = null
}
async function saveCdEdit(u: CdUserRow) {
  const email = cdEditForm.value.email.trim().toLowerCase()
  const fullName = cdEditForm.value.fullName.trim()
  if (!email || !email.includes('@')) {
    cdErr.value = 'Enter a valid email.'
    return
  }
  if (!fullName) {
    cdErr.value = 'Enter a full name.'
    return
  }
  cdSaving.value = u.id
  cdErr.value = null
  try {
    const { error } = await supabase
      .from('app_users')
      .update({
        email,
        full_name: fullName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', u.id)
    if (error) throw new Error(error.message)
    cdEditingId.value = null
    await loadCdUsers()
  } catch (e) {
    cdErr.value = e instanceof Error ? e.message : 'Save failed.'
  } finally {
    cdSaving.value = null
  }
}

watch(disciplines, () => {
  if (!editing.value) form.value = emptyForm()
})

/* ───────────────────────── Filtering ───────────────────────── */

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return instructors.value.filter((i) => {
    if (!showInactive.value && !i.active) return false
    if (!q) return true
    return (
      i.fullName.toLowerCase().includes(q) ||
      i.email.toLowerCase().includes(q) ||
      i.disciplineCodes.some((c) => c.toLowerCase().includes(q))
    )
  })
})

/* ───────────────────────── Form helpers ───────────────────────── */

function openAdd() {
  editing.value = null
  form.value = emptyForm()
  formOpen.value = true
  err.value = null
}
function openEdit(i: Instructor) {
  editing.value = i
  const discMap: FormState['discipline'] = {}
  for (const d of disciplines.value) {
    const authorized = i.disciplineCodes.includes(d.code)
    discMap[d.code] = {
      authorized,
      cardExp: authorized ? i.cardExpByCode[d.code] ?? '' : '',
    }
  }
  form.value = {
    email: i.email,
    fullName: i.fullName,
    instructorNumber: i.instructorNumber ?? '',
    isAdmin: i.isAdmin,
    active: i.active,
    discipline: discMap,
  }
  formOpen.value = true
  err.value = null
}
function cancelForm() {
  formOpen.value = false
  editing.value = null
  err.value = null
}

/* ───────────────────────── Save / Delete ───────────────────────── */

async function save() {
  err.value = null
  const email = form.value.email.trim().toLowerCase()
  const fullName = form.value.fullName.trim()
  if (!email || !email.includes('@')) {
    err.value = 'Enter a valid email.'
    return
  }
  if (!fullName) {
    err.value = 'Enter the instructor’s full name.'
    return
  }
  saving.value = true
  try {
    let instructorId: string
    if (editing.value) {
      const { error: e1 } = await supabase
        .from('training_instructors')
        .update({
          email,
          full_name: fullName,
          instructor_number: form.value.instructorNumber.trim() || null,
          is_admin: form.value.isAdmin,
          active: form.value.active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editing.value.id)
      if (e1) throw new Error(e1.message)
      instructorId = editing.value.id
    } else {
      const { data: ins, error: e1 } = await supabase
        .from('training_instructors')
        .insert({
          email,
          full_name: fullName,
          instructor_number: form.value.instructorNumber.trim() || null,
          is_admin: form.value.isAdmin,
          active: form.value.active,
        })
        .select('id')
        .single()
      if (e1) throw new Error(e1.message)
      instructorId = ins!.id as string
    }

    // Sync discipline authorizations:
    //   1) wipe existing links (cheap, < 10 per instructor)
    //   2) insert the currently-checked ones with their card_exp.
    const { error: eDel } = await supabase
      .from('training_instructor_disciplines')
      .delete()
      .eq('instructor_id', instructorId)
    if (eDel) throw new Error(eDel.message)

    const rows = disciplines.value
      .filter((d) => form.value.discipline[d.code]?.authorized)
      .map((d) => ({
        instructor_id: instructorId,
        discipline_id: d.id,
        card_exp: form.value.discipline[d.code].cardExp || null,
      }))
    if (rows.length) {
      const { error: eIns } = await supabase
        .from('training_instructor_disciplines')
        .insert(rows)
      if (eIns) throw new Error(eIns.message)
    }

    await loadInstructors()
    // If we just edited ourselves, refresh the auth store so the topnav
    // and dropdown filtering update immediately.
    if (auth.appUser?.email?.toLowerCase() === email) {
      await auth.reloadInstructor()
    }

    formOpen.value = false
    editing.value = null
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Save failed.'
  } finally {
    saving.value = false
  }
}

async function toggleActive(i: Instructor) {
  // Quick action on the row — flip active without opening the form.
  const { error } = await supabase
    .from('training_instructors')
    .update({ active: !i.active, updated_at: new Date().toISOString() })
    .eq('id', i.id)
  if (error) {
    err.value = error.message
    return
  }
  await loadInstructors()
}

</script>

<template>
  <AppShell>
    <section class="hero">
      <p class="hero__eyebrow">Administration</p>
      <h1 class="hero__title display">Access</h1>
      <p class="hero__lede">
        Two independent access lists live here. AHA Instructors run
        card classes + lectures. Clinical Development supervisors and
        admins manage the P1 / P2 / P3 pipeline. A person can be on
        either list, both, or neither.
      </p>
    </section>

    <h2 class="section__title">
      <ShieldCheck :size="15" :stroke-width="2" />
      AHA Instructors
    </h2>

    <div class="bar">
      <div class="bar__search">
        <Search :size="15" :stroke-width="2" />
        <input
          v-model="search"
          type="text"
          placeholder="Search name, email, or discipline"
        />
      </div>
      <label class="bar__toggle">
        <input v-model="showInactive" type="checkbox" />
        <span>Show inactive</span>
      </label>
      <button class="btn btn-primary bar__add" @click="openAdd">
        <Plus :size="15" :stroke-width="2" />
        Add instructor
      </button>
    </div>

    <!-- ── Add/Edit form panel ────────────────────────────────────── -->
    <Transition name="panel">
      <div v-if="formOpen" class="panel card">
        <div class="panel__head">
          <h2 class="panel__title">
            {{ editing ? 'Edit instructor' : 'New instructor' }}
          </h2>
          <button class="iconbtn" aria-label="Close" @click="cancelForm">
            <X :size="17" :stroke-width="2" />
          </button>
        </div>

        <div class="panel__grid">
          <label class="field">
            <span class="field__label">
              <Mail :size="13" :stroke-width="2" />
              Email
            </span>
            <input
              v-model="form.email"
              type="email"
              placeholder="firstname.lastname@wallercountyems.com"
              autocomplete="off"
            />
          </label>

          <label class="field">
            <span class="field__label">Full name</span>
            <input
              v-model="form.fullName"
              type="text"
              placeholder="First Last"
              autocomplete="off"
            />
          </label>

          <label class="field">
            <span class="field__label">
              <IdCard :size="13" :stroke-width="2" />
              AHA instructor # <span class="field__opt">(optional)</span>
            </span>
            <input
              v-model="form.instructorNumber"
              type="text"
              placeholder="e.g. 12345678"
              autocomplete="off"
            />
          </label>

          <div class="field">
            <span class="field__label">Flags</span>
            <div class="flags">
              <label class="flag">
                <input v-model="form.isAdmin" type="checkbox" />
                <span>Training admin</span>
                <small>Can manage instructors</small>
              </label>
              <label class="flag">
                <input v-model="form.active" type="checkbox" />
                <span>Active</span>
                <small>Uncheck to revoke access without losing history</small>
              </label>
            </div>
          </div>
        </div>

        <div class="disc">
          <p class="disc__heading">Authorized disciplines</p>
          <p class="disc__hint">
            Card-exp dates auto-fill the per-session field when this
            instructor is the primary. Leave blank if not tracked here.
          </p>
          <div class="disc__grid">
            <label
              v-for="d in disciplines"
              :key="d.code"
              class="disc__row"
              :class="{ 'disc__row--on': form.discipline[d.code]?.authorized }"
            >
              <input
                v-model="form.discipline[d.code].authorized"
                type="checkbox"
              />
              <span class="disc__code">{{ d.code }}</span>
              <span class="disc__name">{{ d.name }}</span>
              <input
                v-model="form.discipline[d.code].cardExp"
                type="date"
                class="disc__exp"
                :disabled="!form.discipline[d.code]?.authorized"
                aria-label="Card expiration"
              />
            </label>
          </div>
        </div>

        <p v-if="err" class="panel__err">{{ err }}</p>

        <div class="panel__actions">
          <button class="btn" :disabled="saving" @click="cancelForm">Cancel</button>
          <button class="btn btn-primary" :disabled="saving" @click="save">
            <Save :size="14" :stroke-width="2" />
            {{ saving ? 'Saving…' : editing ? 'Save changes' : 'Add instructor' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- ── Instructor list ────────────────────────────────────────── -->
    <section class="list">
      <p v-if="loading" class="empty">Loading instructors…</p>
      <p v-else-if="!visible.length" class="empty">
        {{ search ? 'No matches.' : 'No instructors yet.' }}
      </p>
      <div v-else class="list__grid">
        <article
          v-for="i in visible"
          :key="i.id"
          class="row card"
          :class="{ 'row--off': !i.active }"
        >
          <div class="row__head">
            <div class="row__person">
              <p class="row__name">{{ i.fullName }}</p>
              <p class="row__email">
                <Mail :size="12" :stroke-width="2" />{{ i.email }}
              </p>
              <p v-if="i.instructorNumber" class="row__num">
                <IdCard :size="12" :stroke-width="2" />#{{ i.instructorNumber }}
              </p>
            </div>
            <div class="row__pills">
              <span v-if="i.isAdmin" class="pill pill--gold">
                <ShieldCheck :size="11" :stroke-width="2.2" />Admin
              </span>
              <span
                class="pill"
                :class="i.active ? 'pill--ok' : 'pill--off'"
              >
                <component
                  :is="i.active ? CheckCircle2 : CircleSlash2"
                  :size="11"
                  :stroke-width="2.2"
                />
                {{ i.active ? 'Active' : 'Inactive' }}
              </span>
            </div>
          </div>

          <div class="row__chips">
            <span v-if="!i.disciplineCodes.length" class="chip chip--empty">
              No disciplines yet
            </span>
            <span v-for="c in i.disciplineCodes" :key="c" class="chip">
              {{ c }}
              <small v-if="i.cardExpByCode[c]" class="chip__exp">
                <Calendar :size="10" :stroke-width="2.2" />
                {{ i.cardExpByCode[c] }}
              </small>
            </span>
          </div>

          <div class="row__actions">
            <button class="btn btn-sm" @click="openEdit(i)">
              <Pencil :size="12" :stroke-width="2" />Edit
            </button>
            <button class="btn btn-sm" @click="toggleActive(i)">
              {{ i.active ? 'Deactivate' : 'Reactivate' }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- ── Clinical Development access ─────────────────────────────── -->
    <h2 class="section__title section__title--cd">
      <Stethoscope :size="15" :stroke-width="2" />
      Clinical Development access
    </h2>
    <p class="section__hint">
      Supervisors see the pipeline master grid + employee files.
      Admins additionally edit phase transitions, upload sign-offs,
      and manage tests. This is independent of AHA instructor status.
    </p>
    <div class="callout">
      <Users :size="14" :stroke-width="2" />
      <div>
        <strong>Field-staff access is automatic.</strong>
        Anyone on the
        <RouterLink to="/employees" class="callout__link">
          Employees roster
        </RouterLink>
        can sign in and reach their own training file at <code>/my-progress</code>.
        No grant is needed here — just add them via the Add Employee button on that page.
      </div>
    </div>

    <div class="bar">
      <div class="bar__spacer" />
      <button class="btn btn-primary bar__add" @click="cdGrantOpen = !cdGrantOpen">
        <UserPlus :size="14" :stroke-width="2" />
        {{ cdGrantOpen ? 'Cancel' : 'Grant access' }}
      </button>
    </div>

    <Transition name="panel">
      <div v-if="cdGrantOpen" class="panel card">
        <div class="panel__head">
          <h3 class="panel__title">Grant Clinical Development access</h3>
          <button class="iconbtn" aria-label="Close" @click="cdGrantOpen = false">
            <X :size="17" :stroke-width="2" />
          </button>
        </div>
        <div class="cdsrch">
          <Search :size="15" :stroke-width="2" />
          <input
            v-model="cdSearch"
            type="text"
            placeholder="Search WCEMS employee by name or email…"
            autocomplete="off"
          />
        </div>
        <p v-if="cdCandLoading" class="cdsrch__hint">Searching…</p>
        <p v-else-if="cdSearch.length >= 2 && !cdCandidates.length" class="cdsrch__hint">
          No matching crew members. (Already-elevated users are filtered out.)
        </p>
        <ul v-else-if="cdCandidates.length" class="cdcands">
          <li v-for="c in cdCandidates" :key="c.id" class="cdcand">
            <div class="cdcand__who">
              <span class="cdcand__name">{{ c.fullName }}</span>
              <span class="cdcand__email">{{ c.email }}</span>
            </div>
            <div class="cdcand__btns">
              <button
                class="btn btn-sm"
                :disabled="cdSaving === c.id"
                @click="grantCdAccess(c.id, 'supervisor')"
              >
                Grant Supervisor
              </button>
              <button
                class="btn btn-sm btn-primary"
                :disabled="cdSaving === c.id"
                @click="grantCdAccess(c.id, 'admin')"
              >
                Grant Admin
              </button>
            </div>
          </li>
        </ul>
        <p v-if="cdErr" class="panel__err">{{ cdErr }}</p>
      </div>
    </Transition>

    <section class="list">
      <p v-if="cdLoading" class="empty">Loading Clinical Development access…</p>
      <p v-else-if="!cdUsers.length" class="empty">
        Nobody has Clinical Development access yet.
      </p>
      <div v-else class="list__grid">
        <article v-for="u in cdUsers" :key="u.id" class="row card">
          <!-- Inline-edit form ────────────────────────────────────── -->
          <template v-if="cdEditingId === u.id">
            <div class="cdedit">
              <label class="field">
                <span class="field__label">Full name</span>
                <input
                  v-model="cdEditForm.fullName"
                  type="text"
                  autocomplete="off"
                />
              </label>
              <label class="field">
                <span class="field__label">
                  <Mail :size="13" :stroke-width="2" />
                  Email
                </span>
                <input
                  v-model="cdEditForm.email"
                  type="email"
                  autocomplete="off"
                />
              </label>
            </div>
            <div class="row__actions">
              <button
                class="btn btn-sm"
                :disabled="cdSaving === u.id"
                @click="cancelCdEdit"
              >
                Cancel
              </button>
              <button
                class="btn btn-sm btn-primary"
                :disabled="cdSaving === u.id"
                @click="saveCdEdit(u)"
              >
                <Save :size="13" :stroke-width="2" />
                {{ cdSaving === u.id ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </template>

          <!-- Display row ─────────────────────────────────────────── -->
          <template v-else>
            <div class="row__head">
              <div class="row__person">
                <p class="row__name">{{ u.fullName }}</p>
                <p class="row__email">
                  <Mail :size="12" :stroke-width="2" />{{ u.email }}
                </p>
              </div>
              <div class="row__pills">
                <span
                  class="pill"
                  :class="u.role === 'admin' ? 'pill--gold' : 'pill--ok'"
                >
                  <ShieldCheck :size="11" :stroke-width="2.2" />
                  {{ u.role === 'admin' ? 'Admin' : 'Supervisor' }}
                </span>
              </div>
            </div>
            <div class="row__actions">
              <button
                class="btn btn-sm"
                :disabled="cdSaving === u.id"
                @click="startCdEdit(u)"
              >
                <Pencil :size="12" :stroke-width="2" />Edit
              </button>
              <button
                v-if="u.role === 'admin'"
                class="btn btn-sm"
                :disabled="cdSaving === u.id"
                @click="changeCdRole(u, 'supervisor')"
              >
                Demote to Supervisor
              </button>
              <button
                v-else
                class="btn btn-sm"
                :disabled="cdSaving === u.id"
                @click="changeCdRole(u, 'admin')"
              >
                Promote to Admin
              </button>
              <button
                class="btn btn-sm"
                :disabled="cdSaving === u.id"
                @click="revokeCdAccess(u)"
              >
                Revoke access
              </button>
            </div>
          </template>
        </article>
      </div>
    </section>
  </AppShell>
</template>

<style scoped>
/* ── Hero ──────────────────────────────────────────────────────────── */
.hero {
  margin-bottom: 22px;
}
.hero__eyebrow {
  margin: 0 0 6px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.hero__title {
  margin: 0;
  font-size: 32px;
  letter-spacing: -0.012em;
  color: var(--color-text);
}
.hero__lede {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--color-muted);
  max-width: 640px;
  line-height: 1.55;
}

/* ── Action bar ───────────────────────────────────────────────────── */
.bar {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
@media (max-width: 640px) {
  .bar {
    grid-template-columns: 1fr;
  }
}
.bar__search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 9px;
  padding: 8px 12px;
  color: var(--color-muted);
}
.bar__search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13.5px;
  color: var(--color-text);
}
.bar__search input::placeholder {
  color: var(--color-muted);
}
.bar__toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--color-muted);
  user-select: none;
  cursor: pointer;
}
.bar__add {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
}

/* ── Add/Edit panel ───────────────────────────────────────────────── */
.panel {
  padding: 22px;
  margin-bottom: 18px;
}
.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.panel__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}
.iconbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
}
.iconbtn:hover {
  background: var(--color-border);
}

.panel__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 18px;
}
@media (max-width: 640px) {
  .panel__grid {
    grid-template-columns: 1fr;
  }
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field__label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.field__opt {
  text-transform: none;
  font-weight: 400;
  letter-spacing: 0;
  opacity: 0.7;
}
.field input {
  border: 1px solid var(--color-border);
  border-radius: 7px;
  padding: 8px 11px;
  font-size: 13.5px;
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
}
.field input:focus {
  border-color: var(--color-brand-500);
  box-shadow: 0 0 0 3px oklch(0.5 0.07 250 / 0.15);
}

.flags {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.flag {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 8px 10px;
  padding: 8px 11px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  cursor: pointer;
}
.flag input {
  grid-row: span 2;
}
.flag span {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
}
.flag small {
  font-size: 11px;
  color: var(--color-muted);
}

/* ── Disciplines block ────────────────────────────────────────────── */
.disc__heading {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}
.disc__hint {
  margin: 4px 0 12px;
  font-size: 12px;
  color: var(--color-muted);
}
.disc__grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.disc__row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out);
  cursor: pointer;
}
.disc__row--on {
  background: oklch(0.97 0.025 250);
  border-color: var(--color-brand-500);
}
.disc__code {
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text);
  letter-spacing: 0.02em;
}
.disc__name {
  font-size: 12.5px;
  color: var(--color-muted);
}
.disc__exp {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12.5px;
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
}
.disc__exp:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.panel__err {
  margin: 6px 0 0;
  color: var(--color-danger-500);
  font-size: 12.5px;
}
.panel__actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* ── List ─────────────────────────────────────────────────────────── */
.empty {
  margin: 32px 0;
  text-align: center;
  color: var(--color-muted);
  font-size: 13.5px;
}
.list__grid {
  display: grid;
  gap: 14px;
}
.row {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--color-border);
  transition: border-color 120ms var(--ease-out), box-shadow 120ms var(--ease-out);
}
.row--off {
  opacity: 0.72;
  background: oklch(0.985 0.005 250);
}
.row__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  flex-wrap: wrap;
}
.row__person {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.row__name {
  margin: 0;
  font-size: 15.5px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.005em;
}
.row__email,
.row__num {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.row__pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.pill--ok {
  background: oklch(0.94 0.06 152);
  color: oklch(0.36 0.09 152);
}
.pill--off {
  background: oklch(0.94 0.005 250);
  color: oklch(0.45 0.01 250);
}
.pill--gold {
  background: oklch(0.94 0.075 86.8);
  color: oklch(0.4 0.085 60);
}

.row__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: 6px;
  background: oklch(0.96 0.012 250);
  color: var(--color-text);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.chip--empty {
  background: transparent;
  color: var(--color-muted);
  font-weight: 400;
  font-style: italic;
}
.chip__exp {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--color-muted);
  letter-spacing: 0;
}

.row__actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px dashed var(--color-border);
}
.btn-sm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 12px;
}

/* ── Section dividers (AHA / CD split) ───────────────────────────── */
.section__title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 6px 0 10px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-brand-700);
}
.section__title svg {
  color: var(--color-accent-600);
}
.section__title--cd {
  margin-top: 36px;
}
.section__hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 640px;
  line-height: 1.55;
}
.bar__spacer { flex: 1; }

/* ── Pipeline-access explainer callout ───────────────────────────── */
.callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 14px;
  margin: 4px 0 14px;
  border: 1px solid oklch(0.85 0.04 250);
  background: oklch(0.97 0.025 250);
  border-radius: 10px;
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.55;
}
.callout svg {
  color: var(--color-brand-600);
  margin-top: 2px;
  flex-shrink: 0;
}
.callout code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: oklch(0.93 0.015 250);
  padding: 1px 5px;
  border-radius: 4px;
}
.callout__link {
  color: var(--color-brand-700);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.callout__link:hover { color: var(--color-brand-600); }

/* ── Inline edit form for a CD row ───────────────────────────────── */
.cdedit {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 12px;
  margin-bottom: 10px;
}
@media (max-width: 640px) {
  .cdedit { grid-template-columns: 1fr; }
}

/* ── CD grant-access picker ──────────────────────────────────────── */
.cdsrch {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 9px;
  padding: 8px 12px;
  color: var(--color-muted);
  margin-bottom: 10px;
}
.cdsrch input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13.5px;
  color: var(--color-text);
}
.cdsrch__hint {
  margin: 4px 0 8px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.cdcands {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cdcand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-surface);
}
.cdcand__who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cdcand__name {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-text);
}
.cdcand__email {
  font-size: 11.5px;
  color: var(--color-muted);
}
.cdcand__btns {
  display: inline-flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Transitions ──────────────────────────────────────────────────── */
.panel-enter-active,
.panel-leave-active {
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}
.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
