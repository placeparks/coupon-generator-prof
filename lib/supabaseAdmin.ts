import { createClient } from '@supabase/supabase-js'

let supabaseAdmin: ReturnType<typeof createClient> | null = null

export function getSupabaseAdmin() {
  if (supabaseAdmin) {
    return supabaseAdmin
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key || url.includes('your-supabase-url')) {
    return null
  }

  supabaseAdmin = createClient(url, key)
  return supabaseAdmin
}
