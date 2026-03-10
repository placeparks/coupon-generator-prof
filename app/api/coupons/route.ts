import { NextRequest, NextResponse } from 'next/server'
import { COUPON_DISCOUNT_PERCENT, generateCouponCode, sanitizeCouponPrefix } from '@/lib/coupon'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.COUPON_ADMIN_TOKEN
  const providedToken = req.headers.get('x-admin-token')?.trim()

  if (!expectedToken) {
    return { ok: false, status: 500, message: 'COUPON_ADMIN_TOKEN is not configured.' }
  }

  if (!providedToken || providedToken !== expectedToken) {
    return { ok: false, status: 401, message: 'Unauthorized request.' }
  }

  return { ok: true, status: 200, message: '' }
}

export async function GET(req: NextRequest) {
  const auth = isAuthorized(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 })
  }

  const limitParam = Number(req.nextUrl.searchParams.get('limit') || '40')
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 40

  const { data, error } = await (supabase as any)
    .from('coupons')
    .select('id, code, discount_percent, status, created_for, note, created_by, used_by_email, used_by_order_id, created_at, used_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ coupons: data || [] })
}

export async function POST(req: NextRequest) {
  const auth = isAuthorized(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 })
  }

  const body = await req.json()
  const count = Math.min(Math.max(Number(body?.count || 1), 1), 100)
  const prefix = sanitizeCouponPrefix(body?.prefix || 'PLAY')
  const createdFor = typeof body?.createdFor === 'string' ? body.createdFor.trim().slice(0, 120) : ''
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 240) : ''
  const createdBy = typeof body?.createdBy === 'string' ? body.createdBy.trim().slice(0, 120) : 'owner'

  const rows: Array<{
    code: string
    discount_percent: number
    created_for: string | null
    note: string | null
    created_by: string | null
  }> = []

  const codes = new Set<string>()
  while (rows.length < count) {
    const code = generateCouponCode(prefix)
    if (codes.has(code)) {
      continue
    }

    codes.add(code)
    rows.push({
      code,
      discount_percent: COUPON_DISCOUNT_PERCENT,
      created_for: createdFor || null,
      note: note || null,
      created_by: createdBy || null,
    })
  }

  const { data, error } = await (supabase as any)
    .from('coupons')
    .insert(rows as any)
    .select('id, code, discount_percent, status, created_for, note, created_by, used_by_email, used_by_order_id, created_at, used_at')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ coupons: data || [] })
}
