# Handoff — Changes the tcgplaytest storefront needs to pick up

> Read this if you're the agent / developer working on the **tcgplaytest** storefront (the Next.js site that actually runs checkout). The admin app at `coupon-generator-prof-main` was just extended with two new coupon features. The storefront shares the same Supabase `coupons` table, so some of those changes leak into storefront territory.
>
> **Golden rule: do NOT modify the existing discount math, the existing one-time claim flow, the UI copy, or any "commented-out" blocks in `CheckoutModal.tsx`.** Only *add* the minimum enforcement listed below. Everything already working must keep working identically.

---

## 1. What changed in the admin project (context)

Two features were added to `coupon-generator-prof-main` (the standalone generator at `localhost:3001`):

### Feature A — Coupon expiry date
- New column on the shared `coupons` table:
  ```sql
  ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;
  ```
  `NULL` = never expires (legacy behavior — backward compatible).
- The admin UI now has an optional datetime-local picker that writes `expires_at` on insert.
- API route `POST /api/coupons` accepts an `expiresAt` ISO string field and stores it.
- `GET /api/coupons` returns `expires_at` and the admin table renders it (past-due rows shown in red).

### Feature B — Bulk generation from Excel
- New admin endpoint `POST /api/coupons/bulk` accepts a multipart `xlsx`/`xls`/`csv` upload with an `email` column.
- For each valid email it generates one coupon with:
  - `code` = `PREFIX-XXXX-XXXX`
  - `discount_percent = 10` (hardcoded — unchanged)
  - `created_for = <email address>`  ← **this is the binding**
  - `expires_at` = whatever expiry was chosen in the admin form (optional)
- Returns the original sheet with a new `coupon_code` column appended, for download.
- Uses the `xlsx` (SheetJS) npm package.

**Net effect on the DB:** every row in `coupons` now may carry (a) a non-null `expires_at` and/or (b) a `created_for` that is specifically an email address. Nothing else about the table or the claim RPCs changed.

---

## 2. What the storefront already does today (verified from `CheckoutModal.tsx`)

Keep all of this **exactly as-is**. Do not refactor, rename, or "clean up" anything here:

1. User types a code in the checkout modal coupon input (component: `CheckoutModal.tsx`).
2. UI calls `POST /api/coupons/validate` with `{ code }`.
3. On success the UI stores `{ code, discountPercent }` in `appliedCoupon` state.
4. Discount math (do NOT change):
   ```ts
   const discountAmount = appliedCoupon
     ? Number(((finishSurcharge * appliedCoupon.discountPercent) / 100).toFixed(2))
     : 0
   const total = baseCardsCashTotal + finishSurcharge + shippingCost - discountAmount
   ```
   The 10% is applied **only to `finishSurcharge` (premium finishes)**, not to base cards or shipping. That is a deliberate product decision — preserve it.
5. On submit, `couponCode: appliedCoupon?.code || null` is passed inside the checkout payload to `/api/checkout`.
6. The server-side `/api/checkout` (and/or Stripe webhook) is what actually claims/burns the coupon via the Supabase `claim_coupon` RPC defined in `database/migration-add-coupons.sql`. That's where one-time enforcement lives.
7. Copy at the bottom of the coupon card says `One-time codes apply a 10% discount and are locked after checkout uses them.` — leave it.

Analytics events already in place: `coupon_applied`, `coupon_failed`. Keep firing them. No new events required.

---

## 3. What the storefront MUST add to support the new features

The admin app stores extra metadata; the storefront needs to *respect* it. There are only two enforcement points, both server-side. **No UI changes, no state changes, no new buttons. The modal stays visually identical.**

### 3.1 Enforce `expires_at` in `/api/coupons/validate`

Find the route file (likely `app/api/coupons/validate/route.ts`). Wherever it currently loads a row by `code` and checks `status = 'active'`, also reject expired ones:

```ts
// pseudo — adapt to the real query the route already uses
const { data: coupon, error } = await supabase
  .from('coupons')
  .select('code, status, discount_percent, expires_at, created_for')
  .eq('code', normalizedCode)
  .maybeSingle()

if (error || !coupon) {
  return NextResponse.json({ error: 'Invalid coupon code.' }, { status: 400 })
}
if (coupon.status !== 'active') {
  return NextResponse.json({ error: 'This coupon has already been used.' }, { status: 400 })
}
if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
  return NextResponse.json({ error: 'This coupon has expired.' }, { status: 400 })
}

return NextResponse.json({
  code: coupon.code,
  discountPercent: coupon.discount_percent, // still 10 — unchanged
})
```

Important:
- Return the **same JSON shape** the UI already consumes: `{ code, discountPercent }`. The UI reads exactly those two fields — do not add or rename fields in the success response.
- Error messages flow into `errorMessage` in the modal, so keep them short and customer-friendly.
- `expires_at == null` means no expiry — must still validate successfully (backward compatibility for every pre-existing coupon).

### 3.2 Enforce `expires_at` at claim time (`/api/checkout` and/or the claim RPC)

