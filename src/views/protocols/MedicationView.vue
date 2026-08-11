<template>
  <div class="med-page">
    <div class="med-hdr">
      <button class="back-btn" @click="goBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="m15 18-6-6 6-6"/>
        </svg>
        Medications
      </button>
      <div v-if="med.alt_name" class="med-alt">{{ med.alt_name }}</div>
      <h1 class="med-title">{{ med.name }}</h1>
      <div v-if="med.type" class="med-type">{{ med.type }}</div>
    </div>

    <div v-if="loading" class="state-message">Loading...</div>

    <div v-else class="med-content">
      <section v-if="med.indications" class="card">
        <div class="card-label">INDICATIONS</div>
        <div class="card-body">
          <BulletedList :text="med.indications" />
        </div>
      </section>

      <section v-if="med.contraindications" class="card card-warn">
        <div class="card-label">CONTRAINDICATIONS</div>
        <div class="card-body">
          <BulletedList :text="med.contraindications" />
        </div>
      </section>

      <section v-if="med.side_effects" class="card">
        <div class="card-label">SIDE EFFECTS</div>
        <div class="card-body">
          <BulletedList :text="med.side_effects" />
        </div>
      </section>

      <section v-if="med.dosage_routes" class="card card-dose">
        <div class="card-label">DOSAGE &amp; ROUTES</div>
        <div class="dose-groups">
          <div v-for="(g, gi) in dosageGroups" :key="gi" class="dose-group">
            <div v-if="g.header" class="dose-group-header">{{ g.header }}</div>
            <template v-for="(item, li) in g.lines" :key="li">
              <div v-if="item.type === 'subheader'" class="dose-subheader">{{ item.text }}</div>
              <div v-else-if="item.type === 'scenario'" class="dose-scenario">{{ item.text }}</div>
              <div v-else-if="item.type === 'separator'" class="dose-separator">{{ item.text }}</div>
              <div v-else-if="item.type === 'criteria'" class="dose-criteria">
                <span class="dose-criteria-tag">IF</span>
                <span v-html="highlightDoses(item.text)"></span>
              </div>
              <div v-else-if="item.type === 'dose'" class="dose-bullet">
                <span v-if="item.label" class="dose-label">{{ item.label }} </span><span v-html="highlightDoses(item.value)"></span>
              </div>
              <div v-else class="dose-bullet dose-bullet-note" v-html="highlightDoses(item.text)"></div>
            </template>
          </div>
        </div>
      </section>

      <section v-if="med.notes" class="card card-notes">
        <div class="card-label">NOTES</div>
        <div class="card-body">
          <BulletedList :text="med.notes" />
        </div>
      </section>

      <section v-if="med.min_certification" class="card cert-card">
        <div class="card-label">MINIMUM CERTIFICATION</div>
        <div class="cert-body">
          <div v-for="(line, i) in certLines" :key="i" class="cert-line">{{ line }}</div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '@/lib/supabaseProtocols'

const BulletedList = {
  props: { text: { type: String, required: true } },
  setup(props) {
    return () => {
      const lines = props.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      const out = []
      let currentList = []
      const flush = () => {
        if (currentList.length) {
          out.push(h('ul', { class: 'bullets' },
            currentList.map(item => h('li', null, item))
          ))
          currentList = []
        }
      }
      for (const line of lines) {
        if (line.endsWith(':')) {
          flush()
          out.push(h('div', { class: 'subhead' }, line))
        } else {
          currentList.push(line)
        }
      }
      flush()
      return out
    }
  },
}

const route = useRoute()
const router = useRouter()
const med = ref({})
const loading = ref(true)

const DOSE_UNIT_RE = /\b\d+(\.\d+)?\s*(mg|mcg|ug|ml|mL|g|grams?|units?|mEq|joules?|J|cc)\b/i
const SUBHEADER_RE = /^(adults?|pediatrics?|children|infants?|neonates?|geriatric|elderly)\b/i
const NOTE_PREFIX_RE = /^(May|Repeat|Refer|See|Do(\s+not)?\b|Confirm|Based|Titrate|Continue|Discontinue|Single|Onset|Duration|Use|Avoid|Inject|Q\b|q\b)/

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Wrap dose patterns (numbers + units, with optional /kg, /min, /hr) in gold span.
// Matches the highlightDrugs treatment in Protocol.vue.
function highlightDoses(text) {
  if (!text) return ''
  let out = escapeHtml(text)
  out = out.replace(
    /\b(\d+(?:\.\d+)?(?:\s*(?:to|-|–|—)\s*\d+(?:\.\d+)?)?\s*(?:mcg|ug|mg|ml|mL|g|grams?|units?|mEq|joules?|J|cc)(?:\/(?:kg|dl|L|hr|hour|min|minute|minutes|hours))*)\b/gi,
    '<em class="dose-hl">$1</em>'
  )
  // Ratio doses like 1:10,000 / 1:1,000
  out = out.replace(
    /\b(\d+:\d{1,3}(?:,\d{3})*)\b/g,
    '<em class="dose-hl">$1</em>'
  )
  return out
}

function classifyLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return []
  // Standalone "OR" / "AND" between alternative doses
  if (/^(or|and|&)$/i.test(trimmed)) {
    return [{ type: 'separator', text: trimmed.toUpperCase() }]
  }
  // Conditional criteria — "If X..."
  if (/^if\b/i.test(trimmed)) {
    return [{ type: 'criteria', text: trimmed.replace(/^if\s+/i, '') }]
  }
  // "label: value" with at least 2-space gap (label-aligned) → dose
  const dl = trimmed.match(/^([A-Za-z][^:]{1,40}):\s{2,}(.+)$/)
  if (dl && DOSE_UNIT_RE.test(dl[2])) {
    return [{ type: 'dose', label: dl[1].trim() + ':', value: dl[2].trim() }]
  }
  // Lines starting with Adult(s) / Pediatric(s) / Children / Infant(s) / etc.
  const sub = trimmed.match(/^(Adults?|Pediatrics?|Children(?:\s+and\s+Infants?)?|Infants?|Neonates?|Geriatric|Elderly)\b(.*)$/i)
  if (sub) {
    const head = sub[1]
    const rest = sub[2].trim()
    // Pure subheader (no remainder, parenthetical qualifier, or short non-dose)
    if (!rest) return [{ type: 'subheader', text: trimmed }]
    if (rest.startsWith('(')) return [{ type: 'subheader', text: trimmed }]
    if (!DOSE_UNIT_RE.test(rest) && rest.length < 30) {
      return [{ type: 'subheader', text: trimmed }]
    }
    // "Pediatric 1:10,000 0.01 mg/kg…" → split into subheader + dose
    return [
      { type: 'subheader', text: head },
      { type: 'dose', label: '', value: rest },
    ]
  }
  // Lines containing dose units → dose value (no label)
  if (DOSE_UNIT_RE.test(trimmed)) {
    return [{ type: 'dose', label: '', value: trimmed }]
  }
  // Instruction prose (starts with imperative verb)
  if (NOTE_PREFIX_RE.test(trimmed)) {
    return [{ type: 'note', text: trimmed }]
  }
  // Short, no-dose, no-verb lines → scenario sub-block header
  const words = trimmed.split(/\s+/).length
  if (words <= 7 && trimmed.length < 70) {
    return [{ type: 'scenario', text: trimmed }]
  }
  return [{ type: 'note', text: trimmed }]
}

function looksLikeBlockHeader(line) {
  const t = line.trim()
  if (!t) return false
  if (SUBHEADER_RE.test(t)) return false
  if (t.endsWith(':')) return true
  // Strip parentheticals — they often contain dose-like info in scenario titles
  // e.g., "Respiratory distress (max 1.5mg)" — the scenario name is the header.
  const stripped = t.replace(/\s*\([^)]*\)/g, '').trim()
  if (DOSE_UNIT_RE.test(stripped)) return false
  if (stripped.length === 0) return false
  if (stripped.length < 80) return true
  return false
}

const certLines = computed(() => {
  const text = med.value?.min_certification || ''
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
})

const dosageGroups = computed(() => {
  const text = med.value?.dosage_routes || ''
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return blocks.map(block => {
    const raw = block.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '')
    if (raw.length === 0) return null
    let header = null
    let body = raw
    if (raw.length > 1 && looksLikeBlockHeader(raw[0])) {
      header = raw[0].trim().replace(/:$/, '')
      body = raw.slice(1)
    }
    const lines = body.flatMap(classifyLine)
    return { header, lines }
  }).filter(Boolean)
})

async function loadMed(id) {
  loading.value = true
  const cacheKey = `wcems_med_${id}`
  const cached = localStorage.getItem(cacheKey)
  if (cached) {
    med.value = JSON.parse(cached)
    loading.value = false
  }
  const { data, error } = await supabase
    .from('medication_details')
    .select('*')
    .eq('id', id)
    .single()
  if (!error && data) {
    med.value = data
    localStorage.setItem(cacheKey, JSON.stringify(data))
  }
  loading.value = false
}

function goBack() {
  router.push({ path: '/protocols', query: { tab: 'medications' } })
}

onMounted(() => loadMed(route.params.id))
watch(() => route.params.id, (id) => { if (id) loadMed(id) })
</script>

