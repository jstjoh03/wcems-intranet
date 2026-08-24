import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Lightweight clinical-access probe for global chrome (masthead/drawer)
 * — answers "is this user an FTO?" and "a clinical editor?" with two
 * single-row queries instead of pulling the whole pipeline into every
 * page. The clinical views themselves still use usePipeline's canEdit /
 * canViewBoard (which RLS backs); this exists only so the nav can label
 * and target the right landing page:
 *   editors             → Clinical Development (/clinical)
 *   supervisors & FTOs  → FTEP (/clinical/ftep)
 *   everyone else       → My Progress (/clinical-development)
 */

const isFto = ref(false)
const isEditor = ref(false)
let loadStarted = false

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) return // dev derives from the live role toggle below
  const uid = auth.appUser?.id
  if (!uid || auth.isKiosk) return
  const [ftoRes, edRes] = await Promise.all([
    supabase.from('pipeline_records').select('is_fto').eq('user_id', uid).maybeSingle(),
    supabase.from('pipeline_editors').select('user_id').eq('user_id', uid).maybeSingle(),
  ])
  isFto.value = !!ftoRes.data?.is_fto
  isEditor.value = !!edRes.data
}

export function useClinicalAccess() {
  void load()
  const auth = useAuthStore()

  /* Dev stub mirrors the top-bar role switcher (admin = editor) so all
     three experiences stay testable; live reads the real grant/flag. */
  const editor = computed(() => (auth.usingDevStub ? auth.isAdmin : isEditor.value))
  const fto = computed(() => (auth.usingDevStub ? false : isFto.value))

  /** Where the clinical nav entry should take this user, and what to
   *  call it. */
  const clinicalNav = computed(() => {
    if (editor.value) return { label: 'Clinical Development', to: '/clinical' }
    if (auth.isSupervisor || fto.value) return { label: 'FTEP', to: '/clinical/ftep' }
    return { label: 'My Progress', to: '/clinical-development' }
  })

  return { isFto: fto, isEditor: editor, clinicalNav }
}
