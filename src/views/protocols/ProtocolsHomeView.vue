<template>
  <div class="app-shell">

    <div class="header">
  <RouterLink to="/" class="portal-back" aria-label="Back to the portal">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="m15 18-6-6 6-6"/></svg>
    Portal
  </RouterLink>
  <div class="header-center">
    <img src="/Patch - Final.png" alt="WCEMS" class="patch" />
    <div class="agency-label">WALLER COUNTY EMS</div>
    <h1 class="header-title">{{ sectionTitle }}</h1>
    <div class="year-tag">2026 PROTOCOLS</div>
  </div>

  <div class="search-wrap">
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
    <input v-model="search" type="text" :placeholder="searchPlaceholder" class="search-input" />
    <button v-if="search" class="search-clear" @click="search = ''">✕</button>
  </div>

  <div v-if="activeTab === 'protocols' || activeTab === 'procedures'" class="view-toggle">
    <button class="view-btn" :class="{ active: viewMode === 'category' }" @click="viewMode = 'category'">By Category</button>
    <button class="view-btn" :class="{ active: viewMode === 'number' }" @click="viewMode = 'number'">By Number</button>
  </div>
</div>

    <div class="content-scroll" ref="scrollRef" @scroll="handleScroll">

      <div v-if="loading" class="state-message">Loading...</div>

      <template v-else-if="activeTab === 'protocols' || activeTab === 'procedures'">

        <div v-if="filteredContent.length === 0" class="state-message">No results found.</div>

        <div v-else-if="viewMode === 'category'">
          <div v-for="group in groupedCategories" :key="group.name" class="category-group">
            <button class="category-header" @click="toggleCategory(group.name)">
              <span class="category-label">{{ group.name }}</span>
              <div class="category-meta">
                <span class="category-count">{{ group.protocols.length }}</span>
                <svg class="category-chevron" :class="{ open: !collapsedCategories.has(group.name) }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </div>
            </button>
            <div v-if="!collapsedCategories.has(group.name)" class="category-items">
              <div
  v-for="item in group.protocols"
  :key="item.id"
  class="protocol-card"
  @click="goToProtocol(item)"
>
                <div class="protocol-info">
                  <span class="protocol-num">{{ item.number }}</span>
                  <span class="protocol-name">{{ item.name }}</span>
                </div>
                <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="flat-list">
          <div
            v-for="item in filteredContent"
            :key="item.id"
            class="protocol-card"
            @click="goToProtocol(item)"
          >
            <div class="protocol-info">
              <span class="protocol-num">{{ item.number }}</span>
              <span class="protocol-name">{{ item.name }}</span>
              <div v-if="search && getSnippet(item, search)" 
       class="snippet" 
       v-html="getSnippet(item, search)">
  </div>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m9 18 6-6-6-6"/>
            </svg>
          </div>
        </div>

      </template>

      <div v-else-if="activeTab === 'tools'" class="tools-grid">

        <div class="tools-section-label">CLINICAL CALCULATORS</div>

        <div class="tool-card" @click="openTool('stemi')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">STEMI Reference</div>
            <div class="tool-desc">Heart diagram · 12-lead · STEMI calculator · Sgarbossa</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tool-card" @click="openTool('stroke')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">Stroke Assessment</div>
            <div class="tool-desc">Cincinnati CPSS · VAN large vessel occlusion screen</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tool-card" @click="openTool('burn')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2c0 6-6 8-6 14a6 6 0 0 0 12 0c0-6-6-8-6-14z"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">Burn Calculator</div>
            <div class="tool-desc">Rule of Nines · TBSA · Fluid rate by age</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tools-section-label">OB / NEONATAL</div>

        <div class="tool-card" @click="openTool('contractions')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">Contraction Tracker</div>
            <div class="tool-desc">Timestamps · duration · frequency · PDF export</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tool-card" @click="openTool('delivery')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">Delivery Documentation</div>
            <div class="tool-desc">Birth time · APGAR 1 & 5 min · Complications · PDF</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tool-card" @click="openTool('newborn')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">Newborn APGAR</div>
            <div class="tool-desc">APGAR scoring · due times · PDF export</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tools-section-label">REFERENCE</div>

        <div class="tool-card" @click="openTool('rass')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">RASS Scale</div>
            <div class="tool-desc">Richmond Agitation Sedation Scale</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tool-card" @click="openTool('handt')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">H's and T's</div>
            <div class="tool-desc">Reversible causes of PEA arrest</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tool-card" @click="openTool('wongbaker')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">Wong-Baker Pain Scale</div>
            <div class="tool-desc">FACES pain rating scale</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tool-card" @click="openTool('organophosphate')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 0-2-2v-4m0 0h18"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">Atropine Dosing</div>
            <div class="tool-desc">Organophosphate / SLUDGE reference</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

        <div class="tool-card" @click="openTool('samsplint')">
          <div class="tool-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div class="tool-info">
            <div class="tool-name">SAM Splint User Guide</div>
            <div class="tool-desc">Application techniques · sizing · molding · PDF</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </div>

      </div>

      <div v-else-if="activeTab === 'more'" class="more-list">
  <div class="more-card" @click="activeTab = 'medications'">
    <div class="more-info">
      <div class="more-name">Medications</div>
      <div class="more-desc">Formulary · concentrations · minimum quantities</div>
    </div>
    <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  </div>
  <div class="more-card" @click="activeTab = 'equipment'">
    <div class="more-info">
      <div class="more-name">Equipment</div>
      <div class="more-desc">Supply list · minimum quantities</div>
    </div>
    <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  </div>
  <div class="more-card" @click="openTool('protocolspdf')">
    <div class="more-info">
      <div class="more-name">2026 Protocol Manual</div>
      <div class="more-desc">Complete signed protocol document · All signature pages</div>
    </div>
    <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  </div>
  <div class="more-card" @click="downloadOfflineContent">
  <div class="more-info">
    <div class="more-name">{{ syncing ? 'Downloading...' : 'Download for Offline Use' }}</div>
    <div class="more-desc">{{ syncStatus ? `Last synced: ${syncStatus}` : 'Save all content for offline access' }}</div>
  </div>
  <svg v-if="!syncing" class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="m9 18 6-6-6-6"/>
  </svg>
  <svg v-else class="chevron spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
