import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import peopleData from '@/data/people.json'

/**
 * Today's birthdays — pulled from `app_users` in real-session mode.
 *
 * The list is computed by matching month + day on the signed-in user's
 * local calendar (Central Time) against `date_of_birth`. Year is
 * intentionally ignored. Filters out anyone who opted out
 * (`show_birthday = false`) or who's been marked inactive.
 *
 * Dev-stub: reads the existing `people.json.birthdays` array so dev
 * iteration keeps working without a real session.
 *
 * Module-level cache so multiple consumers (dashboard birthday list,
 * future "upcoming birthdays" surfaces) share state. Admin edits
 * call `refresh()` so a freshly-saved DOB shows up immediately.
 */

export interface TodaysBirthday {
  name: string
  /** Free-text job title — "Paramedic", "EMT", "Operations Director". */
  title: string
  /** Home station code — "S202", "M271", "EMS Admin", etc. */
  station: string
  /** Capitalized permissions role used as a fallback when title is empty. */
  roleFallback: string
  /** Slug used by reactions/comments keys; stable per person. */
  personKey: string
}

interface AppUserBirthdayRow {
  id: string
  full_name: string
  role: 'crew' | 'supervisor' | 'admin'
  title: string | null
  station: string | null
  date_of_birth: string | null
  show_birthday: boolean
  active: boolean
}

const list = ref<TodaysBirthday[]>([])
const ready = ref(false)
let loadStarted = false

function todayCentralMonthDay(): { month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Chicago',
  })
  const parts = formatter.format(new Date()).split('/')
  return { month: Number(parts[0]), day: Number(parts[1]) }
}

function parseDobMonthDay(iso: string): { month: number; day: number } | null {
  /* date_of_birth is stored as `YYYY-MM-DD` (calendar date, no TZ).
     Parse it positionally to avoid UTC-shift surprises. */
  const parts = iso.split('-')
  if (parts.length < 3) return null
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!month || !day) return null
  return { month, day }
}

function prettyRole(role: AppUserBirthdayRow['role']): string {
  if (role === 'admin') return 'Admin'
  if (role === 'supervisor') return 'Supervisor'
  return 'Crew'
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

async function fetchFromDb() {
  const today = todayCentralMonthDay()

  const { data, error } = await supabase
    .from('app_users')
    .select('id, full_name, role, title, station, date_of_birth, show_birthday, active')
    .eq('active', true)
    .eq('show_birthday', true)
    .not('date_of_birth', 'is', null)
  if (error) {
    console.error('[birthdays] load failed:', error.message)
    return
  }

  const matches: TodaysBirthday[] = []
  for (const r of (data ?? []) as AppUserBirthdayRow[]) {
    if (!r.date_of_birth) continue
    const md = parseDobMonthDay(r.date_of_birth)
    if (!md) continue
    if (md.month !== today.month || md.day !== today.day) continue
    matches.push({
      name: r.full_name,
      title: (r.title ?? '').trim(),
      station: (r.station ?? '').trim(),
      roleFallback: prettyRole(r.role),
      personKey: slugify(r.full_name),
    })
  }
  matches.sort((a, b) => a.name.localeCompare(b.name))
  list.value = matches
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    /* Dev-stub: preserve the legacy people.json flow so dev iteration
       still works when there's no real session. The legacy fixture has
       `role` (free text like "Paramedic") and `shift`; we re-shape them
       into the new title/station/roleFallback shape so consumers don't
       branch on session mode. */
    const stubBirthdays = (
      peopleData as {
        birthdays: Array<{
          name: string
          role?: string
          title?: string
          shift?: string
          station?: string
        }>
      }
    ).birthdays
    list.value = stubBirthdays.map((b) => ({
      name: b.name,
      title: (b.title ?? b.role ?? '').trim(),
      station: (b.station ?? '').trim(),
      roleFallback: (b.role ?? '').trim() || 'Crew',
      personKey: slugify(b.name),
    }))
    ready.value = true
    return
  }

  await fetchFromDb()
  ready.value = true
}

export function useTodaysBirthdays() {
  void load()

  /** Re-pull from the DB. Call this from admin save handlers so a
   *  freshly-edited DOB shows up immediately on the dashboard. No-op
   *  in dev-stub mode. */
  async function refresh() {
    const auth = useAuthStore()
    if (auth.usingDevStub) return
    await fetchFromDb()
  }

  return { birthdays: list, ready, refresh }
}
