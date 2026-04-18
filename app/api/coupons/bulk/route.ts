import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const auth = isAuthorized(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field.' }, { status: 400 })
  }

  const prefix = sanitizeCouponPrefix(String(form.get('prefix') || 'PLAY'))
  const createdBy = String(form.get('createdBy') || 'owner').trim().slice(0, 120) || 'owner'
  const note = String(form.get('note') || '').trim().slice(0, 240)
  const expiresAtRaw = String(form.get('expiresAt') || '').trim()

  let expiresAt: string | null = null
  if (expiresAtRaw) {
    const parsed = new Date(expiresAtRaw)
    if (!Number.isNaN(parsed.getTime())) {
      expiresAt = parsed.toISOString()
    }
  }

  // Parse workbook
  let workbook: XLSX.WorkBook
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    workbook = XLSX.read(buf, { type: 'buffer' })
  } catch (err: any) {
    return NextResponse.json({ error: 'Could not parse file as a spreadsheet.' }, { status: 400 })
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return NextResponse.json({ error: 'Workbook has no sheets.' }, { status: 400 })
  }
  const sheet = workbook.Sheets[sheetName]

  // Rows as array-of-arrays so we can preserve/extend the sheet structure
  const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false })
  if (aoa.length === 0) {
    return NextResponse.json({ error: 'Sheet is empty.' }, { status: 400 })
  }

  // Detect header row: if the first row contains any cell that looks like an email, treat as data with no header.
  let headerRow: any[] | null = aoa[0]
  let dataStart = 1
  const firstRowHasEmail = headerRow.some((c) => typeof c === 'string' && EMAIL_RE.test(c.trim()))
  if (firstRowHasEmail) {
    headerRow = null
    dataStart = 0
  }

  // Find email column index
  let emailCol = 0
  if (headerRow) {
    const idx = headerRow.findIndex((c) => typeof c === 'string' && c.trim().toLowerCase() === 'email')
    emailCol = idx >= 0 ? idx : 0
  }

  // Build/ensure header with a coupon_code column
  let couponCol: number
  if (headerRow) {
    const existing = headerRow.findIndex((c) => typeof c === 'string' && c.trim().toLowerCase() === 'coupon_code')
    if (existing >= 0) {
      couponCol = existing
    } else {
      couponCol = headerRow.length
      headerRow.push('coupon_code')
      aoa[0] = headerRow
    }
  } else {
    // Synthesize a header row
    const widest = Math.max(...aoa.map((r) => r.length))
    const synth: any[] = new Array(widest).fill('')
    synth[0] = 'email'
    couponCol = widest
    synth.push('coupon_code')
    aoa.unshift(synth)
    dataStart = 1
    emailCol = 0
    headerRow = synth
  }

  // Generate rows
  const rowsToInsert: Array<{
    code: string
    discount_percent: number
    created_for: string | null
    note: string | null
    created_by: string | null
    expires_at: string | null
  }> = []

  const codes = new Set<string>()
  const generatedPerRow: Array<{ rowIndex: number; code: string }> = []

  for (let i = dataStart; i < aoa.length; i++) {
    const row = aoa[i]
    const rawEmail = row[emailCol]
    const email = typeof rawEmail === 'string' ? rawEmail.trim() : ''
    if (!email || !EMAIL_RE.test(email)) {
      continue
    }

    let code = generateCouponCode(prefix)
    // avoid dup within this batch
    let guard = 0
    while (codes.has(code) && guard < 5) {
      code = generateCouponCode(prefix)
      guard++
    }
    codes.add(code)

    rowsToInsert.push({
      code,
      discount_percent: COUPON_DISCOUNT_PERCENT,
      created_for: email,
      note: note || null,
      created_by: createdBy,
      expires_at: expiresAt,
    })
    generatedPerRow.push({ rowIndex: i, code })
  }

  if (rowsToInsert.length === 0) {
    return NextResponse.json({ error: 'No valid email addresses found in the sheet.' }, { status: 400 })
  }

  const { error } = await (supabase as any).from('coupons').insert(rowsToInsert as any)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Write coupon codes back into the sheet
  for (const { rowIndex, code } of generatedPerRow) {
    const row = aoa[rowIndex]
    while (row.length <= couponCol) row.push('')
    row[couponCol] = code
  }

  const newSheet = XLSX.utils.aoa_to_sheet(aoa)
  workbook.Sheets[sheetName] = newSheet

  const outBuf: Buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const outBlob = new Blob([new Uint8Array(outBuf)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const originalName = (file.name || 'coupons.xlsx').replace(/\.(xlsx|xls|csv)$/i, '')
  const downloadName = `${originalName}-with-coupons.xlsx`

  return new NextResponse(outBlob, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'x-generated-count': String(rowsToInsert.length),
    },
  })
}
