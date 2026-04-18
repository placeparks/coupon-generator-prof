# Coupon Generator Admin

Standalone Next.js admin app for generating one-time coupon codes and saving them into the shared Supabase database used by the main storefront.

## What it does

- Generates one-time 10% coupons
- Saves them into the `coupons` table in Supabase
- Shows recent coupon activity and used status
- Can be deployed separately from the main site

## Required database setup

Run the SQL in:

- `../database/migration-add-coupons.sql`

That migration creates:

- `coupons` table
- one-time claim/release functions
- `orders` coupon fields

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `COUPON_ADMIN_TOKEN`

## Local development

```bash
npm install
npm run dev
```

Default local URL:

```text
http://localhost:3001
```

## Deployment

Deploy this folder as its own Next.js app. It should point to the same Supabase project as the customer-facing app so both apps read and write the same `coupons` table.
