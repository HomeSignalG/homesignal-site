# Alert sign-up confirmation — "HomeSignal alerts are on"

One resident-facing email, sent once when a monitoring identity **becomes eligible** to
receive HomeSignal alert email. It means *monitoring for this place is active*. It does
**not** mean HomeSignal detected an event.

**It is built and sent in `homesignal-ingest`, not here.** This repo owns the activation
UI and three facts the email reproduces server-side. Nothing in this repo sends it, and
nothing in this repo may: email from browser code is forbidden, and
`test/alert-confirmation-contract.test.mjs` fails if a page ever reaches for Resend or
the function directly.

| Half | Repo | Files |
|---|---|---|
| Activation (writes the eligibility) | **this repo** | `shell.js` `ensureAreaSubscribed` / `enableAreaEmail` / `persistSignup` / `saveHome`; `docs/email-optin-consent.sql`; `docs/reconnect-subscriptions.sql` |
| Send (trigger → pg_net → Edge Function → Resend) | `homesignal-ingest` | `supabase/migrations/20260910200000_alert_confirmation_hook.sql`; `supabase/functions/confirm-alerts/` |

## What actually triggers it

The durable event is the **eligibility transition on `public.users`**, mirroring
`digest.py::_recipients()` exactly:

```
community_id not null AND topics not null AND unsubscribed = false AND marketing_consent = true
```

A UI tap is not evidence. `subscribe_area_defaults` succeeding is not evidence. An
`app_properties` insert is not evidence. So:

- **follow only** (`ensureAreaSubscribed` → `subscribe_area_defaults`, consent left
  false) → **no email**;
- **"Email me these alerts"** (`enableAreaEmail` → `enable_area_email_alerts`, consent
  false→true) → **one email**;
- **topics Save** (`persistSignup` → `signup_complete`) → one email **only if** that
  write is what made the identity eligible; reconciling an already-eligible row sends
  nothing;
- **re-subscribe after unsubscribe** (P0 clears `unsubscribed`) → one email, because it
  is a genuine new transition.

`notify-signup` is unrelated and is **not** retargeted: it fires on `users` INSERT — the
follow — and mails the founder at `hello@homesignal.net`.

## The three facts this repo owns

Pinned by `test/alert-confirmation-contract.test.mjs`, which names the email in its
failure output so a change here does not drift silently in the other repo.

1. **Address line** — `HS.homeAddressLine` (`shell.js`): `address, city, state zip`,
   absent parts absent. `alert_confirmation_claim` reproduces it with
   `concat_ws`/`nullif`.
2. **Canonical ZIP URL** — `scripts/gen_zip_pages.py` builds `/community/<zip>/` and
   stamps it self-canonical. That is the email CTA. The legacy `community.html?zip=`
   canonicalises *to* it and is deliberately not used.
3. **My Places** — `properties.html` is the manage link.

## Place identity in the email

> You're monitoring
> **ZIP code: 78617** — or — **2200 Caldwell Ln, Del Valle, TX 78617**

The address is shown when a Census-confirmed `app_properties` home row exists for that
user whose `zip` equals the **activated `users.zip_code`**; otherwise the ZIP form.

**This needed no new column.** `public.users` has no auth user id, so the join runs in
SQL: `users.email → auth.users.id → app_properties.user_id`. Measured live 2026-09-10:
6/6 eligible users resolve to an auth user, 3/6 have such an address row.

The address is **display of the saved place**. The subscription stays the ZIP/county
identity, so the CTA opens the ZIP page in both cases.

## Decision boundary — three conflicts, stated not improvised

### 1. County-root collision — RECOMMENDED DECISION APPLIED, founder may overrule

- **Expected contract:** confirmation per monitored ZIP/place.
- **Repository truth:** `public.users` is `UNIQUE (email, community_id)` and `shell.js`
  passes `p_community_id: ct.rootId` — the **county** root. Two ZIPs in one county are
  **one row**, and the second follow overwrites `users.zip_code`.
- **Conflict:** each ZIP cannot be a distinct activation without widening `users`
  uniqueness, which would change the digest identity.
- **Applied:** send on the **eligibility transition only** — the first ZIP in that county
  confirms, a later ZIP in the same county does not, and the email displays the
  `zip_code` currently stored. `users` uniqueness is **not** widened; no `users` row is
  invented per address or per ZIP.

### 2. The address deep link is a DB uuid — CTA is the ZIP page

- **Repository truth:** `properties.html:192` routes Address cards to
  `property.html?id=<app_properties.id>` — a DB uuid, which may not go in the CTA.
  `homesignalmap.html?addr=` is production-true but is Map 1, and it exact-matches
  `property_reports.address` (the engine's uppercase `canonicalAddr`), so a mixed-case
  `app_properties` line would usually land on the honest-empty state.
- **Applied:** the CTA is `https://homesignal.net/community/<zip>/` in both cases —
  the resident-facing ZIP page, no uuid, never 404.

### 3. The digest ledger cannot carry this item — separate ledger

- **Repository truth (live 2026-09-10):**
  `email_deliveries_item_type_check CHECK (item_type = ANY (ARRAY['alert','meeting']))`
  and `item_id uuid NOT NULL`.
- **Conflict:** a new item type means `ALTER`ing the digest's own dedup constraint, and a
  uuid `item_id` cannot carry an eligibility epoch.
- **Applied:** `public.alert_confirmations`, unique on `(user_id, epoch)`. Digest dedup
  is untouched; `email_deliveries` is not referenced by any executable statement.

## No backfill

Applying the migration arms **future transitions only**. The 6 identities already
eligible at apply time are never mailed retroactively.

## Status — APPLIED 2026-09-10

Live in production on founder instruction. Function deployed **first**, then the
trigger — arming the trigger before the endpoint existed would have queued POSTs at
a 404.

- Edge Function `confirm-alerts` v1 ACTIVE, `verify_jwt=false` (shared-secret auth).
- Migration ledger row `20260910193858 alert_confirmation_hook`.
- Ledger table `public.alert_confirmations`: RLS on, **0 anon/authenticated grants**,
  `UNIQUE (user_id, epoch)`, **0 rows** — no backfill, as designed.
- `email_deliveries_item_type_check` unchanged: digest dedup untouched.

Verified in one transaction that rolled itself back, so nothing persisted and no mail
could escape (pg_net's worker reads committed rows only, so a rolled-back enqueue is
undeliverable by construction):

| step | ledger rows |
|---|---|
| follow-only INSERT (consent false) | **0** |
| consent false → true | **1** (epoch 1) |
| reconcile of an already-eligible row | still **1** |
| unsubscribe → re-subscribe | **2** (epochs 1, 2) |

Rollback confirmed: 0 probe users, 0 ledger rows, users still 6 / eligible 6.

Live endpoint probes, no mail sent: no secret → `401 {"error":"unauthorized"}`;
correct secret + unknown id → `502 {"ok":false,"outcome":"unknown_confirmation"}`,
which exercises secret → service-role → claim RPC → decision flow end to end.

**No confirmation email has been sent to anyone yet.** The first will go to the next
resident who genuinely opts in.
