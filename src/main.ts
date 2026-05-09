import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import './assets/main.css'

/**
 * Resolve the auth session BEFORE mount + first navigation. Without
 * this, the router guard would race against `getSession()` and
 * authenticated users would briefly see /signin on hard reload.
 */
async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  const auth = useAuthStore()
  await auth.init()

  app.use(router)
  app.mount('#app')
}

bootstrap()