The real burn happens inside `/api/checkout` (or a Stripe webhook) calling the `claim_coupon` SQL function. Two safe options — pick one:

**Option A (preferred, single source of truth) — update the SQL function**

In the shared Postgres project, extend `claim_coupon` (or whatever the current RPC is named) to also reject expired rows atomically:

```sql
-- Inside the existing claim_coupon function, in the UPDATE ... WHERE clause:
WHERE code = p_code
  AND status = 'active'
  AND (expires_at IS NULL OR expires_at > now())
RETURNING ...;
```

That way both the storefront and any future caller are safe, and there's no time-of-check/time-of-use race between validate and claim.

**Option B — check in `/api/checkout` before calling the RPC**

If you cannot edit the RPC right now, re-fetch the coupon row in the checkout handler and reject expired ones before claiming. Less safe (race window) but keeps all changes in the storefront repo.

Whichever option you choose, on an expired coupon during checkout, **fail the request before charging Stripe** and return a message the modal can display.

### 3.3 (Optional, do NOT do this without asking the user first) — email binding

Feature B stores the target email in `created_for`. The product decision to make is:

- **Strict mode:** reject the coupon at validate time unless `created_for` is null OR equals `formData.email` (case-insensitive). This guarantees "the email the coupon was minted for is the only one that can redeem it."
- **Lenient mode (current behavior):** any customer can redeem any code; `created_for` is metadata only.

The admin project doesn't enforce either — it's the storefront's call. **Default to lenient** (do nothing) until the product owner explicitly asks for strict mode. If you do add strict mode later:
- Only enforce when `created_for` looks like an email (`includes('@')`), since old rows use `created_for` for free-text names.
- Do the check server-side in `/api/coupons/validate` *and* at claim time — never trust client-provided email.

---

## 4. Things to explicitly NOT change in the storefront

A list, so there's no ambiguity:

- ❌ Do not change `discountAmount = (finishSurcharge * discountPercent) / 100`. The discount stays finish-surcharge-only.
- ❌ Do not change the UI copy in the coupon card or the "Payment mode" block.
- ❌ Do not uncomment any of the commented-out blocks in `CheckoutModal.tsx` (welcome prints banner, shortfall warning, prints checkout rows, mailing-list checkbox, "Use prints" button). Those are commented deliberately.
- ❌ Do not alter the `appliedCoupon` state shape, the `/api/coupons/validate` response shape, or the `couponCode` field in the `/api/checkout` payload.
- ❌ Do not change `COUPON_DISCOUNT_PERCENT` (still 10) or hardcode a second percent value anywhere.
- ❌ Do not touch the one-time claim flow (`claim_coupon` semantics, marking `status='used'`, setting `used_by_email` / `used_by_order_id` / `used_at`). Only *add* the `expires_at` check inside it.
- ❌ Do not add a new coupon endpoint or a new client-side coupon component — everything plugs into the existing validate + checkout endpoints.

---

## 5. Test plan for the storefront changes

After making the changes above, verify in this order:

1. **Legacy coupon (no expiry, no email binding)** — generate one in the admin with `expires_at` left blank, apply it in the storefront. Should work exactly like before: 10% off finish surcharge, one-time burn at checkout. This is the regression test.
2. **Expired coupon** — generate one with `expires_at` set to a past time (or set it to `now() + 1 minute` and wait). `POST /api/coupons/validate` should return an error, and `/api/checkout` should refuse to claim it even if the client tries to bypass validate.
3. **Future-dated coupon** — generate one expiring an hour from now. Should validate and redeem normally.
4. **Bulk-generated coupon** — upload an xlsx with one email through the admin, grab the resulting code from the downloaded file, apply it at checkout. Should work (lenient mode) regardless of which email is in the shipping form.
5. **Already-used coupon** — redeem a code once, then try to re-apply it. Should fail at validate with "already been used" (existing behavior, just making sure it still works).
6. **Stripe path end-to-end** — full checkout with a valid coupon, confirm the Stripe session shows the discounted total and the `coupons` row flips to `status='used'` with `used_at` populated after the webhook.

---

## 6. Quick reference — the `coupons` table today

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | pk |
| `code` | text | unique |
| `discount_percent` | int | hardcoded 10 by the admin |
| `status` | text | `active` / `used` / `void` |
| `created_for` | text null | free text, or email (for bulk-generated rows) |
| `note` | text null | |
| `created_by` | text null | |
| `used_by_email` | text null | set at claim time |
| `used_by_order_id` | text null | set at claim time |
| `created_at` | timestamptz | |
| `used_at` | timestamptz null | set at claim time |
| **`expires_at`** | **timestamptz null** | **new — null = never expires** |

---

## 6c. KNOWN BUG in the storefront — `validate` reserves instead of just reading (2026-04-15)

Evidence: after the `reserved` status was added to the CHECK constraint, we observed that merely clicking **Apply** on a coupon in the storefront checkout modal flips the DB row from `active` to `reserved`. A second account that then types the same code into their own checkout gets `"This coupon is invalid or has already been used."` — proof that `POST /api/coupons/validate` is mutating state.

