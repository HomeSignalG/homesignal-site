# `persistEmail` caller audit (2026-09-11)

`shell.js::persistEmail` swallowed every failure and returned nothing, so **every** caller
showed a success state unconditionally. Worse than a bare `try/catch` looks: a PostgREST
rejection **resolves with `{ error }` rather than throwing**, so the `catch` was never even
the mechanism — the error was simply never read.

`persistEmail` now returns `{ ok }` and inspects the resolved error. This file records what
each caller does with that, and — where it is still ignored — the measured reason.

| caller | table | status |
|---|---|---|
| `HS.submitWaitlist` (premium modal) | `app_premium_waitlist` | **FIXED** — moved to `lib/premium-waitlist.js` + the `hs_premium_waitlist_join` RPC; success is shown only on confirmed persistence |
| `HS.submitRequest` (coverage modal) | `community_requests` | **BROKEN, documented, deliberately unchanged** |
| `HS.submitOnboardingRequest` (onboarding) | `community_requests` | **BROKEN, documented, deliberately unchanged** |

## The two `community_requests` callers

Both say *"Request received — we will email you when your area goes live"* after a write that
cannot succeed. Measured against production through PostgREST with the real anon key
(`pg_net`, 2026-09-11), sending the exact row shape `shell.js` sends today:

```
POST /rest/v1/community_requests   {"email":"…","zip":"78617"}
  -> HTTP 400  {"code":"PGRST204",
                "message":"Could not find the 'zip' column of 'community_requests' in the schema cache"}

POST /rest/v1/community_requests   {"email":"…","requested_zip":"78617"}
  -> HTTP 401  {"code":"42501","message":"permission denied for table community_requests",
                "hint":"GRANT INSERT ON public.community_requests TO anon;"}
```

Three independent faults, any one of them fatal:

1. the client sends `zip`; the column is `requested_zip` (there is no `zip` column — verified 0)
2. `anon` holds **no INSERT grant** (verified 0)
3. RLS is **enabled with zero policies**, so it denies regardless of grants (verified 0)

**Control for the claim:** the table holds 5 rows with a newest `created_at` of
**2026-06-27** — so it is not an empty table misread as a failure; nothing has landed through
this path in ~2.5 months.

## Why they were NOT fixed in this unit

Repairing them is not the same persistence-contract repair. It needs a schema/grant/policy
change to a **different** table plus a column mapping — i.e. a change to another table's
security posture and to product behaviour — which the authorising brief placed out of scope
("do not automatically refactor unrelated flows").

And making the UI honest *without* the database half would be worse than the current state:
every area request would start showing a failure message, because every area request really
does fail. Surfacing that is a product decision, not a mechanical one.

**Recommended next unit:** give `community_requests` the same treatment this unit gave the
waitlist — one `SECURITY DEFINER` join RPC, correct column mapping, no public table grant —
then branch both callers on `ok`. Small, and it reuses everything built here.

## Not in scope, noted

`persistFollow` and `persistTopics` swallow failures the same way, but they are not
`persistEmail` callers and they do not claim a capture to the visitor. `hsLogEvent`
(`events.js`) also swallows deliberately and correctly: analytics must never surface an error
or block the UI, and it is explicitly **not** the record of any lead.
