import { createClient } from '@supabase/supabase-js'

/**
 * Single Supabase client for the whole app.
 *
 * Auth flow: user clicks "Sign in with Microsoft" → Supabase routes them
 * to Entra ID → they come back with a Supabase session that supabase-js
 * persists in localStorage and refreshes automatically. Our auth store
 * subscribes to `onAuthStateChange` to keep `appUser` in sync.
 *
 * For RLS policies later: every query through this client carries the
 * user's JWT, so policies can read `auth.uid()` and the role claim.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined

if (!url || !publishableKey) {
  throw new Error(
    'Missing Supabase env vars. Expected VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY in .env.local — copy them from the ' +
      "Supabase project settings → API.",
  )
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