</div>
  <div v-if="auth.isAdmin" class="more-card" @click="$router.push('/admin/protocols')">
    <div class="more-info">
      <div class="more-name">Admin</div>
      <div class="more-desc">Edit protocol content</div>
    </div>
    <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  </div>
</div>

      <div v-else-if="activeTab === 'medications'" class="med-section">
        <div class="med-view-toggle">
          <button class="view-btn" :class="{ active: medView === 'reference' }" @click="medView = 'reference'">Drug Reference</button>
          <button class="view-btn" :class="{ active: medView === 'formulary' }" @click="medView = 'formulary'">Formulary</button>
        </div>

        <template v-if="medView === 'reference'">
          <div v-if="filteredMedicationDetails.length === 0" class="state-message">No medications found.</div>
          <div v-else class="med-ref-list">
            <div
              v-for="m in filteredMedicationDetails"
              :key="m.id"
              class="med-ref-card"
              @click="goToMedication(m)"
            >
              <div class="med-ref-info">
                <div class="med-ref-name">{{ m.name }}</div>
                <div v-if="m.alt_name" class="med-ref-alt">{{ m.alt_name }}</div>
                <div v-if="m.type" class="med-ref-type">{{ m.type }}</div>
              </div>
              <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </div>
          </div>
        </template>

        <template v-else>
          <button class="pdf-btn" @click="openTool('medicationspdf')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            View Original Signed Document
          </button>
          <div class="med-note">Generic and/or name brand medications are allowed. Concentrations may change due to shortages or backorders.</div>

          <div v-if="filteredMedications.length === 0" class="state-message">No medications found.</div>

          <div v-else class="med-table">
            <div class="med-header">
              <span>Medication</span>
              <span>Concentration</span>
              <span>Min Qty</span>
              <span>Supplied As</span>
            </div>
            <div v-for="med in filteredMedications" :key="med.id" class="med-row">
              <div class="med-name">{{ med.name }}</div>
              <div class="med-concentration">{{ med.concentration }}</div>
              <div class="med-qty">{{ med.min_quantity }}</div>
              <div class="med-supplied">{{ med.how_supplied }}</div>
            </div>
          </div>
        </template>
      </div>

      <div v-else-if="activeTab === 'equipment'" class="equip-section">
  <button class="pdf-btn" @click="openTool('equipmentpdf')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    View Original Signed Document
  </button>

  <div v-if="groupedEquipment.length === 0" class="state-message">No items found.</div>

  <div v-for="group in groupedEquipment" :key="group.name" class="equip-group">
    <div class="equip-category">{{ group.name }}</div>
    <div class="equip-table">
      <div class="equip-header">
  <span>Item</span>
  <span>Notes</span>
  <span>Min Qty</span>
</div>
<div v-for="item in group.items" :key="item.id" class="equip-row">
  <div class="equip-name">{{ item.item }}</div>
  <div class="equip-notes">{{ item.notes || '—' }}</div>
  <div class="equip-qty">{{ item.minimum_qty }}</div>
