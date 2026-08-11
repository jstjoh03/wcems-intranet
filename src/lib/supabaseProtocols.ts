import { createClient } from '@supabase/supabase-js'

/**
 * Second Supabase client for the Protocols section — the protocols
 * content (protocols/equipment/medications tables + the storage bucket
 * with the full 2026 PDF) still lives in its own Supabase project,
 * carried over as-is when the standalone protocols PWA was absorbed
 * into the portal. Consolidating it into the main project is a later
 * phase; until then this client is the only thing that knows.
 */
const url = import.meta.env.VITE_PROTOCOLS_SUPABASE_URL
const key = import.meta.env.VITE_PROTOCOLS_SUPABASE_KEY

export const supabase = createClient(url, key)
