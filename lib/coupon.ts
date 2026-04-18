import { randomBytes } from 'crypto'

export const COUPON_DISCOUNT_PERCENT = 10

export function sanitizeCouponPrefix(input: string) {
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return cleaned || 'PLAY'
}

export function generateCouponCode(prefix: string) {
  const safePrefix = sanitizeCouponPrefix(prefix)
  const token = randomBytes(4).toString('hex').toUpperCase()
  return `${safePrefix}-${token.slice(0, 4)}-${token.slice(4, 8)}`
}
