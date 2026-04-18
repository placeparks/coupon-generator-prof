'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, KeyRound, RefreshCcw, ShieldCheck, Ticket, CalendarClock, Upload, Download } from 'lucide-react'

type CouponRecord = {
  id: string
  code: string
  discount_percent: number
  status: 'active' | 'used' | 'void' | 'expired' | 'reserved'
  created_for: string | null
  note: string | null
  created_by: string | null
  used_by_email: string | null
  used_by_order_id: string | null
  created_at: string
  used_at: string | null
  expires_at: string | null
}

const STORAGE_KEY = 'standalone-coupon-admin-token'

export default function HomePage() {
  const [adminToken, setAdminToken] = useState('')
  const [prefix, setPrefix] = useState('PLAY')
  const [count, setCount] = useState(1)
  const [createdFor, setCreatedFor] = useState('')
  const [createdBy, setCreatedBy] = useState('owner')
  const [note, setNote] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const [bulkUploading, setBulkUploading] = useState(false)
  const [coupons, setCoupons] = useState<CouponRecord[]>([])
  const [latestBatch, setLatestBatch] = useState<CouponRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      setAdminToken(stored)
    }
  }, [])

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    'x-admin-token': adminToken,
  }), [adminToken])

  const loadCoupons = async () => {
    if (!adminToken.trim()) {
      return
    }

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch('/api/coupons?limit=40', {
        headers: {
          'x-admin-token': adminToken,
        },
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load coupons.')
      }

      setCoupons(data.coupons || [])
      window.localStorage.setItem(STORAGE_KEY, adminToken)
    } catch (err: any) {
      setError(err.message || 'Failed to load coupons.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCoupons()
  }, [adminToken])

  const generateCoupons = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!adminToken.trim()) {
      setError('Enter the admin token first.')
      return
    }

    setSubmitting(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch('/api/coupons', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prefix,
          count,
          createdFor,
          createdBy,
          note,
          expiresAt: expiresAt || undefined,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate coupons.')
      }

      const batch = data.coupons || []
      setLatestBatch(batch)
      setCoupons((prev) => [...batch, ...prev].slice(0, 40))
      setMessage(`${batch.length} coupon${batch.length === 1 ? '' : 's'} generated and saved to Supabase.`)
      window.localStorage.setItem(STORAGE_KEY, adminToken)

      // Clear per-batch fields so the next generation starts fresh.
      // Keep adminToken, createdBy, and prefix since those are session-level settings.
      setCreatedFor('')
      setNote('')
      setExpiresAt('')
      setCount(1)
    } catch (err: any) {
      setError(err.message || 'Failed to generate coupons.')
    } finally {
      setSubmitting(false)
    }
  }

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setMessage('Coupon codes copied.')
      setError('')
    } catch {
      setError('Failed to copy coupon codes.')
    }
  }

  const releaseCoupon = async (opts: { code?: string; all?: boolean }) => {
    if (!adminToken.trim()) {
      setError('Enter the admin token first.')
      return
    }

    setError('')
    setMessage('')

    try {
      const response = await fetch('/api/coupons/release', {
        method: 'POST',
        headers,
        body: JSON.stringify(opts),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to release coupon.')
      }

      setMessage(`Released ${data.released} reserved coupon${data.released === 1 ? '' : 's'} back to active.`)
      loadCoupons()
    } catch (err: any) {
      setError(err.message || 'Failed to release coupon.')
    }
  }

  const uploadBulk = async () => {
    if (!adminToken.trim()) {
      setError('Enter the admin token first.')
      return
    }
    if (!bulkFile) {
      setError('Choose an Excel file first.')
      return
    }

    setBulkUploading(true)
    setError('')
    setMessage('')

    try {
      const fd = new FormData()
      fd.append('file', bulkFile)
      fd.append('prefix', prefix)
      fd.append('createdBy', createdBy)
      if (note) fd.append('note', note)
      if (expiresAt) fd.append('expiresAt', expiresAt)

      const response = await fetch('/api/coupons/bulk', {
        method: 'POST',
        headers: { 'x-admin-token': adminToken },
        body: fd,
      })

      if (!response.ok) {
        let msg = 'Bulk upload failed.'
        try {
          const data = await response.json()
          if (data?.error) msg = data.error
        } catch {}
        throw new Error(msg)
      }

      const generated = response.headers.get('x-generated-count') || '0'
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = response.headers.get('content-disposition') || ''
      const match = cd.match(/filename="?([^"]+)"?/i)
      a.download = match?.[1] || 'coupons-with-codes.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      setMessage(`Generated ${generated} coupon${generated === '1' ? '' : 's'} from the sheet. File downloaded.`)

      // Clear per-batch fields and the picked file so the next upload starts fresh.
      setCreatedFor('')
      setNote('')
      setExpiresAt('')
      setBulkFile(null)
      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
      if (fileInput) fileInput.value = ''

      loadCoupons()
    } catch (err: any) {
      setError(err.message || 'Bulk upload failed.')
    } finally {
      setBulkUploading(false)
    }
  }

  return (
    <main className="coupon-admin-page">
      <div className="coupon-admin-shell">
        <section className="coupon-admin-hero">
          <div style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid rgba(148,163,184,0.28)',
            borderRadius: 28,
            padding: 28,
            boxShadow: '0 24px 80px rgba(15,23,42,0.08)'
          }}>
            <div className="coupon-admin-header">
              <div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: 999,
                  padding: '8px 12px',
                  border: '1px solid #bae6fd',
                  background: '#f0f9ff',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: '#0369a1'
                }}>
                  <Ticket size={14} />
                  Standalone Admin
                </div>
                <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3.4rem)', lineHeight: 1, margin: '18px 0 12px', fontWeight: 900 }}>
                  Generate one-time 10% coupons
                </h1>
                <p style={{ margin: 0, color: '#475569', fontSize: 15, lineHeight: 1.7, maxWidth: 720 }}>
                  This is a separate deployable project. Every generated code is inserted into the shared Supabase database and can be redeemed only once by the checkout app.
                </p>
              </div>
              <button
                type="button"
                onClick={loadCoupons}
                className="coupon-admin-refresh"
              >
                <RefreshCcw size={15} className={loading ? 'spin' : ''} />
                Refresh
              </button>
            </div>

            <form onSubmit={generateCoupons} autoComplete="off">
              <div className="coupon-admin-grid coupon-admin-grid-2">
                <Field label="Admin token" icon={<KeyRound size={16} />}>
                  <input
                    type="password"
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    placeholder="Enter owner token"
                    style={inputStyle(true)}
                  />
                </Field>
                <Field label="Created by">
                  <input
                    type="text"
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                    placeholder="owner"
                    style={inputStyle()}
                    autoComplete="off"
                    name="coupon-created-by"
                  />
                </Field>
              </div>

              <div className="coupon-admin-grid coupon-admin-grid-3">
                <Field label="Prefix">
                  <input
                    type="text"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                    maxLength={6}
                    placeholder="PLAY"
                    style={inputStyle()}
                    autoComplete="off"
                    name="coupon-prefix"
                  />
                </Field>
                <Field label="How many">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    style={inputStyle()}
                  />
                </Field>
                <div style={{
                  borderRadius: 24,
                  border: '1px solid #bbf7d0',
                  background: '#f0fdf4',
                  padding: 16
                }}>
                  <div style={smallLabelStyle}>Discount</div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: '#14532d', marginTop: 6 }}>10%</div>
                </div>
              </div>

              <div className="coupon-admin-grid coupon-admin-grid-2">
                <Field label="For client / user">
                  <input
                    type="text"
                    value={createdFor}
                    onChange={(e) => setCreatedFor(e.target.value)}
                    placeholder="Jane Smith"
                    style={inputStyle()}
                    autoComplete="off"
                    name="coupon-created-for"
                  />
                </Field>
                <Field label="Note">
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Support courtesy"
                    style={inputStyle()}
                    autoComplete="off"
                    name="coupon-note"
                  />
                </Field>
              </div>

              <div className="coupon-admin-grid coupon-admin-grid-2">
                <Field label="Expires at (optional)" icon={<CalendarClock size={16} />}>
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    style={inputStyle(true)}
                  />
                </Field>
                <div style={{
                  borderRadius: 24,
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  padding: 16,
                  fontSize: 13,
                  color: '#475569',
                  lineHeight: 1.6
                }}>
                  Leave blank for codes that never expire. Expiry is enforced by the storefront at redemption time.
                </div>
              </div>

              <div className="coupon-admin-actions">
                <button type="submit" disabled={submitting} style={primaryButtonStyle} className="coupon-admin-action-button">
                  <ShieldCheck size={16} />
                  {submitting ? 'Generating...' : 'Generate coupons'}
                </button>
                {latestBatch.length > 0 && (
                  <button type="button" onClick={() => copyCodes(latestBatch.map((item) => item.code))} style={secondaryButtonStyle} className="coupon-admin-action-button">
                    <Copy size={16} />
                    Copy latest batch
                  </button>
                )}
              </div>
            </form>

            {(message || error) && (
              <div style={{
                marginTop: 18,
                borderRadius: 20,
                padding: '14px 16px',
                border: `1px solid ${error ? '#fecaca' : '#bbf7d0'}`,
                background: error ? '#fef2f2' : '#f0fdf4',
                color: error ? '#b91c1c' : '#166534',
                fontSize: 14,
                fontWeight: 600
              }}>
                {error || message}
              </div>
            )}
          </div>

          <div style={{
            background: '#020617',
            color: '#fff',
            borderRadius: 28,
            padding: 28,
            boxShadow: '0 24px 80px rgba(15,23,42,0.18)'
          }}>
            <div style={smallLabelStyleDark}>Latest batch</div>
            <h2 style={{ fontSize: 32, lineHeight: 1.05, margin: '14px 0 12px', fontWeight: 900 }}>Ready to send</h2>
            <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.7, fontSize: 15 }}>
              Deploy this admin app separately, but point it to the same Supabase project. The customer-facing site will still validate and burn these codes from the same `coupons` table.
            </p>

            <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
              {latestBatch.length === 0 && (
                <div style={{
                  borderRadius: 24,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.05)',
                  padding: 18,
                  color: '#cbd5e1'
                }}>
                  Generate a batch to see fresh codes here.
                </div>
              )}
              {latestBatch.map((coupon) => (
                <div key={coupon.id} style={{
                  borderRadius: 24,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.05)',
                  padding: 16
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
                    <div>
                      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 24, fontWeight: 800, letterSpacing: '0.12em' }}>
                        {coupon.code}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#7dd3fc', fontWeight: 700 }}>
                        {coupon.discount_percent}% off
                      </div>
                    </div>
                    <button type="button" onClick={() => copyCodes([coupon.code])} style={iconButtonStyle}>
                      <Copy size={15} />
                    </button>
                  </div>
                  {(coupon.created_for || coupon.note) && (
                    <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 13 }}>
                      {coupon.created_for ? `For: ${coupon.created_for}` : ''}
                      {coupon.created_for && coupon.note ? ' | ' : ''}
                      {coupon.note || ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{
          marginTop: 24,
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid rgba(148,163,184,0.28)',
          borderRadius: 28,
          padding: 28,
          boxShadow: '0 24px 80px rgba(15,23,42,0.08)'
        }}>
          <div style={smallLabelStyle}>Bulk from Excel</div>
          <h2 style={{ margin: '10px 0 6px', fontSize: 24, fontWeight: 900 }}>Upload a sheet of emails</h2>
          <p style={{ margin: 0, color: '#475569', fontSize: 14, lineHeight: 1.6, maxWidth: 720 }}>
            Upload an <code>.xlsx</code> file with an <code>email</code> column. One coupon will be generated per valid email (using the prefix, expiry and note above), saved to Supabase, and a copy of the file with a new <code>coupon_code</code> column will download automatically.
          </p>
          <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
              style={{ flex: '1 1 260px', minHeight: 52, padding: 12, borderRadius: 18, border: '1px dashed #cbd5e1', background: '#fff' }}
            />
            <button
              type="button"
              onClick={uploadBulk}
              disabled={bulkUploading || !bulkFile}
              style={{ ...primaryButtonStyle, opacity: bulkUploading || !bulkFile ? 0.6 : 1 }}
              className="coupon-admin-action-button"
            >
              {bulkUploading ? <Upload size={16} /> : <Download size={16} />}
              {bulkUploading ? 'Processing...' : 'Generate & download'}
            </button>
          </div>
        </section>

        <section style={{
          marginTop: 24,
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid rgba(148,163,184,0.28)',
          borderRadius: 28,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(15,23,42,0.08)'
        }}>
          <div style={{
            padding: '22px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'center'
          }}>
            <div>
              <div style={smallLabelStyle}>Recent coupons</div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900 }}>Supabase activity</div>
              {(() => {
                const withExpiry = coupons.filter((c) => !!c.expires_at)
                if (withExpiry.length === 0) return null
                const redeemed = withExpiry.filter((c) => c.status === 'used').length
                const stillActive = withExpiry.filter((c) => c.status === 'active').length
                const expiredUnused = withExpiry.filter((c) => c.status === 'expired').length
                return (
                  <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, fontWeight: 700 }}>
                    <span style={statPillStyle('#e0f2fe', '#0369a1')}>With expiry: {withExpiry.length}</span>
                    <span style={statPillStyle('#dcfce7', '#166534')}>Redeemed: {redeemed}</span>
                    <span style={statPillStyle('#ecfeff', '#0e7490')}>Active: {stillActive}</span>
                    <span style={statPillStyle('#fee2e2', '#991b1b')}>Expired unused: {expiredUnused}</span>
                  </div>
                )
              })()}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {coupons.some((c) => c.status === 'reserved') && (
                <button
                  type="button"
                  onClick={() => releaseCoupon({ all: true })}
                  style={{
                    borderRadius: 999,
                    border: '1px solid #fde68a',
                    background: '#fef9c3',
                    color: '#854d0e',
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                  title="Flip every reserved coupon back to active"
                >
                  Release all reserved
                </button>
              )}
              <div style={{
                borderRadius: 999,
                background: '#f1f5f9',
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 800,
                color: '#475569'
              }}>
                {coupons.length} shown
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead style={{ background: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 11, color: '#64748b' }}>
                <tr>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Created for</th>
                  <th style={thStyle}>Used by</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Expires</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                      {loading ? 'Loading coupons...' : 'No coupons loaded yet.'}
                    </td>
                  </tr>
                )}
                {coupons.map((coupon) => (
                  <tr key={coupon.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={tdMonoStyle}>{coupon.code}</td>
                    <td style={tdStyle}>
                      <span style={{
                        borderRadius: 999,
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        letterSpacing: '0.18em',
                        background:
                          coupon.status === 'used' ? '#fef3c7'
                          : coupon.status === 'expired' ? '#fee2e2'
                          : coupon.status === 'void' ? '#e2e8f0'
                          : coupon.status === 'reserved' ? '#fef9c3'
                          : '#dcfce7',
                        color:
                          coupon.status === 'used' ? '#92400e'
                          : coupon.status === 'expired' ? '#991b1b'
                          : coupon.status === 'void' ? '#475569'
                          : coupon.status === 'reserved' ? '#854d0e'
                          : '#166534'
                      }}>
                        {coupon.status}
                      </span>
                    </td>
                    <td style={tdStyle}>{coupon.created_for || '-'}</td>
                    <td style={tdStyle}>{coupon.used_by_email || '-'}</td>
                    <td style={tdStyle}>{new Date(coupon.created_at).toLocaleString()}</td>
                    <td style={tdStyle}>
                      {coupon.expires_at ? (
                        <span style={{
                          color: new Date(coupon.expires_at).getTime() < Date.now() ? '#b91c1c' : '#475569',
                          fontWeight: new Date(coupon.expires_at).getTime() < Date.now() ? 700 : 500,
                        }}>
                          {new Date(coupon.expires_at).toLocaleString()}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={tdStyle}>
                      {coupon.status === 'reserved' ? (
                        <button
                          type="button"
                          onClick={() => releaseCoupon({ code: coupon.code })}
                          style={{
                            borderRadius: 999,
                            border: '1px solid #fde68a',
                            background: '#fef9c3',
                            color: '#854d0e',
                            padding: '6px 12px',
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          Release
                        </button>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}

function Field({
  label,
  children,
  icon,
}: {
  label: string
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <label className="coupon-admin-field">
      <span style={smallLabelStyle}>{label}</span>
      <div style={{ position: 'relative', marginTop: 8 }}>
        {icon && (
          <span style={{
            position: 'absolute',
            left: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#64748b',
            display: 'inline-flex'
          }}>
            {icon}
          </span>
        )}
        {children}
      </div>
    </label>
  )
}

function inputStyle(withIcon?: boolean): React.CSSProperties {
  return {
    width: '100%',
    borderRadius: 18,
    border: '1px solid #cbd5e1',
    background: '#fff',
    padding: withIcon ? '14px 14px 14px 42px' : '14px',
    fontSize: 15,
    color: '#0f172a',
    outline: 'none',
    minHeight: 52,
  }
}

const smallLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#64748b'
}

const smallLabelStyleDark: React.CSSProperties = {
  ...smallLabelStyle,
  color: '#7dd3fc'
}

const primaryButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  border: 'none',
  background: '#020617',
  color: '#fff',
  padding: '14px 18px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  fontWeight: 800
}

const secondaryButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#334155',
  padding: '14px 18px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  fontWeight: 800
}

const iconButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'transparent',
  color: '#fff',
  padding: 10,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer'
}

const thStyle: React.CSSProperties = {
  padding: '16px 24px',
  textAlign: 'left'
}

const tdStyle: React.CSSProperties = {
  padding: '16px 24px',
  color: '#475569',
  fontSize: 14
}

function statPillStyle(bg: string, color: string): React.CSSProperties {
  return {
    borderRadius: 999,
    padding: '6px 12px',
    background: bg,
    color,
    letterSpacing: '0.04em',
  }
}

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#0f172a',
  fontWeight: 800
}
