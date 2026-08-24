import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/signin',
    name: 'signin',
    component: () => import('@/views/SignInView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
  },
  {
    path: '/hospitals',
    name: 'hospitals',
    component: () => import('@/views/HospitalsView.vue'),
  },
  {
    path: '/insights',
    name: 'insights',
    component: () => import('@/views/InsightsView.vue'),
  },
  {
    path: '/admin-staff',
    name: 'admin-staff',
    component: () => import('@/views/AdminStaffView.vue'),
  },
  {
    path: '/directory',
    name: 'directory',
    component: () => import('@/views/DirectoryView.vue'),
  },
  {
    path: '/gallery',
    name: 'gallery',
    component: () => import('@/views/GalleryView.vue'),
  },
  {
    path: '/training',
    name: 'training',
    component: () => import('@/views/TrainingView.vue'),
  },
  {
    path: '/training/recordings',
    name: 'training-recordings',
    component: () => import('@/views/TrainingRecordingsView.vue'),
  },
  {
    path: '/admin/stations',
    name: 'admin-stations',
    component: () => import('@/views/admin/ManageStationsView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/hospitals',
    name: 'admin-hospitals',
    component: () => import('@/views/admin/ManageHospitalsView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/employees',
    name: 'admin-employees',
    component: () => import('@/views/admin/ManageEmployeesView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/call-volume',
    name: 'admin-call-volume',
    component: () => import('@/views/admin/ManageCallVolumeView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/training',
    name: 'admin-training',
    component: () => import('@/views/admin/ManageTrainingView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/training-recordings',
    name: 'admin-training-recordings',
    component: () => import('@/views/admin/ManageTrainingRecordingsView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/quick-links',
    name: 'admin-quick-links',
    component: () => import('@/views/admin/ManageQuickLinksView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/usage',
    name: 'admin-usage',
    component: () => import('@/views/admin/AdminUsageView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/training/required',
    name: 'required-training',
    component: () => import('@/views/RequiredTrainingView.vue'),
  },
  {
    path: '/training/required/:id',
    name: 'required-training-detail',
    component: () => import('@/views/RequiredTrainingDetailView.vue'),
  },
  {
    path: '/admin/required-training',
    name: 'admin-required-training',
    component: () => import('@/views/admin/ManageRequiredTrainingView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/required-training/:id',
    name: 'admin-required-training-roster',
    component: () => import('@/views/admin/RequiredTrainingRosterView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/policies',
    name: 'policies',
    component: () => import('@/views/PoliciesView.vue'),
  },
  {
    path: '/policies/:id',
    name: 'policy-detail',
    component: () => import('@/views/PolicyDetailView.vue'),
  },
  {
    path: '/admin/policies',
    name: 'admin-policies',
    component: () => import('@/views/admin/ManagePoliciesView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/policies/:id',
    name: 'admin-policy-roster',
    component: () => import('@/views/admin/PolicyRosterView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/admin/admin-staff',
    name: 'admin-admin-staff',
    component: () => import('@/views/admin/ManageAdminStaffView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/mih-referral',
    name: 'mih-referral',
    component: () => import('@/views/MihReferralView.vue'),
  },
  /* Adaptive: full board for supervisors/editors/FTOs, own "My
     Progress" for everyone else. RLS mirrors the split server-side,
     so no route-level role gate is needed. */
  {
    path: '/clinical-development',
    name: 'clinical-development',
    component: () => import('@/views/ClinicalDevelopmentView.vue'),
  },
  /* ── Redesigned Clinical Development section (phase 1) ───────────
     Soft-launched: reachable by URL for board viewers while the
     legacy board above stays in the nav. Views redirect non-viewers
     to /clinical-development; RLS enforces server-side. */
  {
    path: '/clinical',
    name: 'clinical-home',
    component: () => import('@/views/clinical/ClinicalHomeView.vue'),
  },
  {
    path: '/clinical/people',
    name: 'clinical-people',
    component: () => import('@/views/clinical/ClinicalPeopleView.vue'),
  },
  {
    path: '/clinical/people/:id',
    name: 'clinical-file',
    component: () => import('@/views/clinical/ClinicalFileView.vue'),
  },
  {
    path: '/clinical/ftep',
    name: 'clinical-ftep',
    component: () => import('@/views/clinical/FtepHomeView.vue'),
  },
  {
    path: '/clinical/submissions',
    name: 'clinical-submissions',
    component: () => import('@/views/clinical/FtepSubmissionsView.vue'),
  },
  {
    path: '/clinical/ftep/:kind(dor|icr)/:traineeId',
    name: 'clinical-ftep-report',
    component: () => import('@/views/clinical/FtepReportView.vue'),
  },
  /* Skills Day: adaptive — station runner + live board for
     evaluators (admins/supervisors/FTOs/grants), own results for
     candidates. RLS enforces the write rules server-side. */
  {
    path: '/skills',
    name: 'skills-day',
    component: () => import('@/views/SkillsDayView.vue'),
  },
  {
    path: '/skills/:checkoffId/:candidateId',
    name: 'skills-evaluate',
    component: () => import('@/views/SkillsEvaluateView.vue'),
  },
  /* ── Protocols section (absorbed standalone app) ─────────────────
     Chromeless: these views are a self-contained full-viewport dark
     app (own header, 100dvh scroll) — the portal chrome stays out of
     the way, same as /signin. Auth guard still applies. */
  {
    path: '/protocols',
    name: 'protocols',
    component: () => import('@/views/protocols/ProtocolsHomeView.vue'),
    meta: { chromeless: true },
  },
  {
    path: '/protocols/protocol/:id',
    name: 'protocols-protocol',
    component: () => import('@/views/protocols/ProtocolView.vue'),
    meta: { chromeless: true },
  },
  {
    path: '/protocols/medication/:id',
    name: 'protocols-medication',
    component: () => import('@/views/protocols/MedicationView.vue'),
    meta: { chromeless: true },
  },
  {
    path: '/admin/protocols',
    name: 'admin-protocols',
    component: () => import('@/views/protocols/ManageProtocolsView.vue'),
    meta: { adminOnly: true, chromeless: true },
  },
  /* Badge maker: full-viewport dark tool with its own print CSS —
     chromeless like the protocols app. */
  {
    path: '/admin/badge-maker',
    name: 'admin-badge-maker',
    component: () => import('@/views/admin/BadgeMakerView.vue'),
    meta: { adminOnly: true, chromeless: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, top: 84, behavior: 'smooth' }
    return { top: 0 }
  },
})

/**
 * Auth guard. The auth store is initialized in `main.ts` before
 * mount, so by the time this fires `auth.ready` is already true.
 *
 * - Public routes (currently just /signin) bypass the guard.
 * - Unauthenticated users get pushed to /signin with a `next` query so
 *   we bounce them back after sign-in.
 * - Admin-only routes 404 for non-admins instead of redirecting (we
 *   don't want to leak which routes exist).
 */
router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.public) return true

  if (!auth.isAuthenticated) {
    return {
      name: 'signin',
      query: to.fullPath !== '/' ? { next: to.fullPath } : undefined,
    }
  }

  if (to.meta.adminOnly && !auth.isAdmin) {
    return { name: 'not-found' }
  }

  return true
})
