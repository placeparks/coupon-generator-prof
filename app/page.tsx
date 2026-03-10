'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, KeyRound, RefreshCcw, ShieldCheck, Ticket } from 'lucide-react'

type CouponRecord = {
  id: string
  code: string
  discount_percent: number
  status: 'active' | 'used' | 'void'
  created_for: string | null
  note: string | null
  created_by: string | null
  used_by_email: string | null
  used_by_order_id: string | null
  created_at: string
  used_at: string | null
}

const STORAGE_KEY = 'standalone-coupon-admin-token'

export default function HomePage() {
  const [adminToken, setAdminToken] = useState('')
  const [prefix, setPrefix] = useState('PLAY')
  const [count, setCount] = useState(1)
  const [createdFor, setCreatedFor] = useState('')
  const [createdBy, setCreatedBy] = useState('owner')
  const [note, setNote] = useState('')
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

  return (
    <main style={{ minHeight: '100vh', padding: '32px 16px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <section style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)',
          gap: 24,
          alignItems: 'start'
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid rgba(148,163,184,0.28)',
            borderRadius: 28,
            padding: 28,
            boxShadow: '0 24px 80px rgba(15,23,42,0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start', marginBottom: 24 }}>
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
                style={{
                  borderRadius: 999,
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  padding: '12px 16px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <RefreshCcw size={15} className={loading ? 'spin' : ''} />
                Refresh
              </button>
            </div>

            <form onSubmit={generateCoupons}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
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
                  />
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                <Field label="Prefix">
                  <input
                    type="text"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                    maxLength={6}
                    placeholder="PLAY"
                    style={inputStyle()}
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <Field label="For client / user">
                  <input
                    type="text"
                    value={createdFor}
                    onChange={(e) => setCreatedFor(e.target.value)}
                    placeholder="Jane Smith"
                    style={inputStyle()}
                  />
                </Field>
                <Field label="Note">
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Support courtesy"
                    style={inputStyle()}
                  />
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button type="submit" disabled={submitting} style={primaryButtonStyle}>
                  <ShieldCheck size={16} />
                  {submitting ? 'Generating...' : 'Generate coupons'}
                </button>
                {latestBatch.length > 0 && (
                  <button type="button" onClick={() => copyCodes(latestBatch.map((item) => item.code))} style={secondaryButtonStyle}>
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
            </div>
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

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead style={{ background: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 11, color: '#64748b' }}>
                <tr>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Created for</th>
                  <th style={thStyle}>Used by</th>
                  <th style={thStyle}>Created</th>
                </tr>
              </thead>
              <tbody>
                {coupons.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
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
                        background: coupon.status === 'used' ? '#fef3c7' : '#dcfce7',
                        color: coupon.status === 'used' ? '#92400e' : '#166534'
                      }}>
                        {coupon.status}
                      </span>
                    </td>
                    <td style={tdStyle}>{coupon.created_for || '-'}</td>
                    <td style={tdStyle}>{coupon.used_by_email || '-'}</td>
                    <td style={tdStyle}>{new Date(coupon.created_at).toLocaleString()}</td>
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
    <label style={{ display: 'block' }}>
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

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#0f172a',
  fontWeight: 800
}