</div>
    </div>
  </div>

  <div class="as-available-note">
    <strong>As Available</strong> — Equipment found only on frontline ambulances (Medics 1, 2, 3, 4, 5, 6, 8). If out of service, alternative means will be available.
  </div>
</div>

<button v-if="showScrollTop" class="scroll-top-btn" @click="scrollToTop">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;">
    <path d="m18 15-6-6-6 6"/>
  </svg>
</button>
    </div>

    <div class="bottom-nav">
      <button class="nav-btn" :class="{ active: activeTab === 'protocols' }" @click="switchTab('protocols')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nav-icon">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span class="nav-label">Protocols</span>
      </button>
      <button class="nav-btn" :class="{ active: activeTab === 'procedures' }" @click="switchTab('procedures')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nav-icon">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <span class="nav-label">Procedures</span>
      </button>
      <button class="nav-btn" :class="{ active: activeTab === 'tools' }" @click="switchTab('tools')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nav-icon">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <span class="nav-label">Tools</span>
      </button>
      <button class="nav-btn" :class="{ active: activeTab === 'more' || activeTab === 'medications' || activeTab === 'equipment' }" @click="switchTab('more')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nav-icon">
          <circle cx="12" cy="12" r="1"/>
          <circle cx="19" cy="12" r="1"/>
          <circle cx="5" cy="12" r="1"/>
        </svg>
        <span class="nav-label">More</span>
      </button>
    </div>

    <ReferenceSheet :show="activeSheet === 'stemi'" title="STEMI Reference" @close="activeSheet = null">
      <STEMIReference />
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'stroke'" title="Stroke Assessment" @close="activeSheet = null">
      <StrokeAssessment />
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'burn'" title="Burns Reference" @close="activeSheet = null">
      <BurnCalculator />
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'contractions'" title="Contraction Tracker" @close="activeSheet = null">
      <ContractionTracker />
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'delivery'" title="Delivery Documentation" @close="activeSheet = null">
      <DeliveryDoc />
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'newborn'" title="Newborn APGAR" @close="activeSheet = null">
      <NewbornAPGAR />
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'rass'" title="RASS Scale" @close="activeSheet = null">
      <table class="ref-table">
        <thead>
          <tr><th>Score</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td>+4</td><td>Combative, violent, danger to staff</td></tr>
          <tr><td>+3</td><td>Pulls or removes tubes/catheters; aggressive</td></tr>
          <tr><td>+2</td><td>Frequent nonpurposeful movement, fights ventilator</td></tr>
          <tr><td>+1</td><td>Anxious, apprehensive, but not aggressive</td></tr>
          <tr><td>0</td><td>Alert and calm</td></tr>
          <tr><td>-1</td><td>Awakens to voice (eye opening/contact) &gt;10 sec</td></tr>
          <tr><td>-2</td><td>Light sedation, briefly awakens to voice &lt;10 sec</td></tr>
          <tr><td>-3</td><td>Moderate sedation, movement or eye opening, no eye contact</td></tr>
          <tr><td>-4</td><td>Deep sedation, no response to voice, movement to physical stimulation</td></tr>
          <tr><td>-5</td><td>Unarousable, no response to voice or physical stimulation</td></tr>
        </tbody>
      </table>
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'handt'" title="H's and T's — Reversible Causes of PEA" @close="activeSheet = null">
      <div class="ht-grid">
        <div class="ht-column">
          <div class="ht-header">H's</div>
          <div class="ht-item">Hypovolemia</div>
          <div class="ht-item">Hypoxia</div>
          <div class="ht-item">Hydrogen Ion (Acidosis)</div>
          <div class="ht-item">Hyper/Hypokalemia</div>
          <div class="ht-item">Hypothermia</div>
        </div>
        <div class="ht-divider"></div>
        <div class="ht-column">
          <div class="ht-header">T's</div>
          <div class="ht-item">Toxins</div>
          <div class="ht-item">Tamponade (Cardiac)</div>
          <div class="ht-item">Tension Pneumothorax</div>
          <div class="ht-item">Thrombosis</div>
          <div class="ht-item">Trauma</div>
        </div>
      </div>
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'wongbaker'" title="Wong-Baker FACES Pain Scale" @close="activeSheet = null">
      <img src="/WongBaker.png" style="width:100%;border-radius:8px;display:block;" alt="Wong-Baker FACES Pain Rating Scale" />
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'organophosphate'" title="Atropine Dosing — Organophosphate" @close="activeSheet = null">
      <div class="ref-section-title">ATROPINE DOSING CHART</div>
      <div class="ref-dose-block">
        <div class="ref-dose-age">&lt;2 yoa</div>
        <div class="ref-dose-row"><span class="ref-dose-label">Dose:</span> 0.05mg/kg IM</div>
        <div class="ref-dose-row"><span class="ref-dose-label"></span> 0.02mg/kg IV</div>
        <div class="ref-dose-note">Administer q 10-30 minutes PRN, continue until muscarinic symptoms are gone.</div>
      </div>
      <div class="ref-dose-block">
        <div class="ref-dose-age">2–10 yoa</div>
        <div class="ref-dose-row"><span class="ref-dose-label">Dose:</span> 1-2mg IM or IV</div>
        <div class="ref-dose-note">Start with 1mg IM or IV and repeat once. May continue 1-2mg q 10-30 min PRN.</div>
      </div>
      <div class="ref-dose-block">
        <div class="ref-dose-age">&gt;10 yoa</div>
        <div class="ref-dose-row"><span class="ref-dose-label">Dose:</span> 2mg IM or IV</div>
        <div class="ref-dose-note">Start with 2mg IM or IV and repeat once. May continue 2mg q 10-30 min PRN.</div>
      </div>
      <div class="ref-section-title" style="margin-top:16px;">SLUDGE</div>
      <table class="ref-table">
        <tbody>
          <tr><td class="sludge-letter">S</td><td>Salivation</td></tr>
          <tr><td class="sludge-letter">L</td><td>Lacrimation</td></tr>
          <tr><td class="sludge-letter">U</td><td>Urinary Incontinence</td></tr>
          <tr><td class="sludge-letter">D</td><td>Defecation</td></tr>
          <tr><td class="sludge-letter">G</td><td>Gastrointestinal Cramping</td></tr>
          <tr><td class="sludge-letter">E</td><td>Emesis</td></tr>
        </tbody>
      </table>
    </ReferenceSheet>

    <ReferenceSheet :show="activeSheet === 'samsplint'" title="SAM Splint User Guide" @close="activeSheet = null">
      <PdfViewer v-if="activeSheet === 'samsplint'" src="/sam-splint-user-guide.pdf" />
    </ReferenceSheet>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '@/lib/supabaseProtocols'
