import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Coupon Generator Admin',
  description: 'Standalone admin app for generating one-time Supabase-backed coupons.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
