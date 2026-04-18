import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.COUPON_ADMIN_TOKEN
  const providedToken = req.headers.get('x-admin-token')?.trim()
  if (!expectedToken) return { ok: false, status: 500, message: 'COUPON_ADMIN_TOKEN is not configured.' }
  if (!providedToken || providedToken !== expectedToken) return { ok: false, status: 401, message: 'Unauthorized request.' }
  return { ok: true, status: 200, message: '' }
}

// POST /api/coupons/release
// Body: { code?: string, all?: boolean }
// - If `code` is provided: release that single coupon (reserved -> active).
// - If `all` is true: release every row currently in 'reserved' status.
// Does NOT touch 'used' rows — those are final.
export async function POST(req: NextRequest) {
  const auth = isAuthorized(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const code: string | undefined = typeof body?.code === 'string' ? body.code.trim() : undefined
  const releaseAll: boolean = body?.all === true

  if (!code && !releaseAll) {
    return NextResponse.json({ error: 'Provide { code } or { all: true }.' }, { status: 400 })
  }

  let query = (supabase as any)
    .from('coupons')
    .update({ status: 'active', used_by_email: null, used_by_order_id: null, used_at: null })
    .eq('status', 'reserved')

  if (code) {
    query = query.eq('code', code)
  }

  const { data, error } = await query.select('id, code, status')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ released: Array.isArray(data) ? data.length : 0, coupons: data || [] })
}