import { useAuthStore } from '@/stores/auth'
import ReferenceSheet from '@/components/protocols/ReferenceSheet.vue'
import STEMIReference from '@/components/protocols/STEMIReference.vue'
import StrokeAssessment from '@/components/protocols/StrokeAssessment.vue'
import BurnCalculator from '@/components/protocols/BurnCalculator.vue'
import ContractionTracker from '@/components/protocols/ContractionTracker.vue'
import DeliveryDoc from '@/components/protocols/DeliveryDoc.vue'
import NewbornAPGAR from '@/components/protocols/NewbornAPGAR.vue'

const PdfViewer = defineAsyncComponent(() => import('@/components/protocols/PdfViewer.vue'))

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const search = ref('')
const activeTab = ref('protocols')
const viewMode = ref('number')
const allItems = ref([])
const loading = ref(true)
const activeSheet = ref(null)
const collapsedCategories = ref(new Set())
const scrollRef = ref(null)
const showScrollTop = ref(false)
const syncStatus = ref(localStorage.getItem('wcems_last_sync') || null)
const syncing = ref(false)
const PROTOCOLS_CACHE_KEY = 'wcems_protocols_cache_v1'
const PROTOCOLS_CACHE_TIME_KEY = 'wcems_protocols_cache_time_v1'
const isOfflineData = ref(!navigator.onLine)
window.addEventListener('online', () => { isOfflineData.value = false })
window.addEventListener('offline', () => { isOfflineData.value = true })
console.log('online status:', navigator.onLine, 'isOfflineData:', isOfflineData.value)
const lastUpdated = ref('')

function handleScroll() {
  showScrollTop.value = scrollRef.value?.scrollTop > 300
  sessionStorage.setItem(`${activeTab.value}ScrollPos`, scrollRef.value?.scrollTop || 0)
}

