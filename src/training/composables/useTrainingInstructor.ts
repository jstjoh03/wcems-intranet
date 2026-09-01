import { ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Lightweight nav probe: is the signed-in user on the
 * training_instructors allowlist? One query per session, shared
 * module-wide — the masthead and Training page use it to decide
 * whether to show "Manage training". The full training auth store
 * (with disciplines etc.) loads only when the manage section opens.
 */

const isInstructor = ref(false)
let started = false

export function useTrainingInstructor() {
  const auth = useAuthStore()

  if (!started) {
    started = true
    if (auth.usingDevStub) {
      /* Dev: mirror the role switcher — admins act as instructors. */
      watch(
        () => auth.isAdmin,
        (v) => {
          isInstructor.value = !!v
        },
        { immediate: true },
      )
    } else {
      watch(
        () => auth.appUser?.email,
        async (email) => {
          if (!email) {
            isInstructor.value = false
            return
          }
          const { data } = await supabase
            .from('training_instructors')
            .select('id, active')
            .ilike('email', email)
            .maybeSingle()
          isInstructor.value = !!data && (data as { active: boolean }).active
        },
        { immediate: true },
      )
    }
  }

  return { isInstructor: computed(() => isInstructor.value) }
}
