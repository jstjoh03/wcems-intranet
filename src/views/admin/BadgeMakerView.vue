<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * WCEMS Badge Maker — absorbed from Justin's standalone HTML tool.
 * CR80 (2.125 × 3.370 in) ID cards, printed directly to the Badgy.
 *
 * The roster now lives in Supabase (badge_agency singleton +
 * badge_people rows, admin-only RLS) and auto-saves as you type, so
 * any admin can reprint a badge from any machine. The file buttons
 * remain as import/export backup — same JSON shape as the old tool.
 *
 * Chromeless route: this is a full-viewport dark app with its own
 * print CSS (@page card size; the sidebar hides in print).
 */

interface BadgePerson {
  first: string
  last: string
  title: string
  badgeNo: string
  expires: string
  issued: string
  plevel: string
  level: string
  band: string
  bandLabel: string
  bandSub: string
  txLic: string
  rnLic: string
  nremt: string
  photo: string
  zoom: number
  posX: number
  posY: number
}

interface RosterRow {
  id: string | null
  data: BadgePerson
}

const BANDS: Record<string, { base: string; lift: string; deep: string; ink: string; hi: string; sheen: string }> = {
  gold: { base: '#D0901E', lift: '#EBB047', deep: '#A26A0C', ink: '#150E00', hi: 'rgba(255,255,255,.42)', sheen: 'rgba(255,255,255,.30)' },
  blue: { base: '#00397F', lift: '#1D5CAD', deep: '#00224F', ink: '#FFFFFF', hi: 'rgba(255,255,255,.24)', sheen: 'rgba(255,255,255,.16)' },
  red: { base: '#8E1F2A', lift: '#B93B45', deep: '#5F0F18', ink: '#FFFFFF', hi: 'rgba(255,255,255,.22)', sheen: 'rgba(255,255,255,.15)' },
  silver: { base: '#C6CDD9', lift: '#E9EDF3', deep: '#98A2B3', ink: '#0A1230', hi: 'rgba(255,255,255,.75)', sheen: 'rgba(255,255,255,.55)' },
  graphite: { base: '#3B4459', lift: '#5A6478', deep: '#242B3B', ink: '#FFFFFF', hi: 'rgba(255,255,255,.20)', sheen: 'rgba(255,255,255,.13)' },
}

const LEVELS: Record<string, { label: string; sub: string; band: string }> = {
  rn: { label: 'RN / Paramedic', sub: '', band: 'gold' },
  lp: { label: 'Paramedic', sub: '', band: 'gold' },
  cp: { label: 'Paramedic', sub: '', band: 'gold' },
  aemt: { label: 'Advanced EMT', sub: '', band: 'blue' },
  emt: { label: 'EMT', sub: '', band: 'silver' },
  emr: { label: 'EMR', sub: '', band: 'graphite' },
  support: { label: 'Support', sub: '', band: 'graphite' },
}

function blank(): BadgePerson {
  return {
    first: '', last: '', title: '', badgeNo: '', expires: '', issued: '', plevel: '',
    level: 'emt', band: 'auto', bandLabel: '', bandSub: '',
    txLic: '', rnLic: '', nremt: '',
    photo: '', zoom: 100, posX: 50, posY: 26,
  }
}

const auth = useAuthStore()
const isLive = !auth.usingDevStub

const agency = reactive({
  accent: 'rule',
  backStyle: 'light',
  medDir: 'A. Buzzard, MD',
  addr: 'Waller County EMS\n1134 Austin Street, Hempstead, TX 77445\n(979) 826-6063',
})

const roster = ref<RosterRow[]>([{ id: null, data: blank() }])
const cur = ref(0)
const loading = ref(isLive)
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let hydrating = true

const person = computed(() => roster.value[cur.value]?.data ?? blank())
const level = computed(() => LEVELS[person.value.level] ?? LEVELS.emt)
const band = computed(() => {
  const key = person.value.band === 'auto' ? level.value.band : person.value.band
  return BANDS[key] ?? BANDS.gold
})

const bandVars = computed(() => ({
  '--band': band.value.base,
  '--band-lift': band.value.lift,
  '--band-deep': band.value.deep,
  '--band-ink': band.value.ink,
  '--band-hi': band.value.hi,
  '--sheen': band.value.sheen,
  '--rule': agency.accent === 'rule' ? band.value.base : '#D0901E',
}))