function scrollToTop() {
  scrollRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function goToProtocol(item) {
  router.push({ 
    path: `/protocols/protocol/${item.id}`, 
    query: search.value ? { q: search.value } : {} 
  })
}
const allEquipment = ref([])
const allMedications = ref([])
const allMedicationDetails = ref([])
const medView = ref('reference')

onMounted(async () => {
  const ITEMS_CACHE_KEY = 'wcems_all_items_cache_v1'
  const EQUIPMENT_CACHE_KEY = 'wcems_equipment_cache_v1'
  const MEDICATIONS_CACHE_KEY = 'wcems_medications_cache_v1'
  const MED_DETAILS_CACHE_KEY = 'wcems_medication_details_cache_v1'

  if (route.query.tab === 'procedures') {
    activeTab.value = 'procedures'
  } else if (route.query.tab === 'protocols') {
    activeTab.value = 'protocols'
  } else if (route.query.tab === 'medications') {
    activeTab.value = 'medications'
  }

  // Step 1 — load from cache immediately so page renders fast
  const cachedItems = localStorage.getItem(ITEMS_CACHE_KEY)
  const cachedEquipment = localStorage.getItem(EQUIPMENT_CACHE_KEY)
  const cachedMedications = localStorage.getItem(MEDICATIONS_CACHE_KEY)
  const cachedMedDetails = localStorage.getItem(MED_DETAILS_CACHE_KEY)

  if (cachedItems) allItems.value = JSON.parse(cachedItems)
  if (cachedEquipment) allEquipment.value = JSON.parse(cachedEquipment)
  if (cachedMedications) allMedications.value = JSON.parse(cachedMedications)
  if (cachedMedDetails) allMedicationDetails.value = JSON.parse(cachedMedDetails)

  // If we have cached data, show it immediately
  if (cachedItems) {
    loading.value = false
    isOfflineData.value = true // assume offline until network proves otherwise
  }

  // Step 2 — try to update from network in background
  try {
    const [protocolRes, equipmentRes, medicationRes, medDetailsRes] = await Promise.all([
      supabase
        .from('protocols')
        .select('id, number, name, category, content, criteria_adult, criteria_pediatric, notes, search_text')
        .order('number'),
      supabase
        .from('equipment')
        .select('*')
        .order('sort_order'),
      supabase
        .from('medications')
        .select('*')
        .order('sort_order'),
      supabase
        .from('medication_details')
        .select('*')
        .order('sort_order')
    ])

    if (protocolRes.error) throw protocolRes.error
    if (equipmentRes.error) throw equipmentRes.error
    if (medicationRes.error) throw medicationRes.error
    // medDetailsRes may error if migration hasn't run yet — don't fail the whole load
    if (medDetailsRes.error) console.warn('medication_details unavailable:', medDetailsRes.error.message)

    if (protocolRes.data) {
      allItems.value = protocolRes.data
      localStorage.setItem(ITEMS_CACHE_KEY, JSON.stringify(protocolRes.data))
    }
    if (equipmentRes.data) {
      allEquipment.value = equipmentRes.data
      localStorage.setItem(EQUIPMENT_CACHE_KEY, JSON.stringify(equipmentRes.data))
    }
    if (medicationRes.data) {
      allMedications.value = medicationRes.data
      localStorage.setItem(MEDICATIONS_CACHE_KEY, JSON.stringify(medicationRes.data))
    }
    if (medDetailsRes.data) {
      allMedicationDetails.value = medDetailsRes.data
      localStorage.setItem(MED_DETAILS_CACHE_KEY, JSON.stringify(medDetailsRes.data))
    }

    // Network succeeded — we are online
    isOfflineData.value = false

  } catch (error) {
    // Network failed — stay offline
    isOfflineData.value = true
    console.warn('Network unavailable, using cached data.', error)
  } finally {
    loading.value = false
    await nextTick()
    const savedPos = sessionStorage.getItem(`${activeTab.value}ScrollPos`)
    if (savedPos && scrollRef.value) {
      scrollRef.value.scrollTop = parseInt(savedPos, 10)
    }
  }
})

const groupedEquipment = computed(() => {
  const groups = {}
  const q = search.value.toLowerCase().trim()
  const filtered = allEquipment.value.filter(e =>
    !q || e.item?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q) || e.category?.toLowerCase().includes(q)
  )
  filtered.forEach(e => {
    if (!groups[e.category]) groups[e.category] = []
    groups[e.category].push(e)
  })
  return Object.entries(groups).map(([name, items]) => ({ name, items }))
})

const filteredMedications = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return allMedications.value
  return allMedications.value.filter(m =>
    m.name?.toLowerCase().includes(q) ||
    m.concentration?.toLowerCase().includes(q) ||
    m.how_supplied?.toLowerCase().includes(q)
  )
})

const filteredMedicationDetails = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return allMedicationDetails.value
  return allMedicationDetails.value.filter(m =>
    m.name?.toLowerCase().includes(q) ||
    m.alt_name?.toLowerCase().includes(q) ||
    m.type?.toLowerCase().includes(q) ||
    m.indications?.toLowerCase().includes(q) ||
    m.dosage_routes?.toLowerCase().includes(q)
  )
})

function goToMedication(m) {
  router.push(`/protocols/medication/${m.id}`)
}

function switchTab(tab) {
  activeTab.value = tab
  search.value = ''
}

