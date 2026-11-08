// supabase/functions/sched-ics/index.ts
//
// Personal iCalendar subscription feed — "sync my shifts to Google /
// Apple / Outlook". Each member gets a secret token (sched_ics_feeds,
// minted by the sched_ics_feed_token RPC from the portal's Calendar
// sync settings); calendar apps subscribe to
//
//   GET /functions/v1/sched-ics?t=<token>
//
// and refresh on their own cadence (Apple honors the 4h TTL hints;
// Google takes several hours to a day). The feed is READ-ONLY and
// covers ~30 days back to ~6 months out.
//
// Deploy with verify_jwt FALSE — calendar clients send no auth headers;
// the token is the whole credential.
//
// Schedule resolution (rotation template + deviation entries, time off
// subtracted, multi-day runs merged) is copied from sched-notify's
// buildBlocks. KEEP THE THREE IN LOCKSTEP: segsForUserOnDate in the
// client, buildBlocks in sched-notify, and this file.

// @ts-expect-error resolved at runtime by the Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

const SB_URL = env.get('SUPABASE_URL')!
const SERVICE_KEY = env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ── Central-time helpers (lockstep with sched-notify) ────────────────

const ROT_ANCHOR = '2026-04-06'
const ROT_SEQ = ['B', 'B', 'C', 'C', 'A', 'A']

function daysBetweenIso(aIso: string, bIso: string): number {
  return Math.round((Date.parse(`${bIso}T00:00:00Z`) - Date.parse(`${aIso}T00:00:00Z`)) / 86_400_000)
}

function platoonFor(dateIso: string): string {
  const d = daysBetweenIso(ROT_ANCHOR, dateIso)
  return ROT_SEQ[((d % 6) + 6) % 6]
}

function unitPlatoonFor(pattern: string[] | null, anchor: string | null, dateIso: string): string | null {
  if (!pattern || pattern.length === 0) return platoonFor(dateIso)
  const a = anchor ?? ROT_ANCHOR
  const len = pattern.length
  const d = daysBetweenIso(a, dateIso)
  const tok = (pattern[((d % len) + len) % len] ?? '').toUpperCase()
  return tok === 'A' || tok === 'B' || tok === 'C' ? tok : null
}

function todayCentralIso(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Chicago' }).format(new Date())
}

function addDaysIso(dateIso: string, n: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Epoch ms of dateIso + 'HH:MM' Central (CDT/CST probed like the client). */
function centralMs(dateIso: string, time: string): number {
  for (const off of ['-05:00', '-06:00']) {
    const c = new Date(`${dateIso}T${time}:00${off}`)
    const chk = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'America/Chicago',
    }).format(c).replace(', ', 'T')
    if (chk === `${dateIso}T${time}`) return c.getTime()
  }
  return new Date(`${dateIso}T${time}:00-05:00`).getTime()
}

/** A unit's rotation window on a work date, clamped inside 0600→0600. */
function unitWindow(fromRaw: string | null, untilRaw: string | null, dateIso: string): { start: number; end: number } {
  const f = (fromRaw ?? '06:00').slice(0, 5)
  const u = (untilRaw ?? '06:00').slice(0, 5)
  const dayEnd = centralMs(addDaysIso(dateIso, 1), '06:00')
  const start = f >= '06:00' ? centralMs(dateIso, f) : centralMs(addDaysIso(dateIso, 1), f)
  let end = u > '06:00' && u > f && f >= '06:00' ? centralMs(dateIso, u) : centralMs(addDaysIso(dateIso, 1), u)
  if (u === '06:00' || end <= start) end = dayEnd
  if (end > dayEnd) end = dayEnd
  return { start, end }
}

// ── ICS plumbing ─────────────────────────────────────────────────────

/** RFC 5545 text escaping for SUMMARY/DESCRIPTION values. */
function icsEsc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** UTC instant → iCalendar basic format (20261108T120000Z). */
function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** Fold lines longer than 75 octets with CRLF + space continuations. */
function icsFold(line: string): string[] {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return [line]
  const out: string[] = []
  let cur = ''
  let curLen = 0
  for (const ch of line) {
    const chLen = new TextEncoder().encode(ch).length
    // continuation lines start with a space, so cap at 74 after the first
    const cap = out.length === 0 ? 75 : 74
    if (curLen + chLen > cap) {
      out.push(out.length === 0 ? cur : ' ' + cur)
      cur = ch
      curLen = chLen
    } else {
      cur += ch
      curLen += chLen
    }
  }
  if (cur) out.push(out.length === 0 ? cur : ' ' + cur)
  return out
}

