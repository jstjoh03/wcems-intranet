import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
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
    path: '/admin/stations',
    name: 'admin-stations',
    component: () => import('@/views/admin/ManageStationsView.vue'),
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
