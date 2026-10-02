# Paid continuation — Order M, step M0: the contract and the payment-event ledger (audit 2026-10-01, built 2026-10-02)

Plan: `docs/development-activity-plan-2026-09-30.md`, Step 12 (lines 2147–2171), Order M (lines 2481–2491), Hard Rules 31–34
(lines 2555–2558). Status: `docs/development-activity-status-2026-09-30.md`. SQL of record: `docs/payment-event-ledger.sql`.

> **Order M stays OPEN.** This unit is step M0: a contract and a ledger that is **not applied**, has **no caller**, and decides
> **no entitlement**. A CTA with no working paid continuation path is not autonomous conversion (plan, Order M), and nothing here
> makes one. What is still missing is in §9.

## 1. What this is, in one paragraph

The plan says a free evaluation must lead to a self-service paid path, and that paid entitlement changes **only** from an
authoritative, server-verified payment event (Hard Rules 31–32, and "the billing provider is not the entitlement authority by itself").
For that to be possible, something has to record the processor's events in a form the entitlement can trust: each event once,
in the processor's own order, with a status word mapped so that an unknown one can never read as "active", and with nothing in it
that identifies a payer. That is the ledger. It is a table, one writer, one ordering rule and one status mapping, as SQL of record. It is
**not applied** to production, **nothing calls it**, and it writes to no entitlement or subscriptions table, because "is this account
paid" is Order L's decision, owned by one database function that does not exist yet.

**What a customer, a resident or the founder sees: nothing changes** for customers and residents — no page, copy, route, function,
table in production or policy. The landing page's commerce buttons stay inert (`aria-disabled`, no link, no handler) and its tripwire
test stays green. The founder sees this document and the decisions in §8.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

**Canonical truth path** (the audit's proposal; only the first arrow and the verifier exist in production today):

```
billing processor event
  → [HMAC-verified webhook — exists, homesignal-ingest, NOT touched here]
  → public.payment_event_record(...)          the only writer          (this unit, not applied)
  → public.payment_event                      append-only ledger        (this unit, not applied)
  → Order L's entitlement function            moves the account evaluation → paid → past_due → canceled
                                              atomically and idempotently  (NOT BUILT — Order L)
  → consumers: Order H's gate (admin-gate.ts replaces isAdmin), Order K's Billing tab, Order N's proof
```

**Decision owners — none duplicated:**

| question | owner | how this unit uses it |
|---|---|---|
| is the event genuine? | the webhook's signature check, upstream | not repeated |
| was it already recorded? | `unique (processor, idempotency_key)` on `payment_event` | the recorder returns DUPLICATE |
| which event is latest for a subscription? | `payment_event_latest_id()`, the one `ORDER BY` in the file | the recorder asks it; Order L must call it, never write its own |
| what does a status word map to? | `payment_event_map_status()`, the one mapping | a generated column; nobody can choose it |
| what may be stored? | `payment_event_allowed_keys()` and the column list | anything else is refused |
| **is the account paid?** | **Order L's entitlement function** | **not decided here, and `is_latest` is an ordering fact, never a paid status** |

**Shortcut check** — commands run in this worktree at `6faedf4`, each result quoted:

```
$ git grep -n -I -i -E "payment_event|payment-event" -- .
(no output: no file in the tree names the ledger)
control — the same kind of search finds a table that exists:
$ git grep -c -I "report_snapshot" -- . | wc -l
27
$ ls supabase/functions
_shared edge-probe follow-development-report geocode-address get-address-report get-development-activity-report get-future-surroundings-report
(7 entries, none a webhook, checkout or payment handler)
$ git grep -n -i -E "create table[^;]*(entitle|evaluation|credit|brokerage|quota)" -- 'docs/*.sql'
(no output: no SQL of record creates an entitlement, evaluation, credit, brokerage or quota table)
control — SQL files that create tables are found:
$ git grep -c -i -E "create table" -- 'docs/*.sql' | wc -l
77
$ git grep -n -I -E "from\(['\"]subscriptions['\"]\)|public\.subscriptions\b" -- . ':!*.md' ':!supabase/functions/get-address-report/dist/*'
docs/acquisition-dashboard-setup.sql:121:   'active',   (select count(*) from public.subscriptions where status = 'active'),
docs/acquisition-dashboard-setup.sql:122:   'trialing', (select count(*) from public.subscriptions where status = 'trialing'),
docs/acquisition-dashboard-setup.sql:123:   'canceled', (select count(*) from public.subscriptions where status = 'canceled')
supabase/functions/get-address-report/index.ts:575:   supabase.from("subscriptions").select("status").eq("user_id", uid).in("status", ["trialing", "active"]).limit(1)
```

- **A second reader exists that the audit did not list.** Besides the map product's gate (`get-address-report/index.ts:575`, read only when
  `PAYWALL_ENABLED` is `"true"`, line 117), the acquisition dashboard's funnel RPC counts `public.subscriptions` by status
  (`docs/acquisition-dashboard-setup.sql:121–123`). Both read the **map product's** per-user table. Neither is this product's entitlement.