const displayName = computed(() => {
  const initial = person.value.first ? person.value.first.trim().charAt(0).toUpperCase() + '. ' : ''
  return (initial + (person.value.last || '')).trim() || '—'
})
const nameSize = computed(() => (displayName.value.length > 13 ? '19px' : '24px'))

const bandLabel = computed(() => person.value.bandLabel || level.value.label)
const bandLabelSize = computed(() => {
  const n = bandLabel.value.length
  return n > 15 ? '13px' : n > 12 ? '15px' : n > 9 ? '16.5px' : '18px'
})
const bandSub = computed(() => person.value.bandSub || level.value.sub)

const backRows = computed(() => {
  const p = person.value
  const rows: Array<[string, string]> = [['Certification', bandLabel.value]]
  if (p.plevel) rows.push(['Provider Level', p.plevel])
  if (p.badgeNo) rows.push(['Badge Number', p.badgeNo])
  if (p.txLic) rows.push(['Texas DSHS License', p.txLic])
  if (p.rnLic) rows.push(['Texas BON / RN License', p.rnLic])
  if (p.nremt) rows.push(['National Registry', p.nremt])
  rows.push(['Medical Director', agency.medDir])
  return rows
})

function rosterName(r: RosterRow): string {
  const p = r.data
  return ((p.first ? p.first.charAt(0) + '. ' : '') + (p.last || '')).trim() || 'Untitled'
}
function rosterDot(r: RosterRow): string {
  const l = LEVELS[r.data.level] ?? LEVELS.emt
  const key = r.data.band === 'auto' ? l.band : r.data.band
  return (BANDS[key] ?? BANDS.gold).base
}

/* ── Persistence ────────────────────────────────────────────────────── */

async function load() {
  if (!isLive) {
    hydrating = false
    return
  }
  const [aRes, pRes] = await Promise.all([
    supabase.from('badge_agency').select('accent, back_style, med_dir, addr').eq('id', true).maybeSingle(),
    supabase.from('badge_people').select('id, data').order('created_at'),
  ])
  if (aRes.data) {
    agency.accent = aRes.data.accent
    agency.backStyle = aRes.data.back_style
    agency.medDir = aRes.data.med_dir
    agency.addr = aRes.data.addr
  }
  if (pRes.data?.length) {
    roster.value = pRes.data.map((r) => ({ id: r.id as string, data: { ...blank(), ...(r.data as BadgePerson) } }))
    cur.value = 0
  }
  loading.value = false
  setTimeout(() => { hydrating = false }, 0)
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function queueSavePerson(row: RosterRow) {
  if (!isLive || hydrating) return
  const key = row.id ?? 'new'
  const t = saveTimers.get(key)
  if (t) clearTimeout(t)
  saveTimers.set(key, setTimeout(() => void savePerson(row), 700))
  saveState.value = 'saving'
}

async function savePerson(row: RosterRow) {
  try {
    if (row.id) {
      const { error } = await supabase.from('badge_people').update({ data: row.data }).eq('id', row.id)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('badge_people').insert({ data: row.data }).select('id').single()
      if (error) throw error
      row.id = data.id as string
    }
    saveState.value = 'saved'
  } catch (err) {
    console.error('[badge-maker] save failed:', (err as Error).message)
    saveState.value = 'error'
  }
}

let agencyTimer: ReturnType<typeof setTimeout> | null = null
watch(agency, () => {
  if (!isLive || hydrating) return
  if (agencyTimer) clearTimeout(agencyTimer)
  saveState.value = 'saving'
  agencyTimer = setTimeout(async () => {
    const { error } = await supabase.from('badge_agency').upsert({
      id: true,
      accent: agency.accent,
      back_style: agency.backStyle,
      med_dir: agency.medDir,
      addr: agency.addr,
    })
    saveState.value = error ? 'error' : 'saved'
    if (error) console.error('[badge-maker] agency save failed:', error.message)
  }, 700)
})

watch(
  () => roster.value[cur.value]?.data,
  () => {
    const row = roster.value[cur.value]
    if (row) queueSavePerson(row)
  },
  { deep: true },
)

/* ── Roster actions ─────────────────────────────────────────────────── */

function addPerson() {
  roster.value.push({ id: null, data: blank() })
  cur.value = roster.value.length - 1
  const row = roster.value[cur.value]
  if (isLive) void savePerson(row)
}

function dupPerson() {
  const c: BadgePerson = JSON.parse(JSON.stringify(person.value))
  c.first = ''; c.last = ''; c.badgeNo = ''; c.photo = ''; c.txLic = ''; c.rnLic = ''; c.nremt = ''
  roster.value.push({ id: null, data: c })
  cur.value = roster.value.length - 1
  if (isLive) void savePerson(roster.value[cur.value])
}

async function delPerson() {
  const row = roster.value[cur.value]
  if (!confirm(`Delete ${rosterName(row)}'s badge?`)) return
  if (isLive && row.id) {
    const { error } = await supabase.from('badge_people').delete().eq('id', row.id)
    if (error) {
      saveState.value = 'error'
      return
    }
  }
  if (roster.value.length === 1) {
    roster.value = [{ id: null, data: blank() }]
    cur.value = 0
  } else {
    roster.value.splice(cur.value, 1)
    cur.value = Math.max(0, cur.value - 1)
  }
}

/* ── Photo ──────────────────────────────────────────────────────────── */

/** Downscale to ≤1000px tall JPEG so rows stay light (badge print
 *  needs far less than phone-camera resolution). */
function resizePhoto(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1000 / img.height)
      if (scale === 1 && dataUrl.length < 300_000) return resolve(dataUrl)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('unreadable image'))
    img.src = dataUrl
  })
}

function onPhotoFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  const r = new FileReader()
  r.onload = async () => {
    try {
      person.value.photo = await resizePhoto(r.result as string)
    } catch {
      alert("That image couldn't be read. Try a JPG or PNG.")
    }
  }
  r.onerror = () => alert("That image couldn't be read. Try a JPG or PNG.")
  r.readAsDataURL(f)
  input.value = ''
}

function onLevelChange() {
  person.value.bandLabel = ''
  person.value.bandSub = ''
}

/* ── Import / export (backup, same JSON shape as the old tool) ─────── */

function exportRoster() {
  const blobData = JSON.stringify(
    {
      agency: { accent: agency.accent, backStyle: agency.backStyle, medDir: agency.medDir, addr: agency.addr },
      roster: roster.value.map((r) => r.data),
    },
    null,
    2,
  )
  const url = URL.createObjectURL(new Blob([blobData], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'wcems-badge-roster.json'
  a.click()
  URL.revokeObjectURL(url)
}

function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  const r = new FileReader()
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result as string)
      if (!d.roster?.length) throw new Error('no roster')
      if (!confirm(`Replace the saved roster with ${d.roster.length} people from this file?`)) return
      if (d.agency) {
        agency.medDir = d.agency.medDir ?? agency.medDir
        agency.addr = d.agency.addr ?? agency.addr
        agency.backStyle = d.agency.backStyle ?? agency.backStyle
        agency.accent = d.agency.accent ?? agency.accent
      }
      if (isLive) {
        const oldIds = roster.value.map((row) => row.id).filter((id): id is string => !!id)
        if (oldIds.length) await supabase.from('badge_people').delete().in('id', oldIds)
      }
      roster.value = (d.roster as BadgePerson[]).map((p) => ({ id: null, data: { ...blank(), ...p } }))
      cur.value = 0
      if (isLive) for (const row of roster.value) await savePerson(row)
    } catch {
      alert("That file isn't a badge roster. Pick the JSON file saved by this tool.")
    }
  }
  r.readAsText(f)
  input.value = ''
}

/* ── Print ──────────────────────────────────────────────────────────── */

function printAs(mode: 'only-front' | 'only-back' | null) {
  document.body.classList.remove('only-front', 'only-back')
  if (mode) document.body.classList.add(mode)
  window.print()
}

onMounted(() => {
  /* Barlow Condensed isn't part of the portal font set. */
  if (!document.getElementById('badge-fonts')) {
    const link = document.createElement('link')
    link.id = 'badge-fonts'
    link.rel = 'stylesheet'
    link.href =
      'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap'
    document.head.appendChild(link)
  }
  window.addEventListener('afterprint', () => document.body.classList.remove('only-front', 'only-back'))
  void load()
})
</script>