<style scoped>
.med-page {
  min-height: 100vh;
  background: var(--navy);
}

.med-hdr {
  background: var(--navy-mid);
  padding-top: calc(env(safe-area-inset-top, 0px) + 12px);
  padding-bottom: 16px;
  padding-left: 20px;
  padding-right: 20px;
  border-bottom: 1px solid var(--border);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  color: var(--gold);
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 12px;
  padding: 0;
}

.back-btn svg {
  width: 16px;
  height: 16px;
}

.med-alt {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 2px;
}

.med-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--white);
  letter-spacing: 0.02em;
  margin-bottom: 8px;
  text-transform: uppercase;
  line-height: 1.2;
}

.med-type {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  color: var(--gold);
  background: rgba(201, 168, 76, 0.12);
  border: 1px solid rgba(201, 168, 76, 0.3);
  padding: 4px 10px;
  border-radius: 4px;
  white-space: pre-line;
  line-height: 1.4;
}

.med-content {
  padding: 14px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
}

.card-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
  margin-bottom: 8px;
}

.card-body {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
}

.card-warn {
  background: rgba(220, 50, 50, 0.08);
  border-color: rgba(220, 50, 50, 0.3);
}

.card-warn .card-label {
  color: #ff8080;
}

.card-dose .card-label {
  color: var(--gold-light);
}

.card-notes {
  background: rgba(201, 168, 76, 0.06);
  border-color: rgba(201, 168, 76, 0.25);
}

.card-notes .card-body {
  font-weight: 500;
  color: var(--white);
}

.cert-card {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
}

.cert-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cert-line {
  font-size: 13px;
  color: var(--white);
  line-height: 1.5;
  font-weight: 500;
}

.state-message {
  padding: 32px 20px;
  text-align: center;
  color: var(--text-muted);
}

/* Bulleted list rendering inside cards */
.card-body :deep(.bullets) {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.card-body :deep(.bullets li) {
  position: relative;
  padding-left: 14px;
}

.card-body :deep(.bullets li::before) {
  content: '\2022';
  position: absolute;
  left: 0;
  color: var(--gold);
  font-weight: 700;
  top: 0;
  line-height: 1.5;
}

.card-body :deep(.subhead) {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--gold-light);
  text-transform: uppercase;
  margin: 10px 0 4px;
}

.card-body :deep(.subhead:first-child) {
  margin-top: 0;
}

.card-body :deep(.subhead + .bullets) {
  margin-top: 2px;
}

/* Dosage groups */
.dose-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dose-group {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 2px solid var(--gold);
  border-radius: 0 6px 6px 0;
}

.dose-group-header {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--gold);
  text-transform: uppercase;
  margin-bottom: 6px;
}

.dose-subheader {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--gold-light);
  text-transform: uppercase;
  margin: 8px 0 4px;
}

.dose-subheader:first-child {
  margin-top: 0;
}

.dose-scenario {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: var(--gold-light);
  text-transform: uppercase;
  margin: 8px 0 2px;
  padding-top: 6px;
  border-top: 1px solid rgba(201, 168, 76, 0.15);
}

.dose-scenario:first-child,
.dose-subheader + .dose-scenario {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.dose-bullet {
  position: relative;
  padding-left: 16px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--white);
  font-weight: 500;
  margin: 3px 0;
}

.dose-bullet::before {
  content: '\2022';
  position: absolute;
  left: 0;
  top: 0;
  color: var(--gold);
  font-weight: 700;
  line-height: 1.5;
}

.dose-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.dose-bullet-note {
  font-style: italic;
  color: var(--text-muted);
}

/* Inline gold highlight on dose amounts within text (matches Protocol.vue em) */
.dose-bullet :deep(.dose-hl),
.dose-criteria :deep(.dose-hl) {
  color: var(--gold-light);
  font-style: normal;
  font-weight: 600;
}

/* Conditional criteria — "IF" badge + condition text */
.dose-criteria {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 4px 0 4px 16px;
  padding: 6px 10px;
  border-left: 2px solid rgba(201, 168, 76, 0.35);
  background: rgba(201, 168, 76, 0.04);
  border-radius: 0 4px 4px 0;
}

.dose-criteria-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
  background: rgba(201, 168, 76, 0.15);
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
  margin-top: 2px;
}

.dose-separator {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
  text-align: center;
  margin: 6px 0 4px;
  position: relative;
}

.dose-separator::before,
.dose-separator::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 30%;
  height: 1px;
  background: rgba(201, 168, 76, 0.35);
}

.dose-separator::before { left: 0; }
.dose-separator::after { right: 0; }
</style>