// ── main ─────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function plain(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } })
}

// @ts-expect-error Deno.serve available in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain('GET only', 405)

  try {
    const url = new URL(req.url)
    const token = (url.searchParams.get('t') ?? url.searchParams.get('token') ?? '').trim()
    if (!token || token.length < 20) return plain('Calendar link not found or revoked.', 404)

    const sb = createClient(SB_URL, SERVICE_KEY)

    const feedR = await sb.from('sched_ics_feeds').select('user_id').eq('token', token).maybeSingle()
    if (feedR.error) return plain('Feed lookup failed.', 500)
    const ownerId = feedR.data?.user_id as string | undefined
    if (!ownerId) return plain('Calendar link not found or revoked.', 404)

    const ownerR = await sb.from('app_users').select('id, full_name, active, account_type').eq('id', ownerId).maybeSingle()
    const owner = ownerR.data
    if (!owner || !owner.active || (owner.account_type && owner.account_type !== 'person')) {
      return plain('This calendar link is no longer active.', 410)
    }

    // ── window: ~30 days back → ~6 months out. Three extra lead days
    //    only feed the merge, so a 48/72-hr run that started before the
    //    window still comes out as one block; blocks that END before the
    //    window are dropped below.
    const today = todayCentralIso()
    const windowStartIso = addDaysIso(today, -30)
    const windowStartMs = centralMs(windowStartIso, '00:00')
    const dates: string[] = []
    for (let i = -33; i <= 182; i++) dates.push(addDaysIso(today, i))

    const [uR, sR, rR, eR] = await Promise.all([
      sb.from('sched_units').select('id, code, active, effective_from, rotation_pattern, rotation_anchor, shift_start, shift_end'),
      sb.from('sched_seats').select('id, unit_id, label, active'),
      sb.from('sched_rotation_assignments').select('seat_id, platoon, user_id, effective_from, effective_to'),
      sb.from('sched_entries').select('work_date, seat_id, user_id, kind, status, start_at, end_at, note')
        .gte('work_date', dates[0]).lte('work_date', dates[dates.length - 1]),
    ])
    const err0 = uR.error ?? sR.error ?? rR.error ?? eR.error
    if (err0) return plain('Schedule load failed.', 500)

    const unitsA = (uR.data ?? []).filter((u) => u.active)
    const unitById = new Map(unitsA.map((u) => [u.id, u]))
    const seatsA = (sR.data ?? []).filter((s) => s.active && unitById.has(s.unit_id))
    const rot = rR.data ?? []
    const rows = (eR.data ?? []) as EntryRowLite[]

    const rotOccupant = (seatId: string, platoon: string, dateIso: string): string | null => {
      let best: { from: string; user: string | null } | null = null
      for (const a of rot) {
        if (a.seat_id !== seatId || a.platoon !== platoon) continue
        if (a.effective_from > dateIso) continue
        if (a.effective_to !== null && a.effective_to < dateIso) continue
        if (best === null || a.effective_from > best.from) best = { from: a.effective_from, user: a.user_id }
      }
      return best?.user ?? null
    }

    interface LSeg { start: number; end: number; label: string }
    interface EntryRowLite {
      work_date: string
      seat_id: string | null
      user_id: string | null
      kind: string
      status: string
      start_at: string
      end_at: string
      note: string | null
    }

    /** sched-notify's buildBlocks minus the supervisor/staffing
     *  bookkeeping reminders need — same inputs, same semantics. */
    const buildBlocks = (dateList: string[], entryRows: EntryRowLite[]) => {
      const byUser = new Map<string, LSeg[]>()
      const pushSeg = (uid: string, seg: LSeg) => {
        const l = byUser.get(uid) ?? []
        l.push(seg)
        byUser.set(uid, l)
      }

      for (const dateIso of dateList) {
        const dayRows = entryRows.filter((r) => r.work_date === dateIso)
        for (const seat of seatsA) {
          const unit = unitById.get(seat.unit_id)!
          // Future-dated units (effective_from) are planning-only until
          // opening day — invisible here too, lockstep with the client.
          if (unit.effective_from && dateIso < unit.effective_from) continue
          const label = `${unit.code} ${seat.label}`
          const seatRows = dayRows.filter((r) => r.seat_id === seat.id && r.kind !== 'timeoff' && r.status !== 'off')
          if (seatRows.length > 0) {
            for (const r of seatRows) {
              if (r.user_id && r.status === 'scheduled') {
                pushSeg(r.user_id, { start: Date.parse(r.start_at), end: Date.parse(r.end_at), label })
              }
            }
          } else {
            const platoon = unitPlatoonFor(unit.rotation_pattern, unit.rotation_anchor, dateIso)
            if (!platoon) continue
            const occ = rotOccupant(seat.id, platoon, dateIso)
            if (!occ) continue
            const w = unitWindow(unit.shift_start, unit.shift_end, dateIso)
            pushSeg(occ, { start: w.start, end: w.end, label })
          }
        }
        for (const r of dayRows) {
          if (r.seat_id !== null || !r.user_id || r.status !== 'scheduled') continue
          if (r.kind === 'extra' || r.kind === 'event' || r.kind === 'student' || r.kind === 'rider') {
            const label =
              r.kind === 'event' ? (r.note || 'Special event')
              : r.kind === 'extra' ? 'Extra hours'
              : r.kind === 'student' ? 'Student ride'
              : 'Rider'
            pushSeg(r.user_id, { start: Date.parse(r.start_at), end: Date.parse(r.end_at), label })
          }
        }
      }

      // time off follows the person — booked-off hours never show
      const offByUser = new Map<string, { s: number; e: number }[]>()
      for (const r of entryRows) {
        if (r.kind !== 'timeoff' || !r.user_id) continue
        const l = offByUser.get(r.user_id) ?? []
        l.push({ s: Date.parse(r.start_at), e: Date.parse(r.end_at) })
        offByUser.set(r.user_id, l)
      }

      // merge per user (multi-day blocks become one segment; the label
      // of the run's FIRST piece names the shift)
      const blocks = new Map<string, LSeg[]>()
      for (const [uid, segs] of byUser) {
        const sorted = segs.filter((s) => s.end - s.start >= 60_000).sort((a, b) => a.start - b.start)
        const merged: LSeg[] = []
        for (const s of sorted) {
          const last = merged[merged.length - 1]
          if (last && s.start <= last.end + 60_000) last.end = Math.max(last.end, s.end)
          else merged.push({ ...s })
        }
        let eff = merged
        for (const o of offByUser.get(uid) ?? []) {
          const next: LSeg[] = []
          for (const s of eff) {
            const os = Math.max(s.start, o.s)
            const oe = Math.min(s.end, o.e)
            if (oe - os < 60_000) {
              next.push(s)
              continue
            }
            if (os - s.start >= 60_000) next.push({ ...s, end: os })
            if (s.end - oe >= 60_000) next.push({ ...s, start: oe })
          }
          eff = next
        }
        blocks.set(uid, eff)
      }
      return blocks
    }

    const mine = (buildBlocks(dates, rows).get(ownerId) ?? [])
      .filter((b) => b.end > windowStartMs)
      .sort((a, b) => a.start - b.start)

    // ── emit the calendar ────────────────────────────────────────────
    const stamp = icsUtc(Date.now())
    const uidTag = ownerId.replace(/-/g, '').slice(0, 12)
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Waller County EMS//Employee Portal Schedule//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      ...icsFold(`X-WR-CALNAME:${icsEsc(`WCEMS Shifts — ${owner.full_name ?? ''}`.trim())}`),
      'X-WR-TIMEZONE:America/Chicago',
      'X-WR-CALDESC:Waller County EMS shifts — synced from the Employee Portal',
      'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
      'X-PUBLISHED-TTL:PT4H',
    ]
    for (const b of mine) {
      lines.push('BEGIN:VEVENT')
      // start ms uniquely keys a merged block per person, so a retimed
      // end or relabel UPDATES the event instead of duplicating it
      lines.push(`UID:wcems-${uidTag}-${b.start}@wallercountyems.com`)
      lines.push(`DTSTAMP:${stamp}`)
      lines.push(`DTSTART:${icsUtc(b.start)}`)
      lines.push(`DTEND:${icsUtc(b.end)}`)
      lines.push(...icsFold(`SUMMARY:${icsEsc(`WCEMS — ${b.label}`)}`))
      lines.push(...icsFold(`DESCRIPTION:${icsEsc('Waller County EMS schedule. Synced from the Employee Portal — trades, pickups, and time off flow in automatically within a few hours.')}`))
      lines.push('END:VEVENT')
    }
    lines.push('END:VCALENDAR')

    await sb.from('sched_ics_feeds').update({ last_fetched_at: new Date().toISOString() }).eq('token', token)

    const body = lines.join('\r\n') + '\r\n'
    return new Response(req.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="wcems-shifts.ics"',
        'Cache-Control': 'private, max-age=600',
        ...CORS,
      },
    })
  } catch (e) {
    return plain(e instanceof Error ? e.message : 'Feed failed.', 500)
  }
})
