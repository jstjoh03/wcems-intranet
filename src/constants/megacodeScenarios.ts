/**
 * Megacode scenario bank + evaluation form, transcribed 1:1 from the
 * v1.0 examiner sheets (FTEP - Current Documents (v1.0)\Forms\Megacode
 * Scenarios) and the WCEMS Megacode Evaluation form. The scenario
 * script renders on the EXAMINER's device only — the candidate never
 * sees it. Scoring mirrors the paper form: all of Section 1 and 3,
 * at least three rhythms, and no automatic fail.
 */

export interface MegacodeVitals {
  cols: [string, string, string]
  rows: { label: string; cells: [string, string, string] }[]
}

export interface MegacodePhase {
  title: string
  vitals?: MegacodeVitals
  expected: string
  trigger?: string
}

export interface MegacodeScenario {
  key: string
  no: number
  title: string
  summary: string
  dispatch: string
  phases: MegacodePhase[]
  branches: { path: 'A' | 'B'; text: string }[]
  scoringNote: string
  prompts: string
}

export const MEGACODE_SCENARIOS: MegacodeScenario[] = [
  {
    key: 'mc1',
    no: 1,
    title: 'Weak All Morning',
    summary: '62 y/o female · bradycardia → VF arrest → branched outcome · 3 rhythms',
    dispatch:
      'Weakness, unknown problem. Found sitting upright on the couch: pale, cool skin, answers slowly but appropriately. Weak all morning, mild lightheadedness, no chest pain. Meds: metoprolol, lisinopril. 12-lead: no STEMI.',
    phases: [
      {
        title: 'Phase 1 — Rhythm 1: 3rd degree block',
        vitals: {
          cols: ['Initial', 'After atropine', 'If pacing captures'],
          rows: [
            { label: 'HR / rhythm', cells: ['34 — 3rd degree block, ventricular escape', '32 — no effect', 'Paced rate with electrical + mechanical capture'] },
            { label: 'BP', cells: ['74/46', '70/44', '96/58'] },
            { label: 'RR / SpO2', cells: ['18 / 91% RA', '18 / 93% on O2', '16 / 96%'] },
            { label: 'GCS / BGL', cells: ['14 (slow answers) / 104', '13, drowsier', '14'] },
          ],
        },
        expected:
          'Early monitor; recognizes 3rd degree block; 12-lead acquired; IV; O2. Atropine 1 mg is an acceptable attempt but ineffective (teaching point: high grade block). Moves to transcutaneous pacing with midazolam 2 mg for sedation per 2.13; pads on early.',
        trigger:
          'DETERIORATION TRIGGER — as pacing is being set up, or if pacing is delayed to repeat atropine: she slumps over, pulseless. Monitor: VF (Rhythm 2).',
      },
      {
        title: 'Phase 2 — Arrest',
        expected:
          'Verbalizes pulselessness; immediate compressions; LUCAS when available; defibrillation 125 J then 150/200 J; epinephrine 1 mg every 3–5 minutes; amiodarone 300 mg; BIAD or ETT with waveform ETCO2; minimal interruptions. ETCO2 18–22 with good compressions, 8 if quality slides.',
      },
    ],
    branches: [
      {
        path: 'A',
        text:
          'Treated appropriately (timely shocks, epi on schedule, quality CPR): VF converts to PEA — Rhythm 3 (organized narrow complex at 76, no pulse, ETCO2 24). Expect: continue CPR, epinephrine, causes verbalized — beta blocker toxicity is the plant; accept calcium consideration and fluids. One more quality round → ROSC: pulse present, HR 92, BP 82/50, ETCO2 jumps to 44. Expect per 2.40: pads stay on, full vitals, 12-lead, 250 mL bolus, airway reassessment, transport. End.',
      },
      {
        path: 'B',
        text:
          'Gaps (shock delayed >60 sec, missed epi, CPR interruptions >10 sec): VF degrades to asystole — Rhythm 3 (confirmed in two leads, ETCO2 9). Expect: epinephrine, bicarbonate/calcium consideration, causes. If they tighten up, hold one round then end with an OLMC consult for direction — no field termination on standing order. No ROSC on this path. End.',
      },
    ],
    scoringNote:
      'The block, VF, and PEA (or asystole) are the three rhythms on the evaluation form. Path B typically also documents the automatic fails: ineffective compressions >10 seconds, two or more mistreated rhythms.',
    prompts:
      '“Family asks why she keeps getting sleepier” (nudge toward pacing) · “Your partner asks what the rhythm is now” (force verbalization) · “The compressor says their arms are tired” (rotation / LUCAS).',
  },
  {
    key: 'mc2',
    no: 2,
    title: 'Heart Racing at Work',
    summary: '51 y/o female · unstable SVT → VF arrest → branched outcome · 3 rhythms',
    dispatch:
      'Palpitations and near-syncope at an office. Found seated, anxious, pale, diaphoretic. Sudden onset 30 minutes ago with chest pressure. Hx: hypothyroidism (levothyroxine); several energy drinks today. Monitor: narrow regular tachycardia at 188. 12-lead: SVT, no delta waves, no STEMI.',
    phases: [
      {
        title: 'Phase 1 — Rhythm 1: SVT (unstable)',
        vitals: {
          cols: ['Initial', 'After vagal / 500 mL bolus', 'If cardioverted'],
          rows: [
            { label: 'HR / rhythm', cells: ['188 — narrow, regular', '190 — no change', 'Sinus 96'] },
            { label: 'BP', cells: ['78/50', '74/48', '104/66'] },
            { label: 'RR / SpO2', cells: ['22 / 94% RA', '22 / 94% on O2', '18 / 98%'] },
            { label: 'GCS / BGL', cells: ['15, anxious / 118', '14, drowsier', '15'] },
          ],
        },
        expected:
          'Early monitor and 12-lead; recognizes UNSTABLE SVT per 2.48 (SBP <100 with chest pressure). Vagal maneuvers while preparing. IV, 500 mL bolus, pads on early. Synchronized cardioversion 125 J, then 150 J, then 200 J. Teaching point: she is hypotensive, so NO midazolam sedation per 2.48. Verbalizes SYNC before every cardioversion.',
        trigger:
          'DETERIORATION TRIGGER — as the second cardioversion is charging, or if cardioversion is delayed while the trainee hunts for a medication 2.48 does not carry: she slumps, pulseless. Monitor: VF (Rhythm 2).',
      },
      {
        title: 'Phase 2 — Arrest',
        expected:
          'Verbalizes pulselessness; immediate compressions; LUCAS when available; defibrillation 125 J then 150/200 J (sync OFF — classic trap after cardioverting); epinephrine 1 mg every 5 minutes; amiodarone 300 mg, repeat 150 mg in 10 minutes; i-GEL or ETT with waveform ETCO2; minimal interruptions.',
      },
    ],
    branches: [
      {
        path: 'A',
        text:
          'Treated appropriately (timely shocks, sync off, epi on schedule, amiodarone): VF converts to PEA — Rhythm 3 (narrow complex at 90, no pulse, ETCO2 26). Continue CPR and epinephrine; verbalize H’s and T’s. One more quality round → ROSC: pulse present, HR 92, BP 88/54, ETCO2 jumps to 46. Expect per 2.40: pads stay on, full vitals, 12-lead, 250 mL bolus if indicated, amiodarone 150 mg infusion over 10 minutes, airway reassessment, transport. End.',
      },
      {
        path: 'B',
        text:
          'Gaps (shock delayed >60 sec, sync left ON in VF, sedation given to a hypotensive patient, CPR interruptions >10 sec): VF degrades to asystole — Rhythm 3 (confirmed in two leads, ETCO2 8). Expect: epinephrine, bicarbonate consideration for prolonged downtime, causes verbalized. If they tighten up, hold one round then end with an OLMC consult for direction — no field termination on standing order. No ROSC on this path. End.',
      },
    ],
    scoringNote:
      'The SVT, VF, and PEA (or asystole) are the three rhythms on the evaluation form. Path B typically also documents: sync not verbalized, mistreated rhythm, sedation of a hypotensive patient.',
    prompts:
      '“Her coworker asks why you are putting stickers on her chest” (nudge toward pads early) · “Your partner asks if you want the sync on” (force the decision out loud) · “She says she feels like she is going to pass out” (urgency toward cardioversion).',
  },
  {
    key: 'mc3',
    no: 3,
    title: 'Two Missed Treatments',
    summary: '58 y/o male · ESRD hyperkalemia → PEA arrest → branched outcome · 3 rhythms',
    dispatch:
      'Sick person. Found in a recliner, weak and nauseated, states he missed dialysis Thursday and Saturday. Left forearm fistula. Pale, cool skin. Meds: lisinopril, spironolactone. Monitor: wide regular bradycardia in the 40s, QRS ≈160 ms, tall peaked T waves. 12-lead: no STEMI, near sine-wave morphology.',
    phases: [
      {
        title: 'Phase 1 — Rhythm 1: wide-complex bradycardia (hyperkalemia)',
        vitals: {
          cols: ['Initial', 'If treatment delayed', 'After calcium / bicarb'],
          rows: [
            { label: 'HR / rhythm', cells: ['46 — wide, regular, peaked T’s', '38 — widening further', 'QRS narrows, rate 60s'] },
            { label: 'BP', cells: ['86/52', '78/44', '98/60'] },
            { label: 'RR / SpO2', cells: ['20 / 93% RA', '20 / 94% on O2', '18 / 96%'] },
            { label: 'GCS / BGL / Temp', cells: ['14, sluggish / 142 / 97.9', '13', '14'] },
          ],
        },
        expected:
          'Recognizes hyperkalemia per 2.30: ESRD + missed dialysis + wide QRS + peaked T’s = life threat, treated ahead of rate. IV in the non-fistula arm. In order: Calcium Chloride 1 g slow IVP, Sodium Bicarbonate 50 mEq slow IVP in a separate or well-flushed line, Albuterol 2.5 mg continuous neb. Pads on early. Teaching point: atropine and pacing do not fix potassium — treat the cause.',
        trigger:
          'DETERIORATION TRIGGER — if calcium is delayed, or while the second medication is being drawn: he becomes unresponsive, pulseless. Monitor: wide organized complexes at 40, no pulse — PEA (Rhythm 2).',
      },
      {
        title: 'Phase 2 — Arrest',
        expected:
          'Verbalizes pulselessness; immediate compressions; LUCAS when available; epinephrine 1 mg every 5 minutes per 2.42; i-GEL with waveform ETCO2; H’s and T’s named out loud with hyperkalemia as the working cause: Calcium Chloride 1 g IVP (if not yet given) and Sodium Bicarbonate 1 mEq/kg in a separate line per 2.42.',
      },
    ],
    branches: [
      {
        path: 'A',
        text:
          'Treated appropriately (calcium and bicarbonate on board early, quality CPR): complexes narrow over the next two rounds → ROSC — Rhythm 3 (sinus at 88 with a pulse). HR 88, BP 94/58, ETCO2 42. Expect per 2.40: pads stay on, full vitals, 12-lead, airway reassessment, no fluid overload in the ESRD patient — bolus only if indicated, transport with early notification to a facility with dialysis capability. End.',
      },
      {
        path: 'B',
        text:
          'Gaps (calcium never given, bicarbonate pushed through the same line as calcium, CPR interruptions >10 sec): PEA degrades to asystole — Rhythm 3 (confirmed in two leads, ETCO2 9). Expect: epinephrine continued, bicarbonate repeat consideration per protocol, causes verbalized. End with an OLMC consult for direction — no field termination on standing order. No ROSC on this path. End.',
      },
    ],
    scoringNote:
      'The wide-complex bradycardia, PEA, and the post-calcium sinus rhythm (or asystole) are the three rhythms on the evaluation form. Path B typically also documents: mistreated rhythm (pacing or atropine fixation while potassium goes untreated), calcium and bicarbonate mixed in one line.',
    prompts:
      '“His wife asks if the monitor is supposed to look like that” (nudge toward rhythm recognition) · “Your partner asks which arm you want the IV in” (fistula awareness) · “The patient asks if he is going to be OK” (urgency toward calcium).',
  },
  {
    key: 'mc4',
    no: 4,
    title: 'Found in the Bathroom',
    summary: '29 y/o male · opioid overdose → hypoxic PEA arrest → branched outcome · 3 rhythms',
    dispatch:
      'Unresponsive male. Roommate found him on the bathroom floor; suspected fentanyl powder on the counter — scene safety verbalized, gloves on, do not handle the powder. Unresponsive, breathing 4/min and shallow, pinpoint pupils, cyanotic lips. Monitor: sinus bradycardia at 52.',
    phases: [
      {
        title: 'Phase 1 — Rhythm 1: sinus bradycardia (hypoventilating, pulse present)',
        vitals: {
          cols: ['Initial', 'With good BVM ventilation', 'If airway delayed'],
          rows: [
            { label: 'HR / rhythm', cells: ['52 — sinus brady', '64 — improving', '44 → falling'] },
            { label: 'BP', cells: ['90/58', '98/62', '82/50'] },
            { label: 'RR / SpO2', cells: ['4, shallow / 64% RA', 'Assisted 10–12 / climbs to 94%', '2–3 / 58% and falling'] },
            { label: 'GCS / BGL', cells: ['3 / 96', '3', '3'] },
          ],
        },
        expected:
          'Airway FIRST per 1.03 and 2.38: OPA or NPA, BVM with high-flow O2 at 10–12/min, SpO2 and ETCO2 on. Then Naloxone 0.5–1 mg IN or slow IVP, titrated to respirations only — not to wake him. IV, monitor, reassess. Teaching point: the ventilations are the treatment; naloxone is the adjunct.',
        trigger:
          'DETERIORATION TRIGGER — if ventilation is delayed while the trainee draws naloxone first, or just as the crew prepares to move him: pulse check — none. Monitor: organized narrow complexes in the 50s, no pulse — PEA (Rhythm 2).',
      },
      {
        title: 'Phase 2 — Arrest',
        expected:
          'Verbalizes pulselessness; immediate compressions; LUCAS when available; i-GEL early (hypoxic arrest — the airway is the cause); epinephrine 1 mg every 5 minutes per 2.42; 500 mL bolus; H’s and T’s verbalized: hypoxia and toxins. Teaching point: naloxone is NOT an arrest priority — compressions and ventilation move the drug; epinephrine runs the code.',
      },
    ],
    branches: [
      {
        path: 'A',
        text:
          'Treated appropriately (ventilation corrected, quality CPR, epi on schedule): after two rounds → ROSC — Rhythm 3 (sinus at 96 with a pulse). BP 104/62, ETCO2 48, spontaneous respirations return at 6–8/min — keep assisting. Expect per 2.40: pads stay on, full vitals, 12-lead, airway reassessment; naloxone titrated only to improve respirations. Transport. End.',
      },
      {
        path: 'B',
        text:
          'Gaps (naloxone fixation before ventilation, poor mask seal, CPR interruptions >10 sec): PEA degrades to asystole — Rhythm 3 (confirmed in two leads, ETCO2 7). Expect: epinephrine continued, bicarbonate consideration for prolonged downtime, causes verbalized. End with an OLMC consult for direction — no field termination on standing order. No ROSC on this path. End.',
      },
    ],
    scoringNote:
      'The sinus bradycardia, PEA, and the ROSC rhythm (or asystole) are the three rhythms on the evaluation form. Path B typically also documents: delayed ventilation, naloxone prioritized over compressions in arrest.',
    prompts:
      '“The roommate asks if you can just give him the spray” (force the airway-first answer out loud) · “Your partner asks if you want the i-GEL” · “Dispatch asks for a patient update” (forces a pulse check if none has happened).',
  },
  {
    key: 'mc5',
    no: 5,
    title: 'Mowing the Yard',
    summary: '57 y/o male · anterior STEMI → witnessed VF arrest → branched outcome · 3 rhythms',
    dispatch:
      'Chest pain. Found on the porch clutching his chest: crushing substernal pain 9/10 radiating to the left arm, onset 40 minutes ago while mowing. Pale, diaphoretic. Hx: hypertension, smoker. Meds: lisinopril. 12-lead within 5 minutes of contact: ST elevation V2–V4 — anterior STEMI.',
    phases: [
      {
        title: 'Phase 1 — Rhythm 1: sinus with anterior STEMI',
        vitals: {
          cols: ['Initial', 'After ASA / NTG x1', 'Just before arrest'],
          rows: [
            { label: 'HR / rhythm', cells: ['92 — sinus', '94', '96 → a run of PVCs'] },
            { label: 'BP', cells: ['148/88', '132/80', '128/78'] },
            { label: 'RR / SpO2', cells: ['20 / 93% RA', '18 / 96% on O2', '18 / 96%'] },
            { label: 'GCS / pain', cells: ['15 / 9 of 10', '15 / 7 of 10', '15'] },
          ],
        },
        expected:
          'Per 2.17: Aspirin 324 mg PO, 12-lead within 5 minutes, STEMI recognized → PCI-capable destination, 12-lead transmitted / Pulsara, STEMI alert. O2 titrated to ≥95%. IV x2 if possible. Nitro SL 0.4 mg every 5 minutes up to 3 — anterior, not inferior, so no contraindication; maintain SBP 100. Pads nearby given the PVCs. Rapid transport mindset.',
        trigger:
          'DETERIORATION TRIGGER — loading to the stretcher he goes silent and slumps: witnessed arrest. Monitor: VF (Rhythm 2).',
      },
      {
        title: 'Phase 2 — Arrest',
        expected:
          'Witnessed VF: immediate defibrillation 125 J — pads on fast, shock before anything else if the monitor is already attached; then CPR, LUCAS when available; defibrillation 150 J then 200 J; epinephrine 1 mg every 5 minutes; amiodarone 300 mg, repeat 150 mg in 10 minutes; i-GEL or ETT with waveform ETCO2; Lidocaine 1 mg/kg for refractory VF per 2.52; minimal interruptions.',
      },
    ],
    branches: [
      {
        path: 'A',
        text:
          'Treated appropriately (first shock <60 sec, quality CPR, epi and amiodarone on schedule): after the second shock → ROSC — Rhythm 3 (sinus at 104 with a pulse). BP 92/60, ETCO2 40. Expect per 2.40: pads stay on, 12-lead — STEMI still present — amiodarone 150 mg infusion over 10 minutes, NO nitro post-arrest, update the STEMI alert, PCI destination stands, transport without delay. End.',
      },
      {
        path: 'B',
        text:
          'Gaps (pads delayed, first shock >60 sec, long pauses for pulse checks): VF persists through two more shocks, then degrades to asystole — Rhythm 3 (confirmed in two leads, ETCO2 8). Expect: epinephrine continued, bicarbonate after the 3rd epi per 2.52, causes verbalized. End with an OLMC consult for direction — no field termination on standing order. No ROSC on this path. End.',
      },
    ],
    scoringNote:
      'The sinus-with-STEMI rhythm, VF, and the ROSC rhythm (or asystole) are the three rhythms on the evaluation form. Path B typically also documents: delayed defibrillation on a witnessed arrest, ineffective compressions >10 seconds.',
    prompts:
      '“His wife asks where you will be taking him” (destination decision out loud) · “Your partner asks if you want the pads on now” (PVC foreshadowing) · “The fire medic asks if you want another nitro” post-ROSC (trap — force the no).',
  },
  {
    key: 'mc6',
    no: 6,
    title: 'Fainting at the Reception',
    summary: '34 y/o female · long QT → torsades arrest → branched outcome · 3 rhythms',
    dispatch:
      'Syncope at a wedding reception. Witnesses report she fainted twice, with brief shaking. Awake on arrival, lightheaded and embarrassed, wants to refuse. Meds: methadone daily; just finished a course of azithromycin. Monitor: sinus at 78 with frequent PVCs. 12-lead: markedly long QT, no STEMI.',
    phases: [
      {
        title: 'Phase 1 — Rhythm 1: sinus with frequent PVCs (long QT)',
        vitals: {
          cols: ['Initial', 'In the truck', 'If mag given post-ROSC'],
          rows: [
            { label: 'HR / rhythm', cells: ['78 — sinus, frequent PVCs', '82 — couplets, short runs', 'Sinus 98, ectopy settling'] },
            { label: 'BP', cells: ['102/64', '100/62', '96/58'] },
            { label: 'RR / SpO2', cells: ['18 / 97% RA', '18 / 97%', '16 / 96% assisted'] },
            { label: 'GCS / BGL', cells: ['15 / 104', '15', 'Unresponsive → improving'] },
          ],
        },
        expected:
          'Recognizes recurrent syncope + long QT + QT-prolonging medications as a pre-arrest presentation — this patient does not refuse without a hard conversation. Monitor early, 12-lead, IV, pads ON before moving her. Transport without delay. Teaching point: the PVC runs are warning shots.',
        trigger:
          'DETERIORATION TRIGGER — in the truck she stiffens, shakes briefly, and goes unresponsive — pulseless. Monitor: polymorphic VT twisting around the baseline — torsades de pointes (Rhythm 2).',
      },
      {
        title: 'Phase 2 — Arrest',
        expected:
          'Verbalizes torsades; immediate compressions; per 2.52: Magnesium Sulfate 2 g IVP/IO EARLY — the rhythm-specific treatment — plus defibrillation 125 J then 150/200 J, epinephrine 1 mg every 5 minutes, amiodarone 300 mg, i-GEL with waveform ETCO2, minimal interruptions.',
      },
    ],
    branches: [
      {
        path: 'A',
        text:
          'Treated appropriately (magnesium early, timely shocks, quality CPR): torsades breaks after the mag and next shock → ROSC — Rhythm 3 (sinus at 98 with a pulse, ectopy settling). BP 96/58, ETCO2 43. Expect per 2.40: pads stay on, full vitals, 12-lead, airway reassessment, transport; verbalizes recurrence risk and keeps the monitor watched the whole ride. End.',
      },
      {
        path: 'B',
        text:
          'Gaps (magnesium never given, shocks without addressing the cause, interruptions >10 sec): torsades recurs after every shock, then degrades to asystole — Rhythm 3 (confirmed in two leads, ETCO2 9). Expect: epinephrine continued, causes verbalized — the magnesium miss is the debrief centerpiece. End with an OLMC consult for direction — no field termination on standing order. No ROSC on this path. End.',
      },
    ],
    scoringNote:
      'The sinus-with-PVCs rhythm, torsades, and the ROSC rhythm (or asystole) are the three rhythms on the evaluation form. Path B typically also documents: mistreated rhythm (torsades run as generic VF with no magnesium).',
    prompts:
      '“She asks if she can just sign the refusal” (force the risk conversation) · “Your partner asks what that rhythm is” (force torsades out loud) · “The monitor alarms again” post-ROSC (recurrence vigilance).',
  },
]