- **Reusing `public.subscriptions` for brokerage pilots is refused**: it is user-scoped with no account, seat or allocation column, its
  readers are the map product's, and an `active` row would also unlock the map product's full tier — a second entitlement truth.
- **Moving the webhook into this repo is refused**: it would duplicate the one in `homesignal-ingest`. Changing it needs a cross-repo go.
- **No competing path is added:** the SQL names no table of anyone else's; a structural pin fails if it ever does (§10).

**Concurrency check — verdict: GENUINE GAP**, `main` at `6faedf4`. No file names the ledger (above); no function directory is a
webhook or checkout; no ledger or entitlement table exists in any `docs/*.sql`; `git log origin/main --grep` for payment, billing,
checkout, entitlement and lemon returns only the landing-page commits (#1474, #1478) and an older checkpoint correction. The 348 remote-tracking
refs in this clone include none named for payment, billing, checkout, paid, entitlement, Lemon Squeezy or continuation. **UNVERIFIED:** open pull
requests and branches pushed since this clone last fetched; this build was offline and made no GitHub call.

## 3. What exists today: the deployed webhook, read in full

`lemonsqueezy-webhook` is deployed (audit: version 4, `verify_jwt` false, last updated 2026-07-01) and its source is **not in this repo**. I read the
copy on disk at `homesignal-ingest/supabase/functions/lemonsqueezy-webhook/index.ts` (107 lines, md5 `3d1209f779a438ec31629b20f313ea80`) and
did not edit it. **UNVERIFIED:** that it is byte-identical to the deployed version (the audit compared by reading, not by hash; this build cannot reach production).
It verifies an HMAC-SHA256 `X-Signature` in constant time and rejects when the secret is unset (lines 43–56), acts only on `data.type === "subscriptions"`
(line 73), and upserts `public.subscriptions` on `processor_subscription_id` (lines 100–101). Ten gaps, each tied to a line:

| # | gap | evidence in the source |
|---|---|---|
| 1 | **No event record.** Nothing of what was received is kept; the only write is the upsert. | lines 100–101 |
| 2 | **No ordering guard.** An older event replayed later overwrites a newer status. | upsert, `onConflict: "processor_subscription_id"`, no condition (101) |
| 3 | **`updated_at` is arrival time**, not the processor's. | `updated_at: new Date().toISOString()` (96) |
| 4 | **No product or variant check.** The file reads neither. | `grep -n -i -E "product\|variant"` on the file returns no line |
| 5 | **No binding of payer to an evaluation or brokerage account.** The only link is `meta.custom_data.user_id`, an auth user id the checkout supplies. Whether a buyer can alter checkout custom data is UNVERIFIED. | lines 9, 78 |
| 6 | **`plan` is hard-coded** `"map_yearly"`. | line 93 |
| 7 | **An unknown status becomes `"canceled"`**: fails closed, but is indistinguishable afterwards from a real cancellation. | line 77, `STATUS_MAP[lsStatus] ?? "canceled"` |
| 8 | **No pause, past-due or grace policy.** Statuses pass through one to one. | `STATUS_MAP`, lines 26–34 |
| 9 | **Invoice and order events are acknowledged and dropped**, so a failed or successful payment is never recorded. | comment line 71, return line 73 |
| 10 | **No test-mode distinction.** The file reads no mode flag. | `grep -n -i -E "test_mode\|livemode"` on the file returns no line (control: `grep -c user_id` returns hits) |

The audit counted nine; the extra is gap 3, split from gap 2. A missing `user_id` is acknowledged and skipped (line 83); a database error
returns 500 so the processor retries (line 104).

**The table it writes is live, empty and user-scoped** (audit, 2026-10-01, read from production: not re-read here, this build is offline):
`public.subscriptions` 0 rows, RLS on, one policy (`read own subscription`), status CHECK of eight values, `UNIQUE(processor_subscription_id)`,
FK `user_id` to `auth.users`; no account, organisation, seat or allocation column. **UNVERIFIED here: that no real event has ever been
processed** (inferred by the audit from 0 rows, no redeploy since 2026-07-01 and 0 log rows for the function in one 24-hour window).

## 4. The ledger, column by column

`public.payment_event` — twelve columns. **Everything marked PROVISIONAL depends on the processor's real payload, which has not been seen.**

| column | what it holds | status |
|---|---|---|
| `event_id` | bigint, generated always: arrival order, used only to break a tie | settled |
| `processor` | lower-case name, 2–32 chars (`lemonsqueezy`) | settled; a new processor needs a reviewed branch in the mapping |
| `idempotency_key` | opaque token, supplied by the **caller**; unique with `processor` | **PROVISIONAL** (§5) |
| `subscription_ref` | the processor's own subscription id, opaque | **PROVISIONAL**: the webhook reads `data.id` for this today |
| `event_name` | the processor's event name, opaque | **PROVISIONAL** |
| `processor_status` | the processor's status word, **verbatim**, or null | settled (kept so history survives any mapping change) |
| `mapped_status` | generated: `trialing · active · paused · past_due · unpaid · canceled · unknown` | settled rule; mapping parity with the deployed `STATUS_MAP` |
| `occurred_at` | the **processor's** time, ISO-8601 **with an explicit offset** | **PROVISIONAL**: which payload field is it? |
| `recorded_at` | server clock at arrival | settled |
| `product_ref`, `variant_ref` | opaque catalogue ids, nullable (closes gap 4 once the catalogue is known) | **PROVISIONAL** |
| `livemode` | required boolean; test and live events never order against each other | **PROVISIONAL**: whether the payload carries a mode flag |

**Deliberately not stored — and refused if sent:** the payer's email, name, card data, address, **the processor's customer id**, the raw
payload, URLs, and the checkout's account id. The table is immutable, so nothing in it can be purged on a privacy request (CLAUDE.md,
"customer-entered private context does not become permanent"). The payer's email stays only in the mutable `subscriptions` row. An opaque
token cannot contain an `@` or a space, so an email address or a name cannot be one; that is a backstop, not proof (a bare word like `Smith` still fits),
and the real control is that the caller passes ids only. The customer id is excluded by default; whether it may be stored is decision 7 in §8.

