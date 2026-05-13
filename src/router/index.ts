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
