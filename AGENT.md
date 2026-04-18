# AGENT.md — Coupon Generator Admin

> Living onboarding doc for any future AI agent / developer working on this project. Keep this in sync with code changes.

## 1. What this project is

A **standalone Next.js 14 admin app** (runs on port `3001`) whose only job is to generate one-time discount coupon codes and save them into a **shared Supabase `coupons` table**. The actual storefront / checkout lives in a different project but reads from the same Supabase database, so coupons generated here can be redeemed there.

- Framework: Next.js 14 App Router, TypeScript, React 18
- Auth: single shared bearer token (`COUPON_ADMIN_TOKEN`) sent as `x-admin-token` header
- DB: Supabase (service-role key on the server only)
- No git repo in this folder — treat edits as direct file changes
- Platform note: developed on Windows, bash shell

## 2. Directory map

```
coupon-generator-prof-main/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # main admin UI (client component)
│   ├── globals.css
│   └── api/
│       └── coupons/
│           ├── route.ts      # GET (list) + POST (generate N codes)
│           └── bulk/
│               └── route.ts  # POST multipart xlsx → generates one coupon per email, returns xlsx
├── lib/
│   ├── coupon.ts             # code generator + prefix sanitizer + discount constant
│   └── supabaseAdmin.ts      # lazy singleton Supabase service client
├── package.json
├── next.config.js
├── tsconfig.json
├── README.md
└── AGENT.md                  # this file
```