**Validation must be read-only.** The only places allowed to write to `status` are:
1. The Stripe webhook (`active` → `used`), and
2. (Optionally) the Proceed-to-Payment handler if you use a `reserved` intermediate step.

### Required fix in the storefront

In the tcgplaytest repo's `app/api/coupons/validate/route.ts`:

- Remove any `UPDATE coupons SET status = 'reserved'` or `supabase.rpc('reserve_coupon', …)` call.
- The route should do nothing but:
  ```ts
  const { data: coupon } = await supabase
    .from('coupons')
    .select('code, status, discount_percent, expires_at, created_for')
    .eq('code', normalizedCode)
    .maybeSingle()

  if (!coupon)                             return 400 'Invalid coupon code.'
  if (coupon.status !== 'active')          return 400 'This coupon has already been used.'
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return 400 'This coupon has expired.'

  return NextResponse.json({ code: coupon.code, discountPercent: coupon.discount_percent })
  ```
  Do not touch the row.

If you really want a reserved intermediate state to prevent double-spend, add it only at the start of `/api/checkout` (when creating the Stripe session), NOT on validate. And always pair it with (a) a `reserved_at` timestamp column and (b) a release path back to `active` on `checkout.session.expired` + a stale-reserved sweep (see §6b's webhook plan).

### Admin-side safety net (already shipped in this repo, 2026-04-15)

Until the storefront is fixed, the admin at `localhost:3001` now has:
- A **Release all reserved** button next to the "n shown" chip in the Recent coupons header (appears only when at least one loaded row is `reserved`).
- A per-row **Release** button in the Actions column for every `reserved` row.
- A new endpoint `POST /api/coupons/release` that accepts `{ code }` or `{ all: true }` and flips `reserved → active`. Does not touch `used` rows.

These are operator-facing unblock tools, not a fix for the underlying storefront bug. If you release a code while a real customer is mid-checkout, there's a theoretical race where two people could both reserve the same code before the Stripe webhook fires — acceptable for manual unstick during debugging, not a long-term solution.

## 6b. KNOWN BUG in the storefront — coupons burnt before payment (2026-04-15)

Evidence from production data: many `coupons` rows have `status='used'` with `used_by_order_id` values like `temp_4794b4ea-40fa-4f90-b7ec-d9131e15a792`. That `temp_` prefix comes from `CheckoutModal.tsx`:
```ts
const tempOrderId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
```
which is the scratch id used **only** for grouping images during `/api/upload-images`. It is not a Stripe session id, not a real order id, and it exists before any payment attempt.

**Conclusion:** the storefront is calling `claim_coupon` (or directly updating `status='used'`) somewhere in the pre-payment path (most likely inside `/api/checkout` when creating the Stripe session, passing the temp upload id as the order id). Every click of "Proceed to Payment" permanently burns the coupon regardless of whether Stripe succeeds. This is a revenue bug.

### Required fix (storefront side)

1. **`/api/checkout` must NOT claim.** Change it to a read-only check: `SELECT status, expires_at FROM coupons WHERE code = ?`. Refuse to create the Stripe session if inactive/expired. Pass the code through to Stripe as `session.metadata.coupon_code` only.
2. **The Stripe webhook (`checkout.session.completed`) is the only place allowed to call `claim_coupon`.** It should pass `session.metadata.coupon_code`, the customer's real email from Stripe, and the real `orders.id` that was written from this session.
3. **Never pass `tempOrderId` to anything coupon-related.** Grep the storefront repo for `tempOrderId` and any coupon UPDATE — remove the linkage entirely.
4. **(Optional but recommended) Use the `reserved` state** the schema already allows. Reserve on validate, finalize to `used` on webhook success, release to `active` on `checkout.session.expired` or after N minutes of staleness. Prevents double-spend in the validate→webhook window without permanently burning on failure.

### Rollback script for the already-burnt rows

```sql
UPDATE coupons
SET status = 'active',
    used_by_email = NULL,
    used_by_order_id = NULL,
    used_at = NULL
WHERE status = 'used'
  AND used_by_order_id LIKE 'temp_%';
```

This only resets rows whose `used_by_order_id` carries the telltale `temp_` prefix, so real legitimate redemptions (with proper Stripe session ids) are untouched. **Do not run this until after the storefront fix is deployed**, or the next test click will burn them again.

## 7. If something breaks

- Existing coupons suddenly stop validating → you almost certainly forgot the `expires_at IS NULL OR ...` part. NULL must pass.
- Discount amount changed → you edited the wrong line. Revert `discountAmount` to `(finishSurcharge * discountPercent) / 100`.
- `validate` returns a new field name and the modal breaks → the UI reads `data.code` and `data.discountPercent`; keep those exact keys.
- Admin can't generate bulk → unrelated to the storefront; check the admin repo's `app/api/coupons/bulk/route.ts` and make sure the `xlsx` dep is installed and the DB migration ran.
