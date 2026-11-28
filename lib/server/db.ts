import "server-only"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let client: SupabaseClient | undefined

/**
 * Supabase with the secret key: full access, Row Level Security bypassed.
 * Server only. Every query on student data must filter by the signed-in user's id.
 */
export function db(): SupabaseClient {
  if (client) return client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}