<template>
  <div class="bm" :style="bandVars">
    <!-- ============ EDITOR ============ -->
    <aside class="side">
      <div class="topnav">
        <RouterLink to="/" class="backlink">← Portal</RouterLink>
        <span class="savestate" :class="`savestate--${saveState}`">
          {{ saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed — check connection' : '' }}
        </span>
      </div>
      <h1>WCEMS Badge Maker</h1>
      <p class="sub">CR80 · 2.125 × 3.370 in · prints direct to Badgy</p>

      <div class="sect">
        <h2>Roster</h2>
        <div v-if="loading" class="hint">Loading saved roster…</div>
        <div class="roster">
          <button
            v-for="(r, i) in roster"
            :key="r.id ?? `new-${i}`"
            class="person"
            :aria-current="i === cur"
            @click="cur = i"
          >
            <span class="dot" :style="{ background: rosterDot(r) }"></span>
            <span class="nm">{{ rosterName(r) }}</span>
            <span class="lv">{{ r.data.badgeNo }}</span>
          </button>
        </div>
        <div class="btns">
          <button @click="addPerson">Add person</button>
          <button class="ghost" @click="dupPerson">Duplicate</button>
          <button class="ghost danger" @click="delPerson">Delete</button>
        </div>
        <div class="btns" style="margin-top: 6px">
          <button class="ghost" @click="exportRoster">Save roster file</button>
          <label class="filebtn" style="flex: 1; padding: 9px; margin: 0" for="impFile">Load roster file</label>
          <input id="impFile" type="file" accept="application/json" @change="onImportFile" />
        </div>
        <p class="hint">
          Badges save automatically to the portal — any admin can open this page and reprint.
          The file buttons are a backup copy in the old tool's format.
        </p>
      </div>

      <div class="sect">
        <h2>Person</h2>
        <div class="row2">
          <div class="fld"><label>First name</label><input v-model="person.first" type="text" /></div>
          <div class="fld"><label>Last name</label><input v-model="person.last" type="text" /></div>
        </div>
        <div class="fld"><label>Title</label><input v-model="person.title" type="text" /></div>
        <div class="row2">
          <div class="fld"><label>Badge number</label><input v-model="person.badgeNo" type="text" /></div>
          <div class="fld"><label>Expires</label><input v-model="person.expires" type="text" placeholder="08 / 2028" /></div>
        </div>
        <div class="fld"><label>Provider level</label><input v-model="person.plevel" type="text" placeholder="P1C, P2, P4… (blank to hide)" /></div>
        <div class="fld"><label>Issued</label><input v-model="person.issued" type="text" placeholder="08.2026" /></div>
      </div>

      <div class="sect">
        <h2>Certification</h2>
        <div class="fld">
          <label>Level</label>
          <select v-model="person.level" @change="onLevelChange">
            <option value="rn">RN / Paramedic</option>
            <option value="lp">Licensed Paramedic</option>
            <option value="cp">Paramedic (certified)</option>
            <option value="aemt">Advanced EMT</option>
            <option value="emt">EMT</option>
            <option value="emr">EMR</option>
            <option value="support">Support / Admin</option>
          </select>
        </div>
        <div class="fld">
          <label>Level accent</label>
          <select v-model="agency.accent">
            <option value="rule">Band + header rule</option>
            <option value="band">Band only</option>
            <option value="stripe">Band + edge stripe</option>
          </select>
        </div>
        <div class="fld">
          <label>Band color</label>
          <select v-model="person.band">
            <option value="auto">Auto (from level)</option>
            <option value="gold">Gold</option>
            <option value="blue">Blue</option>
            <option value="red">Red</option>
            <option value="silver">Silver</option>
            <option value="graphite">Graphite</option>
          </select>
        </div>
        <div class="row2">
          <div class="fld"><label>Band text</label><input v-model="person.bandLabel" type="text" /></div>
          <div class="fld"><label>Small line</label><input v-model="person.bandSub" type="text" /></div>
        </div>
        <p class="hint">Band text and the small line are free text — override them any time the auto value isn't right.</p>
      </div>

      <div class="sect">
        <h2>Photo</h2>
        <label class="filebtn" for="photoFile">Choose headshot</label>
        <input id="photoFile" type="file" accept="image/*" @change="onPhotoFile" />
        <p class="hint">Best results: a 4:5 portrait (e.g. 1600 × 2000). Anything else gets cropped to 4:5 — use the sliders to place the face.</p>
        <div class="fld" style="margin-top: 9px">
          <label>Zoom</label>
          <div class="slider">
            <input v-model.number="person.zoom" type="range" min="100" max="220" />
            <span class="val">{{ (person.zoom / 100).toFixed(2) }}×</span>
          </div>
        </div>
        <div class="fld">
          <label>Vertical</label>
          <div class="slider">
            <input v-model.number="person.posY" type="range" min="0" max="100" />
            <span class="val">{{ person.posY }}%</span>
          </div>
        </div>
        <div class="fld">
          <label>Horizontal</label>
          <div class="slider">
            <input v-model.number="person.posX" type="range" min="0" max="100" />
            <span class="val">{{ person.posX }}%</span>
          </div>
        </div>
      </div>

      <div class="sect">
        <h2>Back of card</h2>
        <div class="fld"><label>Texas DSHS license #</label><input v-model="person.txLic" type="text" /></div>
        <div class="fld"><label>RN license # (BON)</label><input v-model="person.rnLic" type="text" /></div>
        <div class="fld"><label>NREMT #</label><input v-model="person.nremt" type="text" /></div>
        <p class="hint">Leave any of these blank and the row disappears from the card. Empty rows read as a printing error; a missing row reads as intentional.</p>
      </div>

      <div class="sect">
        <h2>Agency (applies to all)</h2>
        <div class="fld">
          <label>Back of card</label>
          <select v-model="agency.backStyle">
            <option value="light">White</option>
            <option value="navy">Navy</option>
          </select>
        </div>
        <div class="fld"><label>Medical director</label><input v-model="agency.medDir" type="text" /></div>
        <div class="fld"><label>Return-to address</label><textarea v-model="agency.addr" rows="3"></textarea></div>
      </div>
    </aside>

    <!-- ============ PREVIEW ============ -->
    <main class="stage">
      <div class="printbar btns" style="max-width: 420px">
        <button class="primary" @click="printAs('only-front')">Print front</button>
        <button @click="printAs('only-back')">Print back</button>
        <button class="ghost" @click="printAs(null)">Print both</button>
      </div>

      <div class="cards">
        <div class="stack f">
          <div class="card front" :class="{ 'accent-stripe': agency.accent === 'stripe' }">
            <div class="head navyfill">
              <img src="/badge-crest.png" alt="" />
              <div class="wm">
                <div class="l1">WALLER COUNTY</div>
                <div class="l2">EMERGENCY MEDICAL SERVICES</div>
              </div>
            </div>

            <div class="bodycol">
              <div class="stripe"></div>
              <div class="photowrap">
                <div class="photo" :class="{ empty: !person.photo }">
                  <img
                    v-if="person.photo"
                    :src="person.photo"
                    :style="{ transform: `scale(${person.zoom / 100})`, objectPosition: `${person.posX}% ${person.posY}%` }"
                    alt=""
                  />
                </div>
              </div>
              <div class="idblk">
                <div class="name" :style="{ fontSize: nameSize }">{{ displayName }}</div>
                <div class="subrow">
                  <div class="title">{{ person.title }}</div>
                  <div v-if="person.plevel" class="plevel"><span class="pk">Level</span><span>{{ person.plevel }}</span></div>
                </div>
              </div>
            </div>

            <div class="cert">
              <div class="lvl" :style="{ fontSize: bandLabelSize }">{{ bandLabel }}</div>
              <div v-if="bandSub" class="scope">{{ bandSub }}</div>
            </div>

            <div class="foot navyfill">
              <div class="field"><div class="k">Badge</div><div class="v">{{ person.badgeNo || '—' }}</div></div>
              <div class="field grow"><div class="k">Expires</div><div class="v">{{ person.expires || '—' }}</div></div>
              <div class="field"><div class="k">Issued</div><div class="v sm">{{ person.issued }}</div></div>
            </div>
          </div>
          <div class="cap">Front</div>
        </div>

        <div class="stack b">
          <div class="card back" :class="{ light: agency.backStyle === 'light', navyfill: agency.backStyle === 'navy' }">
            <div class="goldcap"></div>
            <div class="inner">
              <div class="eyebrow">Credential Record</div>
              <dl class="rows">
                <div v-for="row in backRows" :key="row[0]" class="rw">
                  <dt>{{ row[0] }}</dt>
                  <dd>{{ row[1] }}</dd>
                </div>
              </dl>

              <div class="ret">
                <div class="eyebrow">If found, return to</div>
                <div class="addr">{{ agency.addr }}</div>
              </div>

              <div class="notice">
                <b>Practices under the delegated authority</b> of the WCEMS medical director,
                within current clinical protocols. This card is agency property and is not a
                license to practice.
              </div>

              <div class="bfoot">
                <img src="/badge-crest.png" alt="" />
              </div>
            </div>
          </div>
          <div class="cap">Back</div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.bm {
  --navy: #0a1230;
  --navy-lift: #1b2a57;
  --navy-deep: #050a1c;
  --blue: #00397f;
  --gold: #d0901e;
  --paper: #f7f8fa;
  --card-ink: #141a28;
  --ui-bg: #0b1020;
  --ui-panel: #121a2f;
  --ui-line: rgba(255, 255, 255, 0.1);
  --ui-text: #dce3f0;
  --ui-dim: #8592ac;

  display: grid;
  grid-template-columns: 360px 1fr;
  min-height: 100dvh;
  background: var(--ui-bg);
  color: var(--ui-text);
  font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
}
@media (max-width: 900px) {
  .bm {
    grid-template-columns: 1fr;
  }
}

.side {
  background: var(--ui-panel);
  border-right: 1px solid var(--ui-line);
  padding: 20px 18px 60px;
  overflow-y: auto;
  max-height: 100dvh;
}
@media (max-width: 900px) {
  .side {
    max-height: none;
  }
}
.stage {
  padding: 34px 24px 70px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 26px;
  background: radial-gradient(900px 500px at 50% 0%, #15203f 0%, #0b1020 70%);
}

.topnav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.backlink {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ui-dim);
  text-decoration: none;
}
.backlink:hover {
  color: #fff;
}
.savestate {
  font-family: 'Geist Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.savestate--saving { color: var(--ui-dim); }
.savestate--saved { color: #67c98a; }
.savestate--error { color: #e2606c; }

h1 { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; margin: 0 0 3px; }
.sub { font-size: 11px; color: var(--ui-dim); margin: 0 0 18px; }

.sect { margin-bottom: 20px; }
.sect > h2 {
  font-family: 'Geist Mono', monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold);
  margin: 0 0 9px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--ui-line);
}
label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-dim);
  margin: 0 0 4px;
  font-weight: 500;
}
input[type='text'],
select,
textarea {
  width: 100%;
  background: #0d1426;
  border: 1px solid var(--ui-line);
  border-radius: 7px;
  color: var(--ui-text);
  font: 400 13px/1.3 'Geist', sans-serif;
  padding: 8px 9px;
}
input[type='text']:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--gold);
}
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.fld { margin-bottom: 9px; }
.hint { font-size: 10px; color: var(--ui-dim); margin-top: 4px; line-height: 1.45; }

