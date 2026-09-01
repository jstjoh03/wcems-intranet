import { supabase } from '@/lib/supabase'

/**
 * Training module Supabase access — re-exports the portal's single
 * client (same project, same session) plus the edge-function invoker
 * the training views use. Anonymous student pages (register / check-in
 * / eval / quiz / engage) never query tables directly; they call the
 * `training-public` Edge Function, which validates the session token
 * server-side with the service-role key.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

export const supabaseUrl = url
export const supabaseAnonKey = publishableKey
export { supabase }

/**
 * Invoke a training Edge Function. Returns parsed JSON or throws with
 * the server's message.
 */
export async function invokeEdge<T = unknown>(
  fn:
    | 'training-create-session'
    | 'training-public'
    | 'training-wix-bookings'
    | 'training-wix-classes'
    | 'training-cancel-session',
  body: Record<string, unknown>,
  opts: { authToken?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: publishableKey,
  }
  if (opts.authToken) headers.Authorization = `Bearer ${opts.authToken}`

  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Server returned a non-JSON response (${res.status}).`)
  }

  if (!res.ok) {
    const message =
      (data as { error?: string; message?: string } | null)?.error ||
      (data as { error?: string; message?: string } | null)?.message ||
      `Request failed (${res.status}).`
    throw new Error(message)
  }

  return data as T
}