function openTool(tool) {
  if (tool === 'equipmentpdf') {
    window.open('/2026-Equipment-List.pdf', '_blank')
    return
  }
  if (tool === 'medicationspdf') {
    window.open('/2026-Medications-List.pdf', '_blank')
    return
  }
  if (tool === 'protocolspdf') {
  window.open('https://ycahnwxzfyjfrgdavril.supabase.co/storage/v1/object/public/protocols/2026-Protocols.pdf', '_blank')
  return
}
  activeSheet.value = tool
}

async function downloadOfflineContent() {
  syncing.value = true
  try {
    const { data: protocols } = await supabase
  .from('protocols')
  .select('*')
  .order('number')
    
    if (protocols) {
  localStorage.setItem('wcems_all_items_cache_v1', JSON.stringify(protocols))
  protocols.forEach(p => {
    localStorage.setItem(`wcems_protocol_${p.id}`, JSON.stringify(p))
  })
  localStorage.setItem('wcems_protocol_map', JSON.stringify(protocols.map(p => ({ id: p.id, number: p.number }))))
      
      const { data: allSteps } = await supabase
        .from('protocol_steps')
        .select('*')
      
      if (allSteps) {
        const byProtocol = {}
        allSteps.forEach(s => {
          if (!byProtocol[s.protocol_id]) byProtocol[s.protocol_id] = []
          byProtocol[s.protocol_id].push(s)
        })
        Object.entries(byProtocol).forEach(([pid, steps]) => {
          localStorage.setItem(`wcems_steps_${pid}`, JSON.stringify(steps))
        })
      }
    }

    const { data: equipment } = await supabase.from('equipment').select('*').order('sort_order')
    const { data: medications } = await supabase.from('medications').select('*').order('sort_order')
    
    if (equipment) localStorage.setItem('wcems_equipment_cache_v1', JSON.stringify(equipment))
    if (medications) localStorage.setItem('wcems_medications_cache_v1', JSON.stringify(medications))

    const now = new Date().toLocaleString()
    localStorage.setItem('wcems_last_sync', now)
    syncStatus.value = now
    alert('All content downloaded for offline use!')
  } catch (error) {
    alert('Download failed — check your connection and try again.')
    console.error(error)
  } finally {
    syncing.value = false
  }
}

function toggleCategory(name) {
  const next = new Set(collapsedCategories.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  collapsedCategories.value = next
}

const sectionTitle = computed(() => {
  const map = {
    protocols: 'Protocols',
    procedures: 'Procedures',
    tools: 'Tools',
    more: 'More',
    medications: 'Medications',
    equipment: 'Equipment',
  }
  return map[activeTab.value] || 'Protocols'
})

const searchPlaceholder = computed(() => {
  if (activeTab.value === 'procedures') return 'Search procedures...'
  if (activeTab.value === 'tools') return 'Search tools...'
  if (activeTab.value === 'equipment') return 'Search equipment...'
  if (activeTab.value === 'medications') return 'Search medications...'
  return 'Search protocols...'
})

const filteredContent = computed(() => {
  const q = search.value.toLowerCase().trim()
  let base = []
  if (activeTab.value === 'protocols') {
    base = allItems.value.filter(i => i.number?.startsWith('2.'))
  } else if (activeTab.value === 'procedures') {
    base = allItems.value.filter(i => i.number?.startsWith('1.'))
  }
  if (!q) return base
  return base.filter(i =>
    i.search_text?.toLowerCase().includes(q)
  )
})

const groupedCategories = computed(() => {
  const groups = {}
  filteredContent.value.forEach(item => {
    const cat = item.category || 'General'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(item)
  })
  return Object.entries(groups).map(([name, protocols]) => ({ name, protocols }))
})

function getSnippet(item, query) {
  if (!query) return ''
  const q = query.toLowerCase()
  
  // Fields to search through in priority order
  const fields = [
    item.criteria_adult,
    item.criteria_pediatric,
    item.content,
    item.notes,
    item.search_text
  ]

  for (const field of fields) {
    if (!field) continue
    const idx = field.toLowerCase().indexOf(q)
    if (idx === -1) continue
    const start = Math.max(0, idx - 60)
    const end = Math.min(field.length, idx + q.length + 60)
    let snippet = field.slice(start, end).replace(/\s+/g, ' ').trim()
    if (start > 0) snippet = '...' + snippet
    if (end < field.length) snippet = snippet + '...'
    // Highlight the match
    const regex = new RegExp(`(${q})`, 'gi')
    return snippet.replace(regex, '<mark>$1</mark>')
  }
  return ''
}


</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: var(--navy);
  overflow: hidden;
}