**Mapping.** `on_trial→trialing`, `active`, `paused`, `past_due`, `unpaid`, `cancelled→canceled`, `expired→canceled`: the same seven the deployed webhook maps. One
deliberate difference: a word the map does not know is `unknown` here (the webhook stores `canceled`). `unknown` neither grants nor revokes by itself; what
the entitlement does with it is Order L's decision (§7). Case-sensitive: `ACTIVE` is not `active`. Another processor's `active` is `unknown` until a reviewed branch exists.

## 5. The provisional key and ordering choice, and the payload that must be captured — UNVERIFIED

This unit was built **offline**, with **no captured processor payload and without reading the processor's documentation.** Nothing below is a verified
fact about Lemon Squeezy; each is a **design need** the ledger has.

- **What the deployed webhook's own code reads** (verified by reading it): `meta.event_name`, `meta.custom_data.user_id`, `data.id`, `data.type`,
  `data.attributes.status`, `.user_email`, `.customer_id`, `.trial_ends_at`, `.renews_at`, `.ends_at`.
- **What the ledger needs that the webhook never reads** (so it cannot be confirmed from the code): a field that is unique per event or per delivery;
  the processor's own time of the event; product and variant ids; a test-mode flag.
- **Provisional choice.** The recorder takes `idempotency_key` and `occurred_at` from its caller, so a wrong guess is a change to the caller and not to this
  immutable table. The proposed key is `<event_name>:<subscription_ref>:<occurred_at>`, or the processor's event/delivery id if the payload carries one;
  the proposed time is the subscription object's own last-updated field. **Both are guesses.** A key that is too coarse would drop real events; the recorder
  therefore **refuses** (23505) a key that was already recorded for a *different* event instead of returning DUPLICATE, so the mistake is loud, not silent.
  A key that is too fine would double-record a retry; the suite proves a true replay is a DUPLICATE, including when the same instant is written in another offset.
- **Ties** on the processor's time are broken by arrival order (the later arrival is latest). **PROVISIONAL**: it is deterministic, not known to be right.