/* ── The evaluation form (WCEMS Megacode Evaluation, v1.0) ──────────── */

export const MEGACODE_SECTION1: { key: string; label: string }[] = [
  { key: 's1_responsive', label: 'Checks responsiveness, apnea, and pulselessness' },
  { key: 's1_help', label: 'Calls for help and activates the emergency response system' },
  { key: 's1_delegates', label: 'Delegates roles effectively and leads the crew throughout' },
  { key: 's1_compressions', label: 'Ensures effective compressions with minimal interruption' },
  { key: 's1_ventilations', label: 'Directs ventilations with high-flow oxygen' },
  { key: 's1_access', label: 'Establishes or directs IV/IO access' },
  { key: 's1_monitor', label: 'Places the patient on the monitor: BP, SpO2, leads, ETCO2, defibrillation pads' },
]

export const MEGACODE_RHYTHMS: { key: string; label: string }[] = [
  { key: 'r_brady', label: 'Bradycardia — atropine / transcutaneous pacing' },
  { key: 'r_stable_vt', label: 'Stable ventricular tachycardia — amiodarone / lidocaine' },
  { key: 'r_unstable_vt', label: 'Unstable ventricular tachycardia — synchronized cardioversion with sedation' },
  { key: 'r_vf', label: 'Pulseless VT / VF — CPR, defibrillation, epinephrine, magnesium, amiodarone, bicarbonate' },
  { key: 'r_pea', label: 'PEA — epinephrine, bicarbonate, calcium' },
  { key: 'r_asystole', label: 'Asystole — epinephrine, bicarbonate, calcium' },
]