/* Back to the portal hub — the section is chromeless, so this is the
   one persistent way home. */
.portal-back {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 12px);
  left: max(env(safe-area-inset-left, 0px), 14px);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 5px 10px 5px 6px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--gold-light);
  background: rgba(201, 168, 76, 0.1);
  border: 1px solid var(--border);
  z-index: 5;
}

.header {
  position: relative;
  background: var(--navy-mid);
  border-bottom: 1px solid var(--border);
  padding-top: calc(env(safe-area-inset-top, 0px) + 12px);
  padding-bottom: 14px;
  padding-left: max(env(safe-area-inset-left, 0px), 16px);
  padding-right: max(env(safe-area-inset-right, 0px), 16px);
  flex-shrink: 0;
  z-index: 10;
  box-sizing: border-box;
  width: 100%;
}

.header-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: 14px;
}

.patch {
  width: 56px;
  height: 56px;
  object-fit: contain;
  margin-bottom: 4px;
}

.agency-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--gold);
}

.header-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--white);
  line-height: 1;
}

.year-tag {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}

.patch {
  width: 44px;
  height: 44px;
  object-fit: contain;
  flex-shrink: 0;
}

.agency-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--gold);
  margin-bottom: 2px;
}


.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.search-icon {
  position: absolute;
  left: 12px;
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  background: var(--navy-light);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 11px 40px;
  font-size: 15px;
  color: var(--white);
  outline: none;
  transition: border-color 0.2s;
  font-family: 'Inter', sans-serif;
  box-sizing: border-box;
}

.search-input::placeholder { color: var(--text-muted); }
.search-input:focus { border-color: var(--gold); }

.search-clear {
  position: absolute;
  right: 12px;
  background: none;
  color: var(--text-muted);
  font-size: 13px;
  padding: 4px;
}

.view-toggle {
  display: flex;
  background: var(--navy);
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
}

.view-btn {
  flex: 1;
  padding: 7px 0;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  background: none;
  color: var(--text-muted);
  transition: all 0.15s;
}

.view-btn.active {
  background: var(--gold);
  color: var(--navy);
}

.content-scroll {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px max(env(safe-area-inset-right, 0px), 16px) 16px max(env(safe-area-inset-left, 0px), 16px);
}

.state-message {
  text-align: center;
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 14px;
}

.category-group { margin-bottom: 4px; }

.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  padding: 10px 4px;
  cursor: pointer;
}

.category-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
}

.category-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.category-count {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--navy-light);
  padding: 2px 7px;
  border-radius: 10px;
}

.category-chevron {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  transition: transform 0.2s;
  transform: rotate(-90deg);
}

.category-chevron.open { transform: rotate(0deg); }

.category-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.protocol-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
  -webkit-tap-highlight-color: transparent;
}

.protocol-card:active {
  background: var(--surface-raised);
  border-color: var(--gold);
}

.protocol-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.protocol-num {
  font-size: 11px;
  font-weight: 700;
  color: var(--gold);
  min-width: 34px;
  flex-shrink: 0;
}

.protocol-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--white);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.flat-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tools-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tools-section-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
  padding: 10px 4px 4px;
}

.tool-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
  -webkit-tap-highlight-color: transparent;
}

.tool-card:active {
  background: var(--surface-raised);
  border-color: var(--gold);
}

.tool-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(201,168,76,0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--gold);
}

.tool-icon svg { width: 18px; height: 18px; }

.tool-info { flex: 1; min-width: 0; }
.tool-name { font-size: 14px; font-weight: 600; color: var(--white); margin-bottom: 2px; }
.tool-desc { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.more-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.more-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  cursor: pointer;
  transition: background 0.1s;
  -webkit-tap-highlight-color: transparent;
}

.more-card:active { background: var(--surface-raised); border-color: var(--gold); }
.more-info { flex: 1; }
.more-name { font-size: 15px; font-weight: 600; color: var(--white); margin-bottom: 3px; }
.more-desc { font-size: 12px; color: var(--text-muted); }

.placeholder { padding: 0; }

.placeholder-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 16px;
}

.placeholder-title { font-size: 16px; font-weight: 700; color: var(--white); margin-bottom: 6px; }
.placeholder-text { font-size: 13px; color: var(--text-muted); line-height: 1.5; }

.bottom-nav {
  display: flex;
  background: var(--navy-mid);
  border-top: 1px solid var(--border);
  padding-top: 8px;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  flex-shrink: 0;
  z-index: 10;
}

.nav-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  background: none;
  color: var(--text-muted);
  transition: color 0.15s;
  -webkit-tap-highlight-color: transparent;
}

.nav-btn.active { color: var(--gold); }
.nav-icon { width: 22px; height: 22px; }