**What the founder can do to settle it** (founder action, in the processor's test mode): capture one real webhook body per event type the product will
use — at least subscription created, updated, cancelled, expired, resumed, and the payment failed and succeeded events — **with a throwaway payer email, and
redact the email and any customer detail before anything is committed**. Then answer: is there a per-event or per-delivery id; which timestamp is the event's time; do
product and variant ids appear; is there a mode flag; can events arrive out of order; what does it do on a 500. Until then the key and time columns stay provisional,
and the file is changed **before** it is applied, never after.

## 6. What the recorder does

`payment_event_record(p_event jsonb)` → `(outcome, event_id, is_latest, recorded_at)`; service role only; `SECURITY DEFINER`, `search_path` pinned.

- A new event → `RECORDED`. The same key again with the same facts → `DUPLICATE`, nothing written (including the same instant written in another offset).
- The same key for a **different** event (another status, subscription or mode) → error 23505 `payment_event_idempotency_key_reused`, nothing written.
- `is_latest` is true when this event is the latest of its `(processor, livemode, subscription_ref)` by the processor's time, then by arrival. An older event arriving later is recorded and
  reported `false`. Calls for one subscription are serialised by an advisory lock so this is accurate under a race (proved with two real sessions).
- **Refused, nothing written (22023):** a non-object; any key outside the nine-key allow-list (a payer email, a name, a card field, a customer id, a payload, `mapped_status`, `recorded_at`, …);
  a value that is not an opaque token (email-shaped, with a space, over 200 characters); a missing required key; a wrong JSON type; a timestamp with no offset or that is not a real instant; a bad processor name.
  The message names the **field** and never repeats a **value**.

## 7. Proposed entitlement state machine — DEFAULTS FOR THE FOUNDER, owned by Order L, NOT BUILT

Everything in this section is a proposal that nothing implements. It exists so Order L is built against a stated default instead of an invented one, and so each
place a default is not enough is a visible decision (§8). **Order L's one database function** would move an account, atomically and idempotently, from the **latest
live-mode ledger event** for its subscription (asked of `payment_event_latest_id`, never recomputed):

| latest ledger `mapped_status` (live mode) | proposed account state | note |
|---|---|---|
| `active` | **paid** | the only status that grants access |
| `trialing` | not paid | DEFAULT. OPEN: does the paid pilot have a processor-side trial? The free phase is the 20-report evaluation |
| `past_due`, `unpaid`, `paused` | **past_due** (does not grant) | DEFAULT: no grace period is invented. OPEN: grace length, if any |
| `canceled` | **canceled** | OPEN: whether access ends at once or at the end of the paid period. What the processor's `cancelled` and `expired` words mean for access is UNVERIFIED, and the ledger keeps the verbatim word so this can be decided without re-deriving history |
| `unknown` | **no change, and an alarm** | DEFAULT: never grants, never silently upgrades. OPEN: what happens to an already-paid account |
| any test-mode event | never affects a live account | DEFAULT |

Also proposed: the evaluation → paid transition happens only from a recorded, server-verified event for an account id the **server** minted and the checkout carried
(plan Hard Rule 32; never a success URL); the function is re-runnable (the same ledger state gives the same account state); `unknown` and any status not in the table are
never `paid`. The checkout's account id is added to the ledger, additively, by Order L if it wants it there; it is not here.

## 8. Decisions for the founder — open; none is answered by this unit

The first six are the audit's. **None is stated as copy anywhere.** The price on the landing page is quoted in §8.1 as what it says, not as a decision.

1. **The offer's unit and numbers.** The landing page publishes (`development-activity.html:351–361`): "New Member Price", "$79/month", "100 new Development Activity reports each month", "Cancel anytime", and (line 348)
   "Individual accounts receive 20 individual evaluation reports. Brokerage evaluation accounts share 20 reports across their invited evaluation users." It credits the "100126 plan"
   (commit `4ee6e29`), which is not in this repo; the plan's pilot is per brokerage (Order P, rules 38–41) and its own mock shows 500 reports. Decide the billing unit, price, **seats**, monthly allotment,
   whether the 20 free credits count toward it, rollover, and whether a poor-coverage report uses an allotment report (R5).
2. **Failed-payment and cancellation behaviour** — which the plan requires and never defines: grace on `past_due`, cancel at period end versus at once, refunds, and what happens to stored reports and open
   Follow / account needs after cancellation (private-context contract D-4).
3. **Commercial terms (legal).** The Terms of Use say HomeSignal is for "your own personal, non-commercial purpose" (`privacy.html:53`) and nothing there mentions subscription, billing, refund, cancellation, payment, fee or a processor.
   Replace it with a commercial and client-sharing licence; add renewal, cancellation, refund and tax terms; confirm "Cancel anytime"; add the processor to the privacy disclosure. This is for counsel, not for code.
4. **Confirm the processor for this product** (Lemon Squeezy was chosen 2026-07-01 for the $9.99/year map page, and the 2026-09-29 reconciliation only recommends it as a default, D6) and **create the store, a test-mode variant, the
   webhook URL and its signing secret**. Also whether a brokerage plan needs seats or invoices the processor cannot give.
5. **Source rights.** Whether any paid pilot may start before at least one source family is cleared (R4 / master step 2). Today `report-rights.json` lists none, so a paid report shows no records.
6. **Authorisation to change `homesignal-ingest`** (move, extend or retire the webhook; own the billing DDL), because the change spans both repos, and the ownership rule for billing code from here on.

Raised by this build:

7. **May the processor's customer id be stored in the immutable ledger?** DEFAULT: no (it is pseudonymous but resolves to a person at the processor, and the table cannot be purged).
8. **A far-future `occurred_at`** would pin an event as "latest" and hide later real ones. DEFAULT: recorded as given, no threshold invented; Order L must decide whether to flag or ignore it.
9. **What an `unknown` latest event does to an already-paid account** (§7).
10. **Are payment (invoice) events recorded?** DEFAULT: only subscription lifecycle events, as the webhook acts today; payment success and failure events (gap 9) are not recorded in M0.
11. **Is `trialing` paid, and is there a processor-side trial** (§7).

## 9. What must exist before Order M can complete

M cannot be completed before **L** (the evaluation/brokerage account record, the 20-credit ledger with its idempotency key, the "evaluation complete" state, the server-minted account id the checkout carries — none exists: the
audit found no evaluation, entitlement, quota, credit, brokerage, organisation, team, seat, invite or billing table in production), **H** (the one commercial generation path and the entitlement check in
`supabase/functions/_shared/admin-gate.ts` in place of `isAdmin`; its header says "the entitlement check replaces `isAdmin` HERE", `admin-gate.ts:9`), **K** (explicit brokerage membership and an owner role, rules 40–41, and the Billing / Manage plan surface) and
partly **J** (stored-report delivery and the closing of the private-context `report` need, so cancellation has defined consequences). It also needs: a founder-created processor store and one real test-mode payload; counsel-reviewed
terms; at least one cleared source family; a resolved offer; and authorisation to touch `homesignal-ingest`. **Not built here, and not claimed:** a checkout, a webhook change, an entitlement function, a Billing tab, any page or copy.

## 10. Proof

Commands run in this worktree (Postgres 16.13 local, UTF8, a private cluster; CI runs Postgres 17). **Not run here:** the GitHub workflow on a runner, Postgres 17, and anything against production.

| command (run in the worktree) | decisive output |
|---|---|
| `PGHOST=… PGDATABASE=m0_disposable bash test/payment_event_ledger_pg/run.sh` (exit 0) | `SHIPPED: 55 checks, 0 failed` · `APPLIED TWICE with an identical definition` · `ROLLED BACK every object, left the subscriptions stand-in untouched, and re-applied to an identical definition` · `RACED: a retry on one key recorded once, and an older event racing a newer one was not reported as the latest` · **41 prohibited mutations of the SQL: 41 `KILLED`, 0 `SURVIVED`, 0 `HARNESS`** (counted from the saved log) |
| `node test/payment-event-ledger-structure.test.mjs` | `59 passed, 0 failed of 59` |
| `python3 test/payment_event_ledger_mutants.py` (exit 0) | `63 mutations run, 63 killed, 0 survived, 0 harness faults; 59 of 59 pins were turned red by at least one mutation` |
| `node test/development-activity-landing.test.mjs` | `ALL PASS` (the commerce buttons are still inert, the page links no checkout, it is still noindex and out of the sitemap) |
| `bash test/report_snapshot_pg/run.sh` (exit 0) | `SHIPPED: 66 checks, 0 failed` · `UPGRADED the Order F table…` · 54 `KILLED`, 0 `SURVIVED` |
| `bash test/report_private_context_pg/run.sh` (exit 0) | `SHIPPED: 52 checks, 0 failed` · 51 `KILLED`, 0 `SURVIVED` |
| `node scripts/run-unit-tests.mjs` | `All 289 unit test file(s) passed (mode=offline).` (exit 0; offline is the required CI mode, and the 289 include the structural test above). The all-modes run, which adds 47 browser-backed suites, was started and then stopped by me after it sat in the fourth suite (a browser-backed one this change does not touch) for about ten minutes in this sandbox, so those 47 were not run to completion here |

**What each pin is for.** The SQL suite's checks are the audit's D1–D9 and more: D01 once (a replay is a DUPLICATE, the same instant in another offset is still one, a reused key for a different event is refused, the key is scoped to its processor);
D02 in order (an older event arriving later is recorded and reported not-latest; arrival order does not decide, shown with the same three events in two arrival orders; a tie is broken by arrival; a test-mode or another processor's event never displaces a live one);
D03 append-only (update, delete, truncate refused for the owner, beside a control that the same statements work on an unprotected copy); D04 lock-down (anon, authenticated and PUBLIC hold nothing on the table, the sequence or any of the eight functions, beside a control that Supabase's default privileges would have granted them);
D05 row-level security (and with SELECT deliberately granted to anon the table still returns it 0 rows); D06 an exact twelve-column allow-list, 21 stray keys each refused, an email, a name and an over-long value refused in every opaque field with the message never repeating the value;
D07 status mapping (the seven webhook statuses map as the deployed `STATUS_MAP` does; every other word, case and processor maps to `unknown`; nothing is `active` except the processor's own `active`); D08 definer rights and a pinned search path; D09 a trapped stand-in `subscriptions` table that raises on any touch is never touched.
Every expected value is a hard-coded constant. **Mutations the audit named, all killed:** the unique idempotency key dropped, the append-only trigger dropped, execute granted to `authenticated`, ordering by arrival, an email column added, the allow-list widened (and the whole payload stored), the search_path pin removed, the recorder writing to `subscriptions`, an unknown status mapped to `active`.
**Three things the first runs found in my own work, each fixed before this was written:** a check read a row in the same statement that recorded it (a scalar subquery runs before the function calls beside it, so it saw nothing, and the check failed on correct code);
two structural pins had never been shown able to fail — one tested for a clause's text and not for that clause being the only condition on the refusal of a reused key, and one looked for `payment_event` as a whole word and so would have missed a caller naming `payment_event_record` — and one of my mutations
was placed where a later apostrophe in a comment closed the unterminated quote it planted. The mutation harness's coverage rule (every pin must be turned red by some mutation) is what found the two pins.

**Not exercised, and not claimed:**
- The GitHub workflow on a runner, and Postgres 17 (CI's version); the suite ran on Postgres 16.13.
- Anything against production. The ledger is not applied; no migration ledger entry, no read-back, no behaviour probe exists.
- The processor's real payload, retries or event order: every event is synthetic, and the key, time and ids are PROVISIONAL (§5).
- A call through PostgREST or an edge function as the service role: privileges are checked with `has_*_privilege` and with `set role` inside one session, as the other report suites do.
- More than two concurrent sessions, or a race under sustained load.


## 11. Applying it, and rolling back

**Not applied.** It is merged without being applied, as Orders F and F2 were, and **applying is a separate step that needs a founder go and, first, a captured payload (§5)**, because the columns are provisional and the table is immutable.
Apply through the repo's approved path only — `db-sql.yml`, or `apply_migration` from the committed file — and **never** a `begin; … rollback;` dry run against production (CLAUDE.md §7.11: a rolled-back DDL still holds its locks and the platform runs DDL hooks).
It has no precondition on any other table, so its order against Orders F and F2 does not matter. The migration text should be fingerprinted against the file after apply (CLAUDE.md claims rules 7–9).
Rolling back is the commented block at the foot of the file (between `ROLLBACK-BEGIN` and `ROLLBACK-END`); it **deletes recorded events**, so it is appropriate only before the first real one is recorded. The harness runs it and proves it.

## 12. What this unit does not do

- It does not decide, grant, change or read any entitlement, account, credit or subscription, and nothing reads the ledger.
- It does not change the deployed webhook, the `subscriptions` table, the map product's paywall, or the landing page (its buttons stay inert and its tripwire test stays green).
- It does not create a checkout, a processor store, a price, a plan, terms or copy.
- It is **not** evidence that a payment path works: nothing here has run against the processor, and **no real event has ever been recorded** (the ledger has not been applied).
- Production facts in §3 and §9 are carried from the audit of 2026-10-01 and were **not re-read** in this offline build.