button {
  font: 500 12px/1 'Geist', sans-serif;
  letter-spacing: 0.02em;
  cursor: pointer;
  background: #1c2540;
  color: var(--ui-text);
  border: 1px solid var(--ui-line);
  border-radius: 7px;
  padding: 9px 11px;
  transition: background 0.15s, border-color 0.15s;
}
button:hover { background: #26314f; }
button:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
button.primary { background: var(--gold); color: #160f02; border-color: transparent; font-weight: 600; }
button.primary:hover { background: #e5a12a; }
button.ghost { background: transparent; }
button.danger:hover { background: #4a1620; border-color: #7e2230; }
.btns { display: flex; gap: 6px; flex-wrap: wrap; }
.btns button { flex: 1; min-width: 78px; }

.roster { display: flex; flex-direction: column; gap: 4px; margin-bottom: 9px; max-height: 190px; overflow-y: auto; }
.person {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  width: 100%;
  padding: 7px 9px;
  border-radius: 7px;
  background: transparent;
  border: 1px solid transparent;
}
.person:hover { background: #1a2440; }
.person[aria-current='true'] { background: #1c2748; border-color: var(--gold); }
.person .dot { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.person .nm { font-size: 12.5px; font-weight: 500; color: #fff; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.person .lv { font-family: 'Geist Mono', monospace; font-size: 9px; color: var(--ui-dim); flex: none; }

.slider { display: flex; align-items: center; gap: 9px; }
.slider input[type='range'] { flex: 1; accent-color: var(--gold); }
.slider .val { font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--ui-dim); width: 34px; text-align: right; }

.filebtn {
  display: block;
  text-align: center;
  padding: 9px;
  border: 1px dashed rgba(255, 255, 255, 0.22);
  border-radius: 7px;
  font-size: 12px;
  color: var(--ui-dim);
  cursor: pointer;
}
.filebtn:hover { border-color: var(--gold); color: #fff; }
input[type='file'] { display: none; }

/* ================= CARDS ================= */
.cards { display: flex; gap: 30px; flex-wrap: wrap; justify-content: center; }
.stack { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.cap { font-family: 'Geist Mono', monospace; font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ui-dim); }

.card {
  position: relative;
  width: 2.125in;
  height: 3.37in;
  border-radius: 0.11in;
  overflow: hidden;
  background: var(--paper);
  color: var(--card-ink);
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 54px -20px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.08);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.navyfill {
  position: relative;
  background:
    linear-gradient(103deg, transparent 34%, rgba(255, 255, 255, 0.055) 47%, transparent 60%),
    linear-gradient(168deg, var(--navy-lift) 0%, var(--navy) 46%, var(--navy-deep) 100%);
}
.navyfill::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.13);
}

.head { padding: 8px 10px 7px; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--rule); }
.head img { width: 30px; height: auto; flex: none; position: relative; z-index: 1; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55)); }
.wm { line-height: 1; position: relative; z-index: 1; }
.wm .l1 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13.5px; letter-spacing: 0.06em; color: #fff; white-space: nowrap; }
.wm .l2 { font-family: 'Geist Mono', monospace; font-weight: 500; font-size: 4.7px; letter-spacing: 0.155em; color: var(--gold); margin-top: 2.5px; white-space: nowrap; }

.bodycol { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.front.accent-stripe .stripe { display: block; }
.front.accent-stripe .idblk,
.front.accent-stripe .photowrap { padding-left: 6px; }
.stripe {
  display: none;
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  z-index: 3;
  background: var(--band);
  box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.16), inset 1px 0 0 rgba(255, 255, 255, 0.22);
}

.photowrap { flex: none; padding: 7px 0 7px; display: flex; justify-content: center; background: #f2f4f8; }
.photo { position: relative; width: 1.224in; height: 1.53in; background: #d9dfe8; overflow: hidden; flex: none; box-shadow: 0 0 0 1px rgba(10, 18, 48, 0.28); }
.photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; transform-origin: center; }
.photo.empty::before {
  content: 'PHOTO';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Geist Mono', monospace;
  font-size: 8px;
  letter-spacing: 0.3em;
  color: #96a0b2;
}

.idblk { padding: 7px 9px 7px 12px; flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; min-height: 0.5in; }
.subrow { display: flex; align-items: baseline; justify-content: space-between; gap: 9px; margin-top: 5px; }
.subrow .title { margin-top: 0 !important; flex: 1; min-width: 0; }
.plevel {
  flex: none;
  font-family: 'Geist Mono', monospace;
  font-weight: 600;
  font-size: 8px;
  letter-spacing: 0.05em;
  color: var(--navy);
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
}
.plevel .pk { font-size: 5px; letter-spacing: 0.18em; color: #8792a8; font-weight: 500; margin-right: 3px; }
.name {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  white-space: nowrap;
  font-size: 24px;
  line-height: 1;
  letter-spacing: 0.005em;
  color: var(--navy);
  text-transform: uppercase;
}
.title { font-size: 6.4px; margin-top: 5px !important; line-height: 1.35; letter-spacing: 0.055em; text-transform: uppercase; color: #59647e; font-weight: 500; }

.cert {
  position: relative;
  color: var(--band-ink);
  padding: 6px 10px 6px 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1.5px;
  flex-wrap: nowrap;
  background:
    linear-gradient(101deg, transparent 30%, var(--sheen) 48%, transparent 66%),
    linear-gradient(168deg, var(--band-lift) 0%, var(--band) 52%, var(--band-deep) 100%);
  box-shadow: inset 0 1px 0 var(--band-hi), inset 0 -1px 0 rgba(0, 0, 0, 0.22);
}
.cert .lvl { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; line-height: 0.9; letter-spacing: 0.035em; text-transform: uppercase; font-size: 18px; position: relative; z-index: 1; white-space: nowrap; }
.cert .scope { font-family: 'Geist Mono', monospace; font-size: 5px; font-weight: 600; letter-spacing: 0.15em; opacity: 0.72; white-space: nowrap; position: relative; z-index: 1; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

.foot { padding: 6px 10px 7px 12px; display: flex; gap: 9px; }
.foot .field { position: relative; z-index: 1; }
.foot .field.grow { flex: 1; min-width: 0; }
.k { font-family: 'Geist Mono', monospace; font-size: 4.6px; font-weight: 500; letter-spacing: 0.2em; color: var(--gold); text-transform: uppercase; }
.v { font-family: 'Geist Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: 0.03em; color: #fff; margin-top: 2.5px; white-space: nowrap; }
.v.sm { font-size: 7.4px; font-weight: 500; color: #d7deec; }

/* ---- back ---- */
.card.back { color: #fff; }
.back .goldcap { height: 4px; background: linear-gradient(90deg, #b4780f, var(--gold), #b4780f); position: relative; z-index: 1; flex: none; }
.back .inner { padding: 14px 12px 12px; display: flex; flex-direction: column; flex: 1; position: relative; z-index: 1; }
.eyebrow { font-family: 'Geist Mono', monospace; font-size: 4.8px; font-weight: 600; letter-spacing: 0.2em; color: var(--gold); text-transform: uppercase; }
.rows { margin: 6px 0 0; border-top: 1px solid rgba(255, 255, 255, 0.14); }
.rw { display: flex; justify-content: space-between; gap: 8px; padding: 4.5px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.14); }
.rw dt { font-size: 6.2px; letter-spacing: 0.07em; text-transform: uppercase; color: #93a0bb; font-weight: 500; margin: 0; }
.rw dd { margin: 0; font-family: 'Geist Mono', monospace; font-size: 6.8px; font-weight: 500; color: #fff; text-align: right; }
.ret { margin-top: 12px; }
.ret .addr { font-family: 'Geist Mono', monospace; font-size: 6.1px; line-height: 1.7; color: #c6d0e4; margin-top: 5px; white-space: pre-line; }
.notice { margin-top: auto; background: rgba(208, 144, 30, 0.13); border-left: 2px solid var(--gold); padding: 6px 7px; font-size: 5.8px; line-height: 1.5; color: #d9e1f0; }
.notice b { color: #fff; font-weight: 600; }
.bfoot { margin-top: 9px; display: flex; justify-content: flex-end; align-items: flex-end; }
.bfoot img { width: 26px; height: auto; opacity: 0.92; }

/* --- light back: same layout, paper stock --- */
.card.back.light { background: var(--paper); color: var(--card-ink); }
.back.light .eyebrow { color: #8a6714; }
.back.light .rows { border-top-color: rgba(10, 18, 48, 0.16); }
.back.light .rw { border-bottom-color: rgba(10, 18, 48, 0.16); }
.back.light .rw dt { color: #5b6883; }
.back.light .rw dd { color: var(--navy); }
.back.light .ret .addr { color: #3b4762; }
.back.light .notice { background: #fbf6e9; color: #3b4762; border-left-color: #b4780f; }
.back.light .notice b { color: var(--navy); }
.back.light .bfoot img { opacity: 1; }

/* ================= PRINT ================= */
@media print {
  .bm { display: block; background: #fff; min-height: 0; }
  .side, .cap, .printbar { display: none !important; }
  .stage { padding: 0; background: #fff; display: block; }
  .cards { display: block; gap: 0; }
  .stack { display: block; }
  .card {
    box-shadow: none;
    border-radius: 0;
    margin: 0;
    page-break-after: always;
    break-after: page;
    /* Bleed: render ~3% oversized so artwork runs past the card edge
       and the Badgy inks to its physical limit. The Badgy 100 always
       keeps a hairline white border (hardware); this keeps it as thin
       and even as the printer allows. */
    transform: scale(1.03);
    transform-origin: center center;
  }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
</style>

<style>
/* Unscoped: print-mode body classes + card size. The only-front/back
   classes are toggled on <body> by the print buttons. */
@media print {
  body.only-front .stack.b,
  body.only-back .stack.f {
    display: none !important;
  }
  @page {
    size: 2.125in 3.37in;
    margin: 0;
  }
}
</style>
