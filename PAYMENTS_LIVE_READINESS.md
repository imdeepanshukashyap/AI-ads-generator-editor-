# Razorpay Live Readiness — AdGen Studio

Runbook for taking Razorpay payments from test mode to live mode. Nothing in this repository switches
to live mode by itself. Live activation, live keys and production changes need an authorised person.

**Verification status (2026-10-29)**

| Check | Status |
|---|---|
| Unit tests (Prisma and Razorpay faked) | Passing: `npm test` (49) |
| Real PostgreSQL 18 (concurrency, rollback, constraints, schema upgrade) | Passing: 7 tests against a throwaway local database |
| Webhook over HTTP into real PostgreSQL (app's own controller and Prisma client) | Passing: 7 tests. Razorpay API calls faked |
| Real Razorpay test-mode API | **Not run yet.** No test keys were available. See sections 3–4 |
| Complete test-mode checkout | **Not run yet.** Needs test keys and a person to pay in the browser (`npm run checkout:test`, section 4) |
| Webhook delivered by Razorpay to a deployed server | **Not run yet.** Needs a staging deployment. See section 7 |
| Account onboarding / live activation | **Not started.** See section 10 |

---

## 1. How payments work

```
Plans page ──► POST /api/payment/create-order {planId}
                 server: price/credits from PURCHASABLE_PLANS (server/services/paymentService.ts)
                 → Razorpay order (receipt = our Transaction id) → Transaction "pending"
                 ◄── {orderId, amount, currency, keyId, mode}      ← Checkout always uses the server's key id
Razorpay Checkout (customer pays)
  ├─► browser: POST /api/payment/verify {order_id, payment_id, signature}
  │      order belongs to caller → HMAC(order_id|payment_id, key secret) with OUR stored order id
  │      → Razorpay payments.fetch: order, amount and currency must match; status "captured"; nothing refunded
  │      → grantCreditsForPayment()
  └─► Razorpay: POST /api/payment/webhook
         HMAC of the raw body with the webhook secret → payment must belong to an order we created
         → payment.captured / order.paid: re-fetch the payment from Razorpay (payloads can be stale)
           and apply the same checks → grantCreditsForPayment()
         → payment.failed: mark failed (never downgrades a credited order)
         → refund.created / refund.processed: close an unpaid order as "refunded"; flag a credited one
         → refund.failed: flag if the order had been closed as refunded
Backstop: reconciliation → Razorpay orders.fetchPayments → grantCreditsForPayment() or close as refunded
```

`grantCreditsForPayment()` runs one database transaction:
`UPDATE "Transaction" SET status='success' WHERE id=? AND status IN ('pending','failed')`, then increments
the **transaction owner's** credits **only if that update changed a row**. However many verify calls,
webhook deliveries or reconciliation runs race each other, credits are granted once. This holds on real
PostgreSQL: 20 simultaneous verifies gave exactly one credit.

**Transaction status**

| Status | Meaning | Can still be credited? |
|---|---|---|
| `pending` | Order created; no successful payment confirmed yet | Yes |
| `failed` | Last attempt failed; the customer may retry on the same order | Yes |
| `success` | Credits granted | No (already done) |
| `refunded` | A captured payment was refunded **before** credits were granted | **Never** |

**Verify responses**

| Response | Meaning |
|---|---|
| 200 `status: credited` | Payment captured; credits added |
| 200 `status: already_processed` | Credits were already added (duplicate request) |
| 202 `status: pending` | Authorised but not captured yet; credits follow via webhook or reconciliation |
| 400 | Missing details, bad signature, mismatched order/amount/currency, failed payment, or refunded payment. No credits added |
| 404 | Order not found for this user |
| 502 | Razorpay unreachable. Nothing changed; the webhook or reconciliation finishes it |
| 503 | Razorpay keys missing or malformed |

**Webhook responses.** Razorpay retries any non-2xx response for 24 hours.
- **400:** bad signature or payload.
- **503:** webhook secret not set.
- **500:** database or Razorpay error. Razorpay retries, which is safe.
- **200:** everything else, including ignored events and orders flagged for review.

---

## 2. Environment variables (names only)

**Server (Render)**

| Variable | Required | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` | Yes | `rzp_test_…` or `rzp_live_…`. Public; sent to the browser for Checkout. Any other format disables payments |
| `RAZORPAY_KEY_SECRET` | Yes | **Secret.** Server only |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | **Secret.** The value you type when creating the webhook. Not the key secret. Separate for test and live |
| `RAZORPAY_MODE` | Recommended | `test` or `live`. If the key id belongs to the other mode, payments stay **disabled** (503), so a half-finished switch cannot run in the wrong mode. `test` also acknowledges test keys in production |
| `DATABASE_URL`, `DIRECT_URL` | Yes | Existing. Prisma CLI commands use `DIRECT_URL` when it is set |
| `NODE_ENV` | — | `production` on Render. With test keys, the server logs a warning at startup |

**Client (Vercel):** no Razorpay variables. `VITE_RAZORPAY_KEY_ID` is **no longer read**, because Checkout
uses the key id returned by the server, so it can't drift from the server's mode. You can delete it from Vercel.

**Local test-only variables** (never set these on Render or Vercel):
- `PAYMENT_TEST_DATABASE_URL`: a disposable or staging database for the database integration tests.
- `RAZORPAY_TEST_PAYMENT_ID`: a test-mode payment id for the end-to-end verify test.

Rules:
- Never put a secret in a `VITE_` variable; anything prefixed `VITE_` is compiled into the public bundle.
- Never commit `.env` files (already gitignored). The server logs only the key **mode**, never values.
- If a secret is exposed, regenerate it in the Razorpay Dashboard and update Render.

**Check the configuration** (prints set/missing and the mode, never values):
```
cd server
npm run check:payments            # local checks
npm run check:payments -- --api   # plus one read-only Razorpay call proving the key id and secret are a pair
# on Render's shell after deploy:
node dist/scripts/check-payment-env.js --api
```

---

## 3. Get Razorpay test credentials

1. Log in to the Razorpay Dashboard and select **Test** mode.
2. Go to **Account & Settings → API Keys** (under *Website and app settings*) → **Generate Key**.
3. Download the keys immediately. The Dashboard shows only the Key Id afterwards, never the secret.
4. Save them as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`:
   - locally, in `server/.env` (gitignored);
   - on the staging Render service, as environment variables.
5. Invent a long random webhook secret and save it as `RAZORPAY_WEBHOOK_SECRET`. You'll enter the same value in section 6.

Test keys need no website verification. **Live** keys need the website verified first, which takes up to
3 working days (section 10).

---

## 4. Local verification commands

```
cd server && npm ci
npm test                      # unit tests, no network or database
npm run typecheck
npm run build

# Real PostgreSQL. Use a DISPOSABLE or STAGING database, never production.
# Set BOTH variables in the shell; prisma.config.ts otherwise falls back to DIRECT_URL from .env.
DIRECT_URL=<test db url> DATABASE_URL=<test db url> npx prisma db push
PAYMENT_TEST_DATABASE_URL=<test db url> npm run test:integration
```
The database suites refuse to run if `PAYMENT_TEST_DATABASE_URL` equals `DATABASE_URL` or `DIRECT_URL`. They
only touch rows prefixed `itest_` and delete them afterwards.
- The HTTP webhook suite uses the app's own Prisma client, which forces TLS.
- For a local database without TLS, add `?sslmode=disable` to `PAYMENT_TEST_DATABASE_URL`.

**Complete test-mode checkout without a staging deployment:**
```
PAYMENT_TEST_DATABASE_URL=<test db url> npm run checkout:test    # then open http://127.0.0.1:5055
```
1. Buy a pack on the page through the real Razorpay Checkout, in test mode, paying with a method from Razorpay's *Test Cards Details* docs.
2. After the payment, the page repeats verification: 10 concurrent duplicates, a forged signature, and another user.
3. It then shows Razorpay's view of the payment and records every outcome in `server/logs/test-checkout-evidence.jsonl`.
4. **Reconcile latest order** checks an order you closed the tab on, or refunded from the Dashboard.

Safety:
- Refuses live keys and refuses the app database.
- No Clerk, Google or Cloudinary configuration is needed.
- Webhooks cannot reach `127.0.0.1`; use staging (section 7) for those.

```
# Real Razorpay TEST-mode API (no money moves; creates a few test orders). Refuses live keys.
RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... npm run test:integration
# After a test-mode checkout payment (section 7, step 6), also verify that payment end to end:
RAZORPAY_TEST_PAYMENT_ID=pay_... RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... npm run test:integration
```

Client: `cd client && npm ci && npm run build`.

---

## 5. Database change (additive; apply before deploying the new server)

`Transaction` gains `currency String @default("INR")` and two indexes. `refunded` is a new status *value*
in the existing text column, so it needs no schema change. Existing rows get `INR` automatically.

Old code ignores the new column, but **new code requires it**, so apply the schema first.

Verified locally: pushing this schema onto a database created from the committed schema completed with no
data-loss prompt, and kept existing rows (`currency` filled with `INR`).

This project manages its schema with `prisma db push`. `prisma/migrations` is out of date, so
**do not run `prisma migrate deploy`.**

1. **Staging:** `cd server && DIRECT_URL=<staging url> DATABASE_URL=<staging url> npx prisma db push`.
   Expect only an added column and indexes. **If Prisma mentions data loss, stop.**
2. **Production:** after the staging smoke test passes, an authorised person runs the same command against production.

---

## 6. Razorpay Dashboard configuration (test and live separately)

**Webhook**
1. Go to **Account & Settings → Webhooks** (under *Website and app settings*) → **+ Add New Webhook**.
2. Fill in:
   - **Webhook URL:** `https://<render-api-domain>/api/payment/webhook`. It must be public (localhost is rejected).
   - **Secret:** the value of `RAZORPAY_WEBHOOK_SECRET`.
   - **Alert Email:** a monitored address. Razorpay emails it when it disables a webhook that has failed for 24 hours.
   - **Active Events:** `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`.
3. Click **Create Webhook**.

Razorpay expects a 2xx within 5 seconds and retries failures for 24 hours. Duplicate deliveries are
expected and are safe here. A database cold start can make the first delivery slow; the retry completes it.

**Payment capture.** Go to **Account & Settings → Payments Capture → Automatic Capture**. Auto-capture is
Razorpay's default; confirm it is on. Credits are granted only for captured payments. Payments that are
authorised but never captured are auto-refunded by Razorpay and never credited.

---

## 7. Staging procedure (test mode)

1. Create a staging database, for example a branch of the production database, and apply the schema (section 5).
2. Run the database suite against it (section 4) and the Razorpay test-mode suite with test keys.
3. Deploy the server to a staging Render service with **test** keys, `RAZORPAY_WEBHOOK_SECRET` and the
   staging `DATABASE_URL`. Run `node dist/scripts/check-payment-env.js --api`; it must print `OK`.
4. Deploy the client to a Vercel preview with `VITE_BASEURL` pointing at the staging API.
5. Create the **test-mode** webhook pointing at the staging API (section 6).
6. Work through the test cases in section 8. Use the test payment methods listed in Razorpay's
   *Test Cards Details* documentation.
7. Copy one successful `pay_…` id from the Dashboard and run the end-to-end verify test (section 4).

---

## 8. Test cases (test mode first; live uses one small real purchase)

| # | Action | Expected |
|---|---|---|
| 1 | Open Plans | ₹0 / ₹9 / ₹29, "one-time", links to all four policies. Free plan opens sign-up or Generate, with no checkout |
| 2 | Buy Pro and pay | Checkout shows ₹9 and a "Test mode" toast. Credits rise by exactly 80. Transaction `success` with a payment id |
| 3 | Repeat the verify call (back/forward, refresh) | `already_processed`; credits unchanged |
| 4 | Fail a payment (wrong OTP or the mock bank's **Failure** button), then retry in the same checkout | No credits for the failure; the retry credits once |
| 5 | Dismiss checkout without paying | No credits; Transaction stays `pending` |
| 6 | Pay, then close the tab before Checkout returns | Credits arrive via webhook. Server log: `[razorpayWebhook] Webhook processed … credited` |
| 7 | Refund test #2's payment from the Dashboard | Webhook logs `needs_review` and Sentry shows it; credits are **not** removed automatically (section 11) |
| 8 | Temporarily disable the webhook. Pay, then close the tab before Checkout returns. Refund that payment from the Dashboard, then run reconciliation with `--apply` | Outcome `marked_refunded`; order `refunded`; no credits. Re-enable the webhook afterwards |
| 9 | Run reconciliation (section 12) | Dry run lists only expected outcomes; nothing unexpected under `mismatch` or `error` |
| 10 | Server logs | Correct `mode`; no secrets |

---

## 9. Production deployment order

1. Review and merge.
2. **Production database:**
   - First take a backup or restore point with your Postgres provider (the code comments indicate Neon, which offers branches and restore points).
   - Then run `prisma db push` (section 5). This must happen **before** the new server is deployed.
3. **Render:**
   - Set `RAZORPAY_WEBHOOK_SECRET` (declared in `render.yaml`).
   - Keep the keys in **test** mode until activation.
   - Deploy. `render.yaml`'s build now runs `npm install --include=dev`, because `NODE_ENV=production` would otherwise skip `typescript` and `prisma`. If the service was created manually rather than from the Blueprint, make the same change to the build command in the Render settings.
   - Health check: `GET /` returns `Server is Live!`. `node dist/scripts/check-payment-env.js --api` prints `OK`.
4. **Vercel:** deploy the client. Optionally delete `VITE_RAZORPAY_KEY_ID`.
5. Create the production test-mode webhook and repeat test cases 1–6.

While production runs test keys, anyone can buy credits with Razorpay's public test cards. The server warns
about this at startup and the checkout shows a "Test mode" notice. Keep that window short or the Plans page private.

---

## 10. Account onboarding and live activation

From Razorpay's *Get Started* and *KYC documents* docs. Only the account owner can do these steps. Enter all
personal, bank and identity details directly in the Dashboard, never in chat, code or email.

**Onboarding (Dashboard sign-up flow):**
1. **Sign up:** at razorpay.com, use an email or mobile number, set a password and verify the OTP.
2. **Basic details:**
   - The full name of the person completing onboarding.
   - Verify the mobile number by OTP.
   - Platform: Website.
   - Website: the production domain. Choose "Add later" if it isn't ready yet.
3. **Business details:**
   - Choose *Registered* or *Unregistered*, then the sub-type that is **truthfully** yours.
   - Enter the PAN. For a registered business, also the business name and date of incorporation.
4. **Documents, by business type:**
   - Unregistered individual: PAN and address proof, through CKYC, Digilocker or upload. Video KYC if CKYC fails.
   - Proprietorship: two of MSME/UDYAM, GST, Shop & Establishment, IEC, or a postpaid mobile bill; plus the owner's PAN and address proof.
   - Private Limited / LLP / Partnership: incorporation or deed documents, business PAN, the authorised signatory's PAN, address proof and Board Resolution or Power of Attorney, and a UBO declaration (anyone over 10%).
5. **Settlement bank account:**
   - Enter the account number and IFSC of an account in the business's (or, if unregistered, your own) name.
   - Razorpay deposits ₹1 to verify it.
   - If that fails, upload a cancelled-cheque video or a bank letter.
6. **Submit Application.** The status moves to `under_review`. If it becomes `needs_clarification`, answer in the Dashboard. When it reaches `activated`, Live mode is enabled.

**Website details** (**Account & Settings → Business website details**). Razorpay checks these URLs on the primary website:

| Razorpay asks for | URL on this site |
|---|---|
| About us | `/about` |
| Contact us | `/contact` |
| Pricing details | `/plans` |
| Terms and conditions | `/terms-and-conditions` |
| Privacy policy | `/privacy-policy` |
| Cancellation/Refund policy | `/refund-policy` |
| Shipping policy | `/shipping-policy` (digital delivery; nothing physical) |

- **"Does your website require login from user to complete payment?"** Answer **Yes**: buying credits needs an account.
- Either give Razorpay the credentials of a dedicated reviewer test account, created by you, with no real personal data, or explain that sign-up is open to anyone with an email.
- `client/vercel.json` rewrites all paths to the app, so these URLs open directly.

**Website content:**
- [ ] Fill every value in `client/src/configs/business.ts`. Pages show "To be provided" until all 19 are set.
- [ ] The business name, address and contact details must match your KYC exactly.
- [ ] Have a qualified professional review the Privacy, Terms, Refund and Shipping policies.
- [ ] Confirm ₹9 / ₹29 are the intended prices. If they change, update `PURCHASABLE_PLANS` (server) and `plansData` (client) together.
- [ ] Remove or substantiate claims Razorpay may consider misleading: Hero "Trusted by 10,000+ creators", brand logos, and "Watch demo" with no demo.
- [ ] Footer links that go nowhere (`#`): Features, FAQ, Twitter, LinkedIn, GitHub. Point them at real pages or profiles, or remove them.

**Settlements.** Captured payments settle automatically to the KYC bank account on a **T+2 working days** cycle,
minus fees. Check the settlement account and cycle under Settlements in the Live-mode Dashboard before going live.

**Account:**
- [ ] Application status `activated`.
- [ ] Website verified. This is needed to generate live keys and takes up to 3 working days.
- [ ] **Clerk Billing:** the Clerk pricing table was live from 2026-02-10 to 2026-02-18.
  - In the Clerk Dashboard, check **Billing → Subscriptions**.
  - If none are active, turn Billing off and remove `paymentAttempt.updated` handling from `server/controllers/clerk.ts`.
  - If any are active, decide how to migrate them; the site now says there are no subscriptions.

**Switch (authorised person):**
1. **Live-mode Dashboard:**
   - Generate API keys (section 3, with **Live** selected).
   - Create the live webhook with a **new** secret (section 6).
   - Confirm auto-capture.
2. **Render → service → Environment:** set these four together, then save and redeploy:
   - `RAZORPAY_KEY_ID` (live)
   - `RAZORPAY_KEY_SECRET` (live)
   - `RAZORPAY_WEBHOOK_SECRET` (live webhook secret)
   - `RAZORPAY_MODE=live`

   If any key is still from test mode, payments stay disabled (503) and the log names the mismatch.
3. **Render → Shell:** run `node dist/scripts/check-payment-env.js --api`. It must report `LIVE` and `OK`; the API call is read-only and charges nothing.
4. **Live smoke test.** One real purchase of the cheapest pack (Pro, ₹9 of real money, charged to the payer's method):
   - Credits rise by exactly 80, once.
   - Transaction `success`.
   - Live Dashboard → Payments shows it `captured`.
   - Dashboard → Webhooks delivery log shows `payment.captured` delivered with a 2xx response.
   - Razorpay deducts its transaction fee, per your pricing plan, before settlement. The rest settles T+2 working days later.
5. **If it was only a check, refund it:** Dashboard → Payments → the payment → **Issue Refund** (full).
   - The webhook flags `needs_review`.
   - Remove the 80 credits manually (section 11).
   - Whether the transaction fee is returned on refund depends on your Razorpay pricing plan; check it before refunding.

---

## 11. Refunds

Refunds are issued from the Razorpay Dashboard. The app never issues refunds itself.

| Situation | What the app does automatically |
|---|---|
| Refund of a captured payment **before** credits were granted | Order closed as `refunded`; no later event, verify or reconciliation can credit it |
| Refund (full or partial) **after** credits were granted | Logged at error level and sent to Sentry as `needs_review`. **Credits are not removed**, because clawing back possibly spent credits is a policy decision |
| Partial refund | Treated as refunded: an uncredited order is never credited |
| Razorpay auto-refund of an authorised, never-captured payment | Ignored; it was never creditable. The order stays open for a successful retry |
| `refund.failed` on an order closed as refunded | Flagged `needs_review`: the customer paid and has no credits |

**Manual step for a `needs_review` refund on a credited order.** Decide per the Refund Policy (`creditsOnRefund` in
`client/src/configs/business.ts` states the rule customers see). Then adjust
the user's credits in Prisma Studio (`cd server && npx prisma studio`) or with SQL, and record the reason. The
Transaction remains `success`; use the Razorpay Dashboard as the record of the refund.

---

## 12. Reconciliation (backstop for missed webhooks)

```
node dist/scripts/reconcile-payments.js                # dry run: lists what would change
node dist/scripts/reconcile-payments.js --apply        # credit captured payments; close refunded orders; mark failures
# locally: npm run reconcile:payments [-- --apply]   options: --min-age-minutes=15 --max-age-days=30 --limit=100
```
- It skips orders younger than 15 minutes (checkouts still in progress) and is safe to re-run.
- It can be scheduled as a Render Cron Job.
- Outcomes `mismatch` or `error` need manual review in the Razorpay Dashboard.

---

## 13. Rollback

- **Application:** roll back to the previous deploy in Render or Vercel. The schema change is additive and works with the old code; no database rollback.
  - The old code has the double-credit race and credits without asking Razorpay.
  - It also does not know the `refunded` status, so a replayed checkout callback could credit a refunded order.
  - Keep any rollback short, and run reconciliation (dry run) afterwards.
- **Stop payments quickly:** remove `RAZORPAY_KEY_ID` on Render and redeploy. Payment routes answer 503; the rest of the app keeps working.
- **Live → test:** set the three Razorpay variables back to the test values **and** `RAZORPAY_MODE=test`, together. Otherwise the mode guard keeps payments disabled.
- Live payments already captured stay valid. They still settle, and can be refunded from the live Dashboard even while the app runs test keys.

---

## 14. Known limitations

- Duplicate webhooks are handled through state transitions (each one is a no-op), not by storing `x-razorpay-event-id`. The event id is logged.
- Deleting a user cascades to their Transaction rows. Consider accounting retention before going live.
- The legacy Clerk Billing handler still grants credits and is not idempotent (section 10). Every grant is reported to Sentry.
- `configs/instrument.mjs` initialises Sentry with a hard-coded DSN and `sendDefaultPii: true`. Confirm Sentry's data scrubbing removes `Authorization` headers.