.nav-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.ref-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.ref-table th {
  text-align: left;
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--gold);
  border-bottom: 1px solid var(--border);
}

.ref-table td {
  padding: 10px 12px;
  color: var(--text-primary);
  border-bottom: 1px solid rgba(255,255,255,0.04);
  vertical-align: top;
}

.ref-table td:first-child {
  font-weight: 700;
  color: var(--gold);
  white-space: nowrap;
  width: 60px;
}

.ref-table tr:last-child td { border-bottom: none; }

.ht-grid { display: flex; gap: 0; }
.ht-column { flex: 1; display: flex; flex-direction: column; }
.ht-header { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--gold); padding: 8px 14px; background: var(--navy-light); border-bottom: 1px solid var(--border); }
.ht-item { font-size: 13px; color: var(--white); padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.ht-item:last-child { border-bottom: none; }
.ht-divider { width: 1px; background: var(--border); }

.ref-section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: var(--gold); margin-bottom: 8px; }
.ref-dose-block { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 4px; }
.ref-dose-age { font-size: 13px; font-weight: 700; color: var(--gold); margin-bottom: 4px; }
.ref-dose-row { font-size: 13px; color: var(--white); display: flex; gap: 6px; }
.ref-dose-label { font-weight: 600; color: var(--text-secondary); min-width: 40px; }
.ref-dose-note { font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-top: 6px; }
.sludge-letter { font-weight: 700; color: var(--gold); font-size: 16px; width: 30px; }

.equip-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pdf-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(201,168,76,0.08);
  border: 1px solid rgba(201,168,76,0.25);
  border-radius: var(--radius);
  padding: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--gold);
  width: 100%;
  cursor: pointer;
}

.equip-group {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
}

.equip-category {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
  padding: 10px 4px 6px;
}

.equip-table {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: visible;
}

.equip-header {
  display: grid;
  grid-template-columns: 2fr 2fr 1fr;
  padding: 8px 14px;
  background: var(--navy-light);
  border-bottom: 1px solid var(--border);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  position: sticky;
  top: 0;
  z-index: 2;
}

.equip-header span:last-child {
  text-align: left;
}

.equip-row {
  display: grid;
  grid-template-columns: 2fr 2fr 1fr;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  align-items: start;
  gap: 8px;
}

.equip-row:last-child { border-bottom: none; }
.equip-name { font-size: 12px; color: var(--white); font-weight: 500; line-height: 1.4; }
.equip-notes { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
.equip-qty { font-size: 11px; color: var(--gold); font-weight: 600; text-align: left; }

.as-available-note {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  padding: 10px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.as-available-note strong {
  color: var(--white);
}

.scroll-top-btn {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 70px);
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--gold);
  color: var(--navy);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
  z-index: 20;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  transition: opacity 0.2s;
}

.med-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.med-view-toggle {
  display: flex;
  background: var(--navy);
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
}

.med-ref-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.med-ref-card {
  display: flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  gap: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.med-ref-card:hover,
.med-ref-card:active {
  border-color: var(--gold);
  background: rgba(201, 168, 76, 0.04);
}

.med-ref-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.med-ref-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--white);
  letter-spacing: 0.02em;
}

.med-ref-alt {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0.05em;
}

.med-ref-type {
  font-size: 11px;
  color: var(--gold);
  margin-top: 2px;
  white-space: pre-line;
  line-height: 1.35;
}

.med-ref-card .chevron {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.med-note {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  padding: 10px 14px;
  background: rgba(201,168,76,0.06);
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: var(--radius-sm);
}

.med-table {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: visible;
}

.med-header {
  display: grid;
  grid-template-columns: 2fr 2fr 1fr 1.5fr;
  padding: 8px 14px;
  background: var(--navy-light);
  border-bottom: 1px solid var(--border);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  position: sticky;
  top: 0;
  z-index: 2;
}

.med-row {
  display: grid;
  grid-template-columns: 2fr 2fr 1fr 1.5fr;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  align-items: start;
  gap: 6px;
}

.med-row:last-child { border-bottom: none; }

.med-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--white);
  line-height: 1.4;
}

.med-concentration {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.med-qty {
  font-size: 11px;
  color: var(--gold);
  font-weight: 600;
}

.med-supplied {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.snippet {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-top: 4px;
}

.snippet :deep(mark) {
  background: rgba(201, 168, 76, 0.3);
  color: var(--gold-light);
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 600;
}

.offline-banner {
  margin-bottom: 12px;
  background: rgba(201, 168, 76, 0.12);
  border: 1px solid rgba(201, 168, 76, 0.35);
  color: var(--gold);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}
</style>