export const MEGACODE_SECTION3: { key: string; label: string }[] = [
  { key: 's3_vitals', label: 'After ROSC, obtains a complete set of vital signs' },
  { key: 's3_airway', label: 'Verbalizes the need for intubation with waveform ETCO2 confirmation' },
]

export const MEGACODE_AUTOFAILS: { key: string; label: string }[] = [
  { key: 'af_help', label: 'Fails to call for help or activate the emergency response system' },
  { key: 'af_cpr', label: 'Allows ineffective compressions or ventilations for more than 10 seconds' },
  { key: 'af_access', label: 'Fails to obtain or direct IV/IO access' },
  { key: 'af_rhythms', label: 'Misinterprets or mistreats two or more rhythms' },
]

export interface MegacodeChecks {
  s1: Record<string, boolean>
  rhythms: Record<string, boolean>
  s3: Record<string, boolean>
  autofails: Record<string, boolean>
  attempt: 1 | 2 | 3
}

/** Paper-form scoring: all of Section 1 and 3, at least three rhythms,
 *  and no automatic fail. Total prints as "n / 12 minimum". */
export function megacodeScore(c: MegacodeChecks): {
  points: number
  s1Done: boolean
  s3Done: boolean
  rhythmCount: number
  autoFailed: boolean
  passed: boolean
} {
  const s1 = MEGACODE_SECTION1.filter((i) => c.s1[i.key]).length
  const s3 = MEGACODE_SECTION3.filter((i) => c.s3[i.key]).length
  const rhythms = MEGACODE_RHYTHMS.filter((i) => c.rhythms[i.key]).length
  const autoFailed = MEGACODE_AUTOFAILS.some((i) => c.autofails[i.key])
  const s1Done = s1 === MEGACODE_SECTION1.length
  const s3Done = s3 === MEGACODE_SECTION3.length
  return {
    points: s1 + s3 + rhythms,
    s1Done,
    s3Done,
    rhythmCount: rhythms,
    autoFailed,
    passed: s1Done && s3Done && rhythms >= 3 && !autoFailed,
  }
}