## 3. Environment variables (`.env.local`)

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_KEY` — service-role key (server-only; never expose)
- `COUPON_ADMIN_TOKEN` — shared secret the UI sends in `x-admin-token`

`lib/supabaseAdmin.ts` returns `null` if these are missing/placeholder; routes then return 500.

## 4. Supabase schema (`coupons` table)

Base columns (created by `../database/migration-add-coupons.sql` in the parent repo):

- `id` uuid pk
- `code` text unique
- `discount_percent` int
- `status` text — `active` | `used` | `void`
- `created_for` text null
- `note` text null
- `created_by` text null
- `used_by_email` text null
- `used_by_order_id` text null
- `created_at` timestamptz
- `used_at` timestamptz null

**Added for expiry feature (REQUIRED manual migration — run once in Supabase SQL editor):**

```sql
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;
```

The storefront's redemption function should also reject coupons where `expires_at IS NOT NULL AND expires_at < now()`. That enforcement lives in the *other* project — flag it to the user if they report expired codes still working.

## 5. Core modules

### `lib/coupon.ts`
- `COUPON_DISCOUNT_PERCENT = 10` — fixed 10% discount
- `sanitizeCouponPrefix(input)` — uppercase, A–Z0–9 only, max 6 chars, falls back to `PLAY`
- `generateCouponCode(prefix)` — returns `PREFIX-XXXX-XXXX` where XXXX are hex from `crypto.randomBytes(4)`

### `lib/supabaseAdmin.ts`
Lazy singleton `getSupabaseAdmin()` — returns a service-role client or `null` if env vars missing.

### `app/api/coupons/route.ts`
- `isAuthorized(req)` — checks `x-admin-token` against `COUPON_ADMIN_TOKEN`
- `GET /api/coupons?limit=40` — returns most recent coupons
- `POST /api/coupons` body: `{ prefix, count, createdFor, createdBy, note, expiresAt? }` — generates `count` unique codes (dedupes in-memory), inserts, returns inserted rows

### `app/api/coupons/bulk/route.ts` (Feature 2)
- `POST /api/coupons/bulk` — multipart/form-data
  - Fields: `file` (xlsx/xls), `prefix`, `createdBy`, `expiresAt` (ISO optional), `note` (optional)
  - Parses with SheetJS (`xlsx`), finds the first column whose header matches `email` (case-insensitive; falls back to column A)
  - Generates one coupon per non-empty email row, inserts all into Supabase
  - Writes the generated codes into a new `coupon_code` column of the sheet
  - Returns the modified workbook as a downloadable xlsx (Content-Disposition attachment)

### `app/page.tsx`
Single client component. State-driven form. Features:
- Admin token field (persisted to `localStorage` under key `standalone-coupon-admin-token`)
- Single-batch generator form → calls `POST /api/coupons`
- **Expiry date/time picker** (Feature 1) — passes `expiresAt` to the API; displayed in the activity table
- **Bulk Excel upload** (Feature 2) — file input → posts multipart to `/api/coupons/bulk`, triggers download of returned xlsx
- Recent-coupons table (40 rows) with status pill, created_for, used_by, created_at, and expires_at

## 6. Dependencies

Runtime:
- `next`, `react`, `react-dom`
- `@supabase/supabase-js`
- `lucide-react` — icons
- `xlsx` (SheetJS) — added for the bulk upload feature

Install after pulling new code:
```bash
npm install
```

## 7. Running locally

```bash
npm install
npm run dev    # http://localhost:3001
```

Build: `npm run build` — Next.js production build
Start: `npm start` — serves on 3001

## 8. Conventions / gotchas

- **Server-only secrets.** `SUPABASE_SERVICE_KEY` and `COUPON_ADMIN_TOKEN` must never be sent to the client or embedded in any `app/page.tsx`-level code. Keep Supabase usage inside `app/api/**`.
- **Admin token flows through a header**, not a cookie. The UI stores it in `localStorage`; keep it that way unless the user asks otherwise.
- **All routes run on Node.js runtime** (`export const runtime = 'nodejs'`) because the `xlsx` lib and `crypto.randomBytes` need Node APIs — do not switch to edge.
- **Dedup codes in-memory** before insert; if the DB unique constraint trips on bulk, fail loudly rather than silently dropping rows.
- **The discount is hard-coded 10%.** If the user wants a configurable discount, that's a new feature — don't silently change the constant.
- **No tests exist.** Verify changes by running the dev server and exercising the UI.
- **Windows / bash shell.** Use forward slashes and Unix-style paths in commands.

## 9. Change log (keep appended)

- **2026-04-15** — Added Feature 1 (coupon expiry date) and Feature 2 (bulk generation from Excel upload). Required DB migration: `ALTER TABLE coupons ADD COLUMN expires_at timestamptz NULL`. Added `xlsx` dependency. New route `app/api/coupons/bulk/route.ts`.
- **2026-04-15** — Form resets per-batch fields (`createdFor`, `note`, `expiresAt`, `count`, and the bulk file input) after a successful single-generate or bulk-upload so the next batch starts clean. Session-level fields (`adminToken`, `createdBy`, `prefix`) intentionally persist.
- **2026-04-15** — Added `STOREFRONT-HANDOFF.md` — onboarding doc for the tcgplaytest storefront agent describing exactly which validation/claim-time checks to add for `expires_at`, plus the explicit do-not-touch list to preserve the existing discount math and checkout flow.
- **2026-04-15** — Added auto-expire sweep to `GET /api/coupons` (any `active` row past `expires_at` flips to `expired` on list load; wrapped in try/catch so a missing CHECK constraint for `'expired'` doesn't break the admin UI). Required DB constraint update: `ALTER TABLE coupons DROP CONSTRAINT coupons_status_check; ALTER TABLE coupons ADD CONSTRAINT coupons_status_check CHECK (status IN ('active','reserved','used','void','expired'));`
- **2026-04-15** — Added stats pills (With expiry / Redeemed / Active / Expired unused) above the Recent coupons table, computed client-side from the loaded rows.
- **2026-04-15** — Added `POST /api/coupons/release` + UI: per-row **Release** button on `reserved` rows and a **Release all reserved** bulk action in the table header. Workaround for a storefront bug where `/api/coupons/validate` reserves on Apply instead of read-only checking. See `STOREFRONT-HANDOFF.md` §6c.
- **2026-04-15** — Added `autoComplete="off"` + explicit `name` attributes to every text input in the generate form to stop Chrome from dumping saved wallet addresses / other autofill into `createdFor`.
