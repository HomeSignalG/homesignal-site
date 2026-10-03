# The national Development Activity report engine — Order G (2026-09-30)

Plan: `docs/development-activity-plan-2026-09-30.md`, Steps 9 and 10, Order G ("Deploy and production-smoke the canonical
commercial API. Keep JWT/authenticated posture. Do not weaken it into a public anonymous generator").
Founder go, 2026-09-29, under one rule: **no production path may permanently write a brokerage-entered exact address into
the immutable snapshot, and no real customer report is stored until the five gates in
`docs/report-private-context-contract-2026-09-30.md` §6 are closed.**
Code: `supabase/functions/_shared/national-report.ts` (assembly), `supabase/functions/get-development-activity-report/`
(`handler.ts`, `data.ts`, `index.ts`), `supabase/functions/_shared/report-rights.json`, `scripts/gen-project-type-module.mjs`.

## 1. What this is, in one paragraph

An address goes in; a **HOMESIGNAL DEVELOPMENT ACTIVITY** report comes out, for any address in the 12,722-ZIP product
universe, built from the development data HomeSignal already holds. It is a server path behind a signed-in login. It builds
the report as **two separate objects** from the start — the permanent *intelligence* and the customer's *private context* —
so the address is never inside the permanent object. It stores nothing. It shows a source's records to a customer only if
that source is on a written clearance list, and **that list is empty today**, so today every customer report says, honestly,
that no official source is included yet.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** address → `geocode-address` (the one geocoder) → `canonical_zip_registry` (12,722) →
  `public.n5_projects_within_radius` (canonical geometry: which projects are near) → `public.app_projects` (the record's own
  fields, by `source_key`) → `lib/project-type.js` (Type and canonical lifecycle) → `public.dev_change_project` and
  `public.dev_change_event_reportable` (what changed) → `report-rights.json` (may this source appear) →
  `national-report.ts` (composition only) → `report_snapshot_issue` (the one writer; **not called here**).
- **Decision owners — none duplicated:**

  | question | owner | how this engine uses it |
  |---|---|---|
  | is the ZIP in the product? | `public.canonical_zip_registry` | asked per request; not cached, not copied |
  | which projects are near the address? | `public.n5_projects_within_radius` | called with its own parameters; no distance is computed here |
  | what is the project's Type? | `lib/project-type.js` `canonicalProjectType` | called; a generated verbatim copy is loaded (§3.4) |
  | what is its canonical lifecycle? | `lib/project-type.js` `canonicalLifecycle` | called; the publisher's status word is carried separately, verbatim |
  | did it change, and may we call it a change? | `public.dev_change_event_reportable` | the only event read; the raw event table is never read |
  | may this source's content be shown? | `supabase/functions/_shared/report-rights.json`, from the rights audit | closed by default; a HOLD is never cleared (R4) |
  | may this address be stored? | `report_private_context_*` / `report_snapshot_issue` | not called |
- **Shortcut check:** searched `supabase/functions`, `lib/`, `scripts/`, `docs/*.sql` and `test/` for a second geocoder (none: the
  new function calls `geocode-address`), a second Type or lifecycle rule (none: `test/national-report-structure.test.mjs` 1d/1e
  fail if one appears), a second spatial read (none), a second reader of ledger events (none), and any other caller of
  `report_snapshot_issue` (none: 3d). The legacy NYC engine (`get-future-surroundings-report`, `lib/nyc-v1-report.js`) is not
  imported (2g). There is one commercial engine.
- **Concurrency check (2026-09-29 → 30):** no open PR or recent branch builds a national report path; the only branches near it
  are N5 build automation, the landing page and the historical-intelligence contract (#1467, complementary). **GENUINE GAP.**

## 3. What the audit found (measured before any code, 2026-09-29; each with its control)

1. **The plan's "canonical commercial API" was never deployed.** `get-future-surroundings-report` is the NYC-only, Socrata-only
   allowlist API; it is not in the project's function list. Control: the same listing shows 19 functions including the
   JWT-protected `geocode-address` and `edge-probe`, so the listing works. Order G therefore builds the national path; it does
   not deploy the NYC one.
2. **`verify_jwt = true` does not mean "a signed-in user".** The gateway checks that a token is validly signed, and the public
   anon key is a validly signed token that is in every page of the site. `verify_jwt` alone leaves an anonymous generator —
   exactly what the plan forbids. So the handler additionally requires a real user whose email is in `public.dashboard_admins`
   (§5, D-G1). The same weakness exists in the NYC function; it is left alone (R6).
3. **Rights are unpopulated, on purpose.** `dev_change_event.rights_class` is NULL on 922,244 of 922,244 events (the ledger's
   design: rights are enforced at report time). `dev_change_event_reportable` returns **0** rows. The rights audit's verdict is
   NOT YET and its HOLD stands (R4). There was no machine-readable rights registry, so this unit creates one, empty.
4. **The ledger is national:** 932,969 projects, 254,193 of them change-ready (comparable and observed at least twice), 922,244
   events — all from the baseline run, none reportable yet. The registry holds 12,722 ZIPs.
5. **The date vocabulary carries sentinels.** Over `app_projects` (`record_kind = 'development'`), `date_kind` is `issued`
   1,888,854 · `filed` 663,023 · (null) 163,525 · `scheduled` 136,675 · `decided` 39,232 · `awarded` 18,094 · `estimated` 11,113 ·
   `hearing` 3,119 · `completed` 2,666, and the dates include 1900-01-01, 1969-12-31, 2099-02-12 and 9999-09-09. A window bounded
   above by today and below by 90 days excludes every sentinel by construction; `scheduled` and `estimated` are plans, not events.
6. **The spatial read reports truncation explicitly** (`has_more`, never inferable from the row count), and a project has one
   `app_projects` copy per ZIP page, so hydration by `source_key` returns several rows per project.
7. **The five report tables are empty and stay empty:** `report_snapshot` 0, `report_private_context` 0 (control: the ledger
   tables in the same query are populated).
8. **`service_role` can read everything the function touches, and `anon` / `authenticated` cannot read the ledger or
   `dashboard_admins`** (`has_table_privilege`, 2026-09-29), so no other path exposes them.

## 4. What was built

| file | what it is |
|---|---|
| `_shared/national-report.ts` | **pure** composition: `assemble`, `boundaryFindings`, `validateRights`, `recentPublisherEvent`, and (since the Follow change, 2026-10-01) the one change rule: `isChangeReady`, `materialEvents`, `selectDetectedChanges`, `detectedChangeEntries`, `sourcesNotFullyRead`, the `WrittenEvent` type. No environment, no network, no client. |
| `_shared/admin-gate.ts`, `_shared/service-rest.ts`, `_shared/change-reads.ts` | *(moved here from this function's `handler.ts` / `data.ts` by the Follow change, so the two functions share one definition each)* the sign-in and allow-list gate; the PostgREST transport and its fail-closed rules; the ledger SELECTs (projects, reportable events, source health). |
| `_shared/changes-since-report.ts` | the Follow function's pure reader; it uses the change rule above, never a copy. Not used by this endpoint. |
| `_shared/report-rights.json` | the source-family clearance list. `"cleared": []`. |
| `_shared/project-type.generated.js` | `lib/project-type.js`, byte for byte, generated by `scripts/gen-project-type-module.mjs` (`--check`). |
| `get-development-activity-report/handler.ts` | who may ask, what they may ask, what happens next. Everything external is injected. |
| `get-development-activity-report/data.ts` | the reads specific to this endpoint (geocode, spatial read, hydrate), from an injected `fetch`; fails closed. The ledger and health reads now come from `_shared/change-reads.ts`. |
| `get-development-activity-report/index.ts` | wiring only. |
| `supabase/config.toml` | `verify_jwt = true`, pinned. |
| `test/national-report*.test.mjs`, `test/national_report_pg/`, `test/national_report_mutants.py` | the proof (§8). |

### 4.1 The split (contract §8.1–§8.2)

`assemble` returns `intelligence` (permanent), `privateContext` (deletable), `renderOnly` (this response only).
The intelligence holds the ZIP, the radius, the projects and their sections. It holds **no** address, matched address, label,
subject coordinate, distance, offset or bearing. Distances are in `renderOnly.distances_mi` and are never hashed or stored.
The strongest single proof is a property, not a fixture: **the permanent body is byte-identical for six different subject
addresses in the same area**, so nothing subject-specific can be in it (`national-report.test.mjs` 6b), and the same six,
stored in a real Postgres, yield six `report_id`s and **one** `content_hash` (`national_report_pg` 1c).

### 4.2 The boundary check that looks for fragments (contract §8.4)

The database matches whole private values only (contract §9). `boundaryFindings` looks for what it cannot: the street line,
house number + street word, the normalised address, the label, a five-decimal coordinate, and any subject-relative key. Its
findings name the KIND of leak and never repeat the value. `assemble` puts any finding in `storage_blockers`. The defect this
check itself had at first — a value filling a whole JSON string has no space on either side — was found by
`national-report.test.mjs` 7b and fixed (substring match).

### 4.3 The response

```
{ status: "OK" | "ADDRESS_NOT_RESOLVED" | "OUTSIDE_COVERAGE",
  coverage_state: "REPORT_READY" | "CHANGE_READY" | "LIMITED_COVERAGE",
  report: { product, report_version, as_of, zip, radius_mi, recent_days,
            coverage: { zip_supported, state, change_ready, area_truncated, source_families_in_report,
                        assessment_basis: "records_returned_for_this_radius", limitations: [{ code, text }] },
            sections: { what_changed_recently: [project_id], recent_official_activity: [project_id],
                        by_lifecycle: { approved, proposed, operating, unknown } },
            projects: [{ project_id, source_family, name, address, type, lifecycle, publisher_status, publisher_stage,
                         publisher_event, developer, size, investment, source: { url, attribution },
                         homesignal_observation, homesignal_detected_changes? }] },
  render: { distances_mi },            // this response only
  stored: false, report_id: null, storable, storage_blockers }
```

**Added since (2026-10-02).** `report_version` is `development-activity-national-3`. Step 2 of the 100526 build added
`stage_rule_version`, `sections.by_stage`, each project's `stage`, and `render.bearings_deg` / `render.review`. Step 5a added:
- `report.activity: { outcome, label, rule_version }`, the report's outcome (founder ruling R5,
  `docs/development-activity-founder-ruling-r5-2026-10-02.md`):
  - `DEVELOPMENT_SHOWN` ("Development shown");
  - `NO_DEVELOPMENT_ACTIVITY` ("No development activity"), only once HomeSignal can prove its data for the address is coming
    in, which nothing can yet;
  - `NO_DATA_INGESTED` ("No data ingested"), every empty report today.

  `activityOutcome()` decides it, from the number of projects in this report after the rights gate. `activity_rule_version`
  is in the engine inputs.
- `credit: { uses_report, reason, rule_version }` on every report and on `ADDRESS_NOT_RESOLVED` / `OUTSIDE_COVERAGE`. It
  says whether a trial customer's report would use one of the 20 free reports.
  - The one owner is `_shared/credit-rule.ts` `creditDecision()`.
  - *(5a)* This endpoint charges nothing. *Superseded by 5b, next.*

**Step 5b (2026-10-02): invited trial members.** Who may call is `_shared/admin-gate.ts` `authorizeReportCaller`:
- **An admin** (`dashboard_admins`), exactly as before: either view, never charged, nothing stored, no idempotency key accepted.
- **A trial member**: `public.evaluation_usage` (by the auth user's id, never the email) answers an `active`, unexpired trial.
  - The customer view only.
  - Every request carries `idempotency_key`, a random (v4) UUID the page mints once per report and repeats only to retry it.
  - The answer carries `trial: { status, credits_used, credits_remaining }`, never an id.
- **Anyone else**: 401 or 403 before the body is read. A used-up trial gets 403 `evaluation_complete` with its counts.

**What is charged.** Only a trial report that `creditDecision()` charges:
- It is stored and charged in ONE database transaction by `public.evaluation_report_issue`, reached only through
  `_shared/report-snapshot.ts` `issueEvaluationReport`. That function shares its body preparation and boundary checks with
  `issueSnapshot`, which this function never calls.
- The answer then says `stored: true`, `charged: true` and the stored `report_id`.
- Today `report-rights.json` clears nothing, so every trial report is "No data ingested": free and stored nowhere. The charged
  path is reachable only once a source is cleared.

**A retried key** returns the FIRST report and charges nothing (`replayed: true`, `charged: false`). The key is bound to the
evaluation, never to the address (L1 D-L6), so the first report is shown only after its private context says it is the same
property:
- `report_private_context_read` is called inside the data layer, and only match, mismatch or unknown leaves it.
- A mismatch, a purged context or no context is 409 `idempotency_key_reused`, with no report.

**A refusal from the ledger** stores nothing, charges nothing and returns no report:
- `EVALUATION_COMPLETE` (another request used the 20th report first) is 403;
- `NOT_ENTITLED` is 403;
- a 5xx is 502.

**Defaults taken in 5b** (the founder may change any of them):
- **D-5b-1.** A trial whose 20 reports are used makes no more reports, even free ones. More is the paid product's (Order M).
- **D-5b-2.** A person on the admin list is always served as an admin, and is never charged, even if also a trial member.
- **D-5b-3.** A trial member never sees the internal view.

**Still open, stated:**
- No rate limit on free trial reports. "No data ingested" is free by ruling, so one member could make unlimited reports, each
  costing a geocode and a spatial read. L1 §8 named this; it must be closed before the trial is opened to brokerages (build
  step 13).
- Nothing yet creates a trial (build step 5d) or lets a member use one from a page (5c). Production holds 0 evaluations,
  so no one can reach the trial path today.

**Step 5c (2026-10-02): the customer page and joining a trial.**

**The page: `development-activity-reports.html`.**
- It is reached from an invite link: `development-activity-reports.html#invite=hse1_…`.
- Like the review page, it is noindex, disallowed in robots.txt, in no sitemap or navigation, and linked from no other page. The
  landing page's hidden buttons point to it at launch (step 13).
- **The invite token rides in the URL fragment**, which the browser never sends to a server. The page removes it from the address
  bar as soon as it has read it.
- It keeps the token in this tab's storage (`sessionStorage`) only until the trial function has answered it, so a reload during
  sign-in does not lose the invite. Nothing else is stored: no address, no report.
- **Sign-in may create an account**, unlike the review page, because an invited person usually has none. An account alone grants
  nothing: both functions answer only about the signed-in person, and the report function serves only an admin or an active trial
  member.
- **It shows "N free reports left"**, from the trial function on load and from the report function's own count after each report.
- **It asks only for the customer view.** It draws the report with the same shared report view as the review page, and puts
  the report function's charge decision into words. It decides nothing about charging itself.
- **Each report request carries a random v4 key made once.**
  - After a lost answer, pressing "Make report" again for the same address resends the same key. If the server had already
    charged the first request, the retry gets that report back with `replayed: true` and nothing more is charged.
  - Any answer from the server ends the request, so the next report gets a new key.
  - An admin's request carries no key, because the report function refuses one.

**The function: `development-activity-trial`** (`verify_jwt` on). Any signed-in user with an id may call it
(`_shared/admin-gate.ts` `authorizeSignedIn`); it answers only about that person. It has two actions:
- **`status`** says how the report function will treat this person:
  - `access` is one of `admin`, `trial`, `complete`, `ended` or `none`;
  - the trial is described by its counts only, never an id.
- **`redeem`** joins a trial with an invite token, through `public.evaluation_invite_redeem`:
  - the same person opening their own invite again gets `replayed: true`;
  - an unusable invite is 400 `invite_unusable` (the database's one generic refusal);
  - someone already in a brokerage gets 409 `already_a_member`;
  - a trial with no free seats gives 409 `seat_limit_reached`;
  - an unreachable database is 502, never a refusal.

**One path, not two:**
- `_shared/evaluation-reads.ts` is now the one place an edge function names the trial's database functions (status and
  redemption). Both functions use it; charging stays in the snapshot module.
- The database-call helper moved to `_shared/service-rest.ts`.
- `trialStanding` in `_shared/admin-gate.ts` is the one reading of whether a trial may make reports. The report gate refuses on
  it, and the trial function reports it.

**Proof:**
- `test/development-activity-trial-function.test.mjs` (52 checks).
- The page: `test/development-activity-reports.test.mjs` (36) and `test/development-activity-reports.browser.test.mjs` (33).
  In the browser test, both functions are answered by their real handlers.
- `test/trial_report_pg`, now 28 checks: joining goes through the real trial handler and data layer against the shipped SQL.
  - Covered: the invite used once, a replay, someone else's used invite, a malformed token, already a member, no free seats,
    and "complete" after 20.
- `test/development_activity_reports_mutants.py`: 36 prohibited mutations, all killed.

**Still open, stated:**
- Nothing yet creates a trial or its owner invite from a page or function (step 5d), and no owner can invite agents yet
  (`evaluation_invite_mint` with an owner as actor). Production holds 0 evaluations, so no one can reach the page's trial path
  today.
- The rate-limit gap from 5b is unchanged.

**Step 5d (2026-10-02): creating a brokerage's trial.**

**The action: `create`, on `development-activity-trial`, for admins only.**
- It runs after the function's own sign-in gate. Before a single field is read, it refuses anyone not on `dashboard_admins` with 403.
- It checks every field before the database is asked:
  - `brokerage_name`: required, trimmed, at most 120 characters, no control characters or line breaks;
  - `seat_limit`: optional, a whole number from 0 to 1000; left out (or null) means no limit (D-L2);
  - `trial_days`: optional, a whole number from 1 to 365; left out (or null) means no end date (D-L3).
- A wrong field is 400 `bad_request`, with `detail` naming the field. The bounds are input checks, not product limits.
- It then calls `public.evaluation_create` through `_shared/evaluation-reads.ts` `createTrial`. That function makes the brokerage's
  account, its trial and the first OWNER invite in one transaction. The invite lives the database's default 14 days (D-L4); the
  request cannot change that.
- **The answer** is the trimmed name, the seat limit, the end date (or null), the **owner invite link** and its expiry.
  - It carries no id: not the account's, the trial's or the invite's.
  - The link is the one secret the function ever returns, and only to the admin who just created the trial. HomeSignal stores
    only the invite's hash, so nothing can show the link again.
- **A database refusal is 422 `rejected`.** Its function is one transaction, so nothing was created.
- **An unreachable database is 502**, and the trial may or may not exist.

**The invite link has one form, written in one place:** `_shared/evaluation-reads.ts` `inviteLink`, giving
`https://homesignal.net/development-activity-reports.html#invite=<token>`.
- The customer page reads exactly this. `test/development-activity-trial-function.test.mjs` 6w runs the page's own fragment
  reader on the link, and the customer page's browser test opens the link the server makes.
- The review page builds no link of its own and does not name the customer page.

**The page: "Start a brokerage trial", on the private review page** (`development-activity-review.html`, admin only).
- Fields: brokerage name, agent seats (optional), trial length in days (optional).
- On success it says what was created and shows the owner link, with a "Copy link" button and who to send it to: the first person
  to open it and sign in becomes the trial's owner. It also says until when the link works, and that it is shown only once.
- The link is kept only in the open page: never in browser storage. Signing out takes it off the page.
- The form is cleared after a trial is created, so a second press cannot repeat it by accident. A press while a request is in
  flight does nothing.
- Signed out, pressing "Create" opens the sign-in. After the code, the waiting trial is created once.
- A refusal says nothing was created. A lost or unknown answer says HomeSignal could not confirm whether the trial was created;
  it never says the trial failed.

**Decisions taken by default (the founder may change any of them):**
- **D-5d-1.** Creating a trial is an admin act on the existing review page and the existing trial function. There is no new page
  and no new function.
- **D-5d-2.** No seat limit or end date is chosen for the founder: both are optional fields, blank means none, and the page
  invents neither. The plan names no number (evaluation doc, open questions 4 and 5).
- **D-5d-3.** A lost answer is not retried automatically. If the trial was created, it sits unused: it has no members, and its
  owner link expires after 14 days. Creating it again makes a second account with the same name. Revoking the unused one is
  `public.evaluation_revoke` (SQL; no page yet).

**Proof:**
- `test/development-activity-trial-function.test.mjs`, now 102 checks. §6:
  - the admin gate before any field;
  - every field rule, at the edge and past it;
  - the answer's exact fields;
  - the refusal mapping;
  - the real data layer's exact requests;
  - the one form of the link, and that the customer page reads it.
- `test/development-activity-review.test.mjs` (35) and `test/development-activity-review.browser.test.mjs` (53). In the
  browser, the trial function is answered by its real handler.
- `test/single-customer-generation-path.test.mjs`:
  - P4 now admits the review page for the trial function;
  - P5i: the review page asks for nothing but `create` and never reads its own address's fragment;
  - P5j: `create` refuses a non-admin before reading a field, and is the only call that creates a trial.
- `test/trial_report_pg`, now 36 checks. Creating goes through the real handler, data layer and shipped SQL:
  - a non-admin writes nothing;
  - an admin's trial is one account, one active trial and one open owner invite, whose hash matches the link's token;
  - the 14-day lifetime;
  - no id in the answer;
  - a seat limit and length reach the database as typed;
  - a refused field writes nothing.
- `test/development_activity_trial_create_mutants.py`: 32 prohibited mutations, all killed.

**Still open, stated:**
- An owner cannot yet invite agents. That is `evaluation_invite_mint` with the owner as actor, on the customer page; nothing calls
  it yet. Until it exists, a trial's only member is its owner.
- The rate-limit gap from 5b is unchanged.
- How PostgREST turns the database's refusals into HTTP answers is still unchecked against production. It becomes checkable once a
  test trial exists.

**Step 5e (2026-10-02): an owner invites agents.**

**The action: `invite`, on `development-activity-trial`, for an owner of an active trial.**
- It runs after the function's own sign-in gate and reads nothing the caller sent except the action. A role, an actor or a token in
  the request is ignored.
- It reads the person's trial (`trialOf`):
  - no trial: 403 `forbidden`;
  - a trial that is not active (its 20 reports used, revoked or expired, read through the shared `trialStanding`):
    409 `trial_not_active`, because an agent joining it could make no report.
- It then calls `_shared/evaluation-reads.ts` `inviteAgent`. That reads the person's own evaluation and calls
  `public.evaluation_invite_mint` with role `agent` and the person as the **actor**.
  - So the **database** checks, under the evaluation's lock, that this person is an active owner of that very brokerage and that the
    trial is neither revoked nor expired (D-L8: an owner may mint agent invites only).
  - The handler does not check the role itself. A database refusal (`NOT_ENTITLED`) is 403 `not_owner`.
- **The answer** is the agent invite link and its expiry, nothing else.
  - The link has the one form `inviteLink` writes, so it opens the same customer page and is redeemed by the same `redeem` action.
  - The evaluation id is used inside the shared module and never leaves it. The invite lives the database's default 14 days (D-L4).
- **The seat limit is checked when an agent joins**, never when a link is made (D-L2). An owner may make any number of links; once
  the seats are full, the next agent to open one is told the trial has no free seats left.
- An unreachable database is 502. An invite made but never seen sits unused and expires on its own.

**The role.** `status` and `redeem` now carry `role`: `owner`, `agent`, or null when the person has no trial.
- It is read by `roleOf` from the one membership resolver, `public.brokerage_membership_of` (Order K0). It is never re-derived, and
  the redeem answer no longer echoes the invite's role.
- It decides only what the page OFFERS. Whether an invite may be made is the database's own check at the moment it is made.
- `_shared/evaluation-reads.ts` is now the one reader of the resolver outside the SQL, and it reads no account or membership table.
  `test/brokerage-account-structure.test.mjs` 4 was changed deliberately to admit exactly that one rpc call.

**The page: "Invite an agent", on the customer page** (`development-activity-reports.html`).
- Shown only to an owner of an active trial (access `trial` and role `owner`, both as the trial function named them). Agents,
  admins, people with no trial, and owners of a used-up or ended trial do not see it. Using the last free report takes it away.
- "Make an invite link" shows the link once, in a read-only box, with "Copy link" and a note: send it to one agent; the first person
  to open it and sign in joins as an agent; until when it works; a full seat limit stops it; HomeSignal shows it only this once.
- Each press makes a new link (one per agent). The page checks the link's form before showing it and builds no link of its own.
- The link is kept only in the open page, never in browser storage. Signing out, a different person signing in, and an unreadable
  trial each take the card and its link away at once. A link that arrives after its person signed out is never shown.
- Answers in plain words: only an owner can invite; not part of a trial; only while the trial has free reports left; could not be
  made just now, try again. After a refusal the page reads the trial again.

**Decisions taken by default (the founder may change any of them):**
- **D-5e-1.** Inviting is offered and allowed only while the trial is active. The database alone would also let an owner mint on a
  used-up trial; an agent joining it could make no report, so the function refuses first.
- **D-5e-2.** An owner may make any number of agent links; seats are enforced when an agent joins (D-L2). An owner cannot see,
  list or withdraw the links they made. Withdrawing one is `public.evaluation_invite_revoke` (SQL; no page yet).
- **D-5e-3.** No new database object. The invite comes from the existing `evaluation_invite_mint`, the role from the existing
  `brokerage_membership_of`, and both are already executable by the service role only.

**Proof:**
- `test/development-activity-trial-function.test.mjs`, now 144 checks.
  - §2/§3: the role in `status` and `redeem`, read from the resolver for the person's own id, only when they have a trial.
  - §4: the resolver's wrong shapes and refusals are 502, never a guessed role.
  - §7: no trial; every non-active standing; the database's refusal; the answer's exact fields; the request carries nothing to the
    invite; the real data layer's exact five requests (the mint asks for an AGENT invite with the person as ACTOR); every wrong
    answer shape; the shared module's own refusals.
- `test/development-activity-reports.test.mjs` (52) and `test/development-activity-reports.browser.test.mjs` (55). In the browser,
  the trial function is answered by its real handler: who sees the card, one request with only the action, the link and its note,
  copying, a second link, nothing stored, sign-out, a different person, a refusal, a lost answer, the last report, a phone.
- `test/evaluation-entitlement-structure.test.mjs` 4 and 4-mint: the shared module now names `evaluation_invite_mint`, in one
  call, as an AGENT invite with the person as ACTOR.
- `test/trial_report_pg`, now 51 checks, through the real handler, data layer and shipped SQL:
  - the owner's link is one new OPEN AGENT invite of their own trial, hashed, and logged;
  - an agent joins through it and shares the trial;
  - an agent cannot invite: the database refuses, nothing is written;
  - with one agent seat, two links are made and the second agent is refused;
  - a revoked trial refuses in the handler, and the data layer's mint is refused by the database too;
  - a complete trial refuses.
- `test/development_activity_trial_invite_mutants.py`: 32 prohibited mutations, all killed (the 5c and 5d harnesses still kill all
  theirs).

**Still open, stated:**
- An owner cannot list, see again or withdraw the agent links they made, or remove an agent.
- The rate-limit gap from 5b is unchanged.
- How PostgREST turns the database's refusals into HTTP answers is still unchecked against production (now including
  `NOT_ENTITLED` from the mint).

`publisher_status` is the publisher's word, verbatim, and is never replaced by the lifecycle. `homesignal_observation` is
HomeSignal's own retrieval times, labelled as observations. `homesignal_detected_changes` exists only where the ledger proves a
change, and states `from` and `to` for each changed field.

**Step 6 (2026-10-03): saved reports.** A report is stored, once, with a permanent random id when it uses a free report (Order F's
`report_snapshot`, linked to its brokerage by the credit ledger, Order L1). What was missing was a way back to it.

- **Two read-only database functions** (`docs/saved-reports.sql`; no table, column, trigger or schedule):
  - `evaluation_reports_of(user)`: the caller's brokerage's stored reports, newest first: id, number, time, and the handle of the
    private context.
  - `evaluation_report_open(user, id)`: one stored report, by its id, only if it is in the ledger of the caller's own brokerage.
    The stored text, byte for byte.
  - Both are STABLE, SECURITY DEFINER, executable by the service role alone, and built on the one membership resolver
    (`brokerage_membership_of`). Neither names an address, client, email or coordinate.
  - An id from another brokerage, an unknown id, and a malformed id all give the same answer: not found.
- **The report function** (`get-development-activity-report`) takes two more requests, `{ action: "list" }` and
  `{ action: "open", report_id }`. Only a trial member may ask (an admin has no stored reports). Nothing else may travel with them.
  They reach neither the geocoder, the spatial read, the credit rule nor the issue function. An opened report says `charged: false`,
  `reopened: true`, and carries the stored report unchanged, not rebuilt or re-rendered.
- **The address** shown beside a saved report comes from the private layer's own reader, and only while that layer still keeps it.
  Once it has been purged, the report still opens and the list says "address no longer kept".
- **A trial whose 20 free reports are used** can still reopen its saved reports but can make no new one. The gate lets a complete trial
  through and says so (`complete`); the handler refuses it before it reads or geocodes anything, but only after the saved-report branch.
  A revoked or expired trial sees nothing.
- **The customer page** has a "Saved reports" card for a trial member, active or complete. It lists the reports (newest first, with
  number, address and date); clicking one shows it in the same report view and says opening it did not use a free report. Nothing about
  a saved report is kept in the browser. Signing out, a different person signing in, or the trial ending removes the list and any
  report shown. A report just made joins the list.

**Decisions taken by default (the founder may change any of them):**
- **D-6-1.** Reopening reads the stored text. It never recomputes, so a saved report never changes when sources or rules change.
- **D-6-2.** Every member of a brokerage sees all of its reports. The ledger records no user id by design (an open founder question
  about keeping an agent's identity in a permanent trail), so "whose report" is not known.
- **D-6-3.** A revoked or expired evaluation shows nothing; a complete one shows its reports.
- **D-6-4.** Sharing and printing are step 8, not here. They will need their own private, revocable link; this step adds none.

**Proof:**
- `test/saved-reports-function.test.mjs` (60): who may ask, the exact request, what is never called, the answer's exact fields, not
  found for a foreign or unknown id, the data layer's exact requests and every wrong shape, and a complete trial.
- `test/saved-reports-structure.test.mjs` (45): the SQL only reads and is system-only; one module reaches it; the action branch never
  reaches a charge; the gate and handler order; the page keeps nothing and forgets on sign-out.
- `test/development-activity-reports.browser.test.mjs` (73): the list, opening one, no free report used, a purged address, sign-out, a
  different person, no card without standing, a complete trial, a failed list, a phone.
- `test/trial_report_pg` (74) through the real handler, data layer and shipped SQL, including that the database itself returns nothing
  for another brokerage's or a revoked evaluation's reports.
- `test/development_activity_saved_reports_mutants.py`: 43 prohibited mutations, all killed (the 5c, 5d and 5e harnesses still kill all theirs).

**Still open, stated:** the free-report rate limit, an owner's list or withdrawal of agent links, and PostgREST's mapping of database
refusals to HTTP errors against production (all carried to step 13). Saved reports are listed, not searched or paged (at most 20 per
brokerage today).

**Step 7 (2026-10-03): the brokerage and agent header.** Every customer report now carries a header line, "<brokerage> · <agent>", and
an optional client label. The shared report view already printed these (`opts.brokerage`, `opts.agent`, `opts.label`, as text only);
what was missing was where they come from.

- **The brokerage name** is read from the account (`brokerage_account.name`), through the one membership resolver. **The agent's name**
  is the person's own, saved to their sign-in account (`user_metadata.full_name`). Both are read **when a report is shown** and written
  nowhere: not in the report text, not in the snapshot, not in the credit ledger. A rename therefore shows on every report from then on,
  including ones already saved (their stored text is unchanged; only the header line is read fresh).
- **One read-only database function** (`docs/report-header.sql`; no table, column, trigger or schedule): `report_header_of(user)` returns
  the brokerage's name and that person's name. STABLE, SECURITY DEFINER, executable by the service role alone. It returns nothing for
  someone who is not an active member of an active brokerage (a deactivated member or a suspended account gets no header).
- **One shared reader** (`_shared/evaluation-reads.ts::reportHeader`) calls it. Every name is cleaned in ONE place (`cleanDisplayName`):
  control, direction-changing and zero-width characters become spaces, runs of spaces collapse, and a name over its limit (agent 80,
  brokerage 120, client label 80) is **no name** rather than a shortened one (half a name reads as another). A refusal from the read,
  two rows, or a non-text name is `DataUnavailable`, never an empty header.
- **The report function** adds `header` to every report it returns (made, replayed, or reopened). For a new report the header is read
  after the address is geocoded and its ZIP is checked, and **before** the spatial read, the charge or the issue function, so a header
  that cannot be read costs nothing and shows no report.
  A reopened report also says `address` and `client_label` from the private layer.
- **The client label** is typed on the page and sent with the request. It is stored **only** for a report that is stored (one that uses a
  free report), **only in the deletable private layer** (`report_private_context.label`), beside the address, and purged with it.
  It is shown again on reopen while the layer keeps it. It is in no public table, no snapshot and no ledger. A report that is not
  stored ("No data ingested") is not kept at all, so its label is not kept either.
- **The customer page** has a "Your name on reports" card for a trial member (active or complete). Saving calls the sign-in account's
  own update. It is hidden and emptied on sign-out and when a different person signs in, and a save that is still on its way when the
  person changes writes nothing onto the next person's page.

**Decisions taken by default (the founder may change any of them):**
- **D-7-1.** The agent's name is self-declared (the person types it), kept in the sign-in account, and needs no schema change. HomeSignal
  does not verify it. The brokerage's name is the account's, set by HomeSignal.
- **D-7-2.** The header is never stored with a report. A report names whoever is viewing it now, so a saved report seen by a colleague
  shows the colleague's name and the brokerage's current name.
- **D-7-3.** The client label lives only in the private layer, with the address, and goes when the address goes. Nothing about a client
  is permanent.
- **D-7-4.** An over-long name is dropped, never cut. A name with markup is printed as text.

**Proof:**
- `test/national-report-function.test.mjs` (171) and `test/saved-reports-function.test.mjs` (62): the header on every report, read before
  anything is charged, every wrong shape of the read, the cleaning, the label's bound, and the opened report's fields.
- `test/report-header-structure.test.mjs` (30): the SQL only reads and is system-only; one module reaches it; nothing stores a name; the
  page keeps nothing in the browser and forgets on sign-out.
- `test/development-activity-reports.browser.test.mjs` (99): the card, saving, a refused save, an over-long name, a header that cannot
  be read, markup as text, who is offered the card, a different person signing in, a late save, a phone.
- `test/trial_report_pg` (94) through the real handler, data layer and shipped SQL: the label sits only in the private layer, no public
  table holds an agent name, the header is absent from the snapshot, a rename changes the header and not the stored body, and a
  deactivated member or suspended account gets none.
- `test/report_header_mutants.py`: 39 prohibited mutations, all killed. The step 6 harness (43), the 5c page harness (36), the 5d and 5e
  harnesses (32 each), the report view harness (153) and the account harness (88) all still kill every mutation.

**Still open, stated:** several older mutation harnesses have stale anchors that **predate this step** (confirmed on a clean checkout of
`main`): `national_report_mutants.py` (4 harness faults and 1 survivor, `lifecycle_promoted`), `follow_report_mutants.py` (6),
`evaluation_entitlement_mutants.py` (1), `single_customer_generation_path_mutants.py` (2) and `development_activity_review_mutants.py`
(1). They are carried to step 13 with the other open items; none of them guards step 7.

**Step 8 (2026-10-03): share and PDF.** An agent can send a client a private, read-only link to one saved report and take it back at any
time. A client opens it with no account. "Download PDF" is the browser's own print window.

- **Founder answers (2026-10-03):** a link lasts **6 months**; the client **sees the street address**.
- **The share link primitive already existed** (`docs/report-share.sql`, Order J1: an opaque token whose SHA-256 is all the database keeps,
  one function that decides whether a link is usable, revoke that cannot be undone). It had no owner, no caller and no default expiry.
  `docs/report-share-delivery.sql` gives it all three. It adds **no table, column, trigger or schedule**: four functions and two
  constants, executable by the service role alone.
  - `report_share_lifetime()` = 6 months, written once. The caller passes no expiry, and a lapsed link is replaced, never renewed.
  - `report_share_limit()` = 25 links per report, ever (live or not), counted under a lock keyed on the report. This bounds what a signed-in
    caller can write; it is not a product promise.
  - `evaluation_report_share_create` needs the SAME standing that lets a member reopen a saved report (an active trial, or a complete
    one). `evaluation_report_shares_of` and `evaluation_report_share_revoke` need only **ownership**, so a brokerage whose trial has ended
    can still see and withdraw the links it made. A report or link that is not the caller's brokerage's is "not found", the same as one
    that does not exist.
  - `report_share_open` returns the stored report, when it was made, the snapshot's opaque handle and the brokerage's name, and **zero rows
    unless the link is usable**. Unknown, withdrawn and expired links are indistinguishable: nothing tells anyone a link ever existed. It
    also returns nothing once the account is withdrawn (a revoked evaluation or an inactive brokerage); a trial that merely ended does not
    take back a report already shared.
- **Two edge functions.** `manage-shared-report` (signed-in; JWT stays on) makes, lists and withdraws links for the caller's own brokerage.
  It is deliberately NOT the report function's gate. `view-shared-report` is what the link opens, and is the second Development Activity
  function deployed **without JWT verification** (the client has no account; the token is the credential; `deploy-edge-functions.yml`
  and `supabase/config.toml` name exactly it). Its only input is the token in a POST body; its answer is the report, the brokerage's name,
  the address while the private layer keeps it, and nothing else. It writes nothing and charges nothing.
- **One module names the database functions, mints the token and writes the link** (`_shared/share-reads.ts`). The token is random, 256
  bits, hashed before the database sees it, and **returned once** inside the link. A lost link is withdrawn and replaced.
  **The token rides in the URL fragment** (`shared-report.html#share=<token>`), which a browser never sends to any server; the page reads it,
  removes it from the address bar, keeps it for that tab only, and sends it in a POST body with no referrer.
- **One reader of the private layer for display** (`_shared/private-subject.ts`), with two windows: the report function gets the address and
  the cleaned label (for the brokerage), the client's function gets the **address alone** and cannot return the label (the label can be an
  agent's own note). The report function's replay check keeps its own comparison read (it returns only match / mismatch / unknown).
- **The client's page** (`shared-report.html`) is noindex, disallowed in `robots.txt`, in no navigation or sitemap, linked from no page,
  sends no referrer and holds no sign-in. It draws the report with the same shared view the agent saw, with the agent's four actions
  (Compare, Watch, Share, PDF) hidden, and shows the brokerage's name and the address. It shows **no agent's name and no label**. Every link
  that opens nothing gets one message ("may have been withdrawn, or may have expired"); a failure says the link is fine and offers
  "Try again".
- **The agent's page** has a "Share this report with your client" card: make a link (shown once, with a Copy button), the report's links
  with their status (Working, Expired, Withdrawn) and a Withdraw button, and Download PDF. Nothing about a link is kept in the browser.
- **PDF is the browser's print window** ("Save as PDF"); no PDF is made on a server. Print stylesheets leave only the report on the paper.

**Decisions taken by default (the founder may change any of them):**
- **D-8-1.** A share records **no actor**. The credit ledger holds no user id by design (an open question about keeping an agent's identity in a
  permanent trail), so a link does not remember which agent made it, any member of the owning brokerage may list and withdraw it (the same
  default as saved reports, D-6-2), and the client's view names the brokerage and no person. "Prepared by <agent>" would need a creator
  column and that decision.
- **D-8-2.** Opening a link is **not recorded** (J1's audit log has two kinds of event and no text). There is no "viewed" indicator.
- **D-8-3.** A link works until it lapses or is withdrawn, even if the brokerage's trial later ends; it stops if HomeSignal withdraws the
  account.
- **D-8-4.** The client sees the street address only while the private layer keeps it. Once it is purged, the report still opens, without
  an address.

**Proof:**
- `test/report_share_delivery_pg` (43 checks, plus two real concurrent sessions racing for a report's last place, a create under
  REPEATABLE READ refused, a second apply, the rollback with shares stored, the refusal without the primitive) and `mutate.py`: 30
  prohibited mutations, all killed. CI: `report-snapshot-suite.yml`.
- `test/share-link-functions.test.mjs` (85): both handlers and data layers over a stand-in database: who may ask, the exact requests, one
  answer for every dead link, no label, nothing logged or echoed.
- `test/report-share-delivery-structure.test.mjs` (51): the SQL's shape, the one module, the JWT posture (exactly two functions unverified),
  the wiring. `test/shared-report-page.test.mjs` (36): the client's page.
- `test/shared-report-page.browser.test.mjs` (32) and `test/development-activity-reports.browser.test.mjs` (125) in Chromium, the client page
  against the REAL `view-shared-report` handler.
- `test/share_delivery_mutants.py`: 51 prohibited mutations of the edge, both pages and the wiring, all killed.

**Still open, stated:** the public endpoint is not rate-limited (a 256-bit token cannot be guessed, but a flood of requests is not stopped:
carried to step 13); an owner still cannot list or withdraw invite links or remove an agent; opens are not recorded; PostgREST's mapping of the
database's refusals to HTTP errors is unchecked against production; the signed-in paths are not exercised live.

## 5. Decisions taken by default (the founder may change any of them)

- **D-G1. Access is a signed-in user in `dashboard_admins`, as an internal diagnostic surface.** The plan permits exactly this
  for a path that "cannot function as an unlimited customer generator" before the account, entitlement and quota units exist.
  Orders H and L replace `isAdmin` with the entitlement check. Rate limiting, idempotency keys and token-replay protection
  (plan Step 9) need state and belong to those orders; they are **not** built here. The comparison is exact-match, the same as
  `public.hs_acquisition_metrics`.
- **D-G2. The rights registry ships empty, and an unlisted family is excluded.** Consequence, stated plainly: until a family is
  recorded as cleared, **every customer report is LIMITED COVERAGE with no records.** Clearing a family is one reviewed edit
  (registry_id, date, audit reference, attribution) plus the pin `national-report-structure.test.mjs` 6a, so the decision is
  visible twice. Nothing here decides which families are cleared.
- **D-G3. An `internal` view exists, admin-only.** It shows uncleared records, each labelled `HOLD`, marked
  `INTERNAL_VIEW` and `CONTAINS_UNCLEARED_SOURCE`, and can never be stored. It exists so the pipeline can be checked against
  real records while the registry is empty; it does not reinterpret a HOLD as cleared.
- **D-G4. "Recent" is 90 days** (the plan's own example), one constant. Recent official activity is a publisher event of kind
  filed, issued, decided, awarded, completed or hearing, inside `[today − 90, today]`. An operating record appears only when it
  carries such an event or a proven change (R3, open decision 2's default).
- **D-G5. "What Changed Recently" requires a change-ready record with a material reportable event inside the window.**
  Anything else that has a recent publisher event is Recent Official Activity, never labelled a detected change (plan Step 4).
- **D-G6. Type and lifecycle come from the authority through a generated copy.** No function imports from outside its own tree
  and the bundle needs the file, so the copy is produced mechanically and proven identical (structural 1a). `Decided` stays
  lifecycle `unknown` with the publisher status kept: that is the known mismatch (open decision 4), and it is not patched here.
  *(Superseded 2026-10-01 by the `Decided` fix: the authority now maps `Decided` to lifecycle `proposed`, the generated copy was
  regenerated, and the publisher status `Decided` is still kept verbatim beside it. National-report test 3b says so. **A deployed
  `get-development-activity-report` carries the copy it was deployed with**, so it read `Decided` as `unknown` until that function was
  redeployed from `main`. **Redeployed 2026-10-01 22:56Z (v3, run `36937982242`, source hash `77f3d344…`); receipt in the follow doc §9b.**)*
- **D-G7. Coverage is assessed on the records returned for the radius, and the report says so.** Step 10's per-ZIP
  source-applicability measurement is not built; this engine cannot see what a cleared source *should* have covered.
- **D-G8. A record with no source URL, or that is not a development record, is not in the report** (Regulatory is an overlay, R1).
- **D-G9. One copy of a project per ZIP page: the newest `last_seen_at`** (the order the N5 shadow read already uses).
- **D-G10. The default radius is 1 mile.** The allowed radii are the four the spatial read accepts.
- **D-G11. Nothing is stored by this endpoint.**

## 6. The five gates after this unit (`report-private-context-contract` §6)

| # | Gate | Was | Now |
|---|---|---|---|
| 1 | the exact address resides only in the deletable layer | enforced; not proven for a real engine | **proven for this engine**, on the real writer: `national_report_pg` stores its output and asks the database what it holds |
| 2 | the permanent snapshot holds no raw address elsewhere | backstop with named limits | **proven for whole values and fragments** on the real path; the fragment case shows the database accepting it and the engine's check catching it (`national_report_pg` 4c) |
| 3 | deleting private context does not damage history | proven | proven again on this engine's reports (`national_report_pg` 3a–3f) |
| 4 | Follow / Changes Since Report works while private context is active | half proven | *(at that time) still open — no Follow surface or reader existed.* **Since built and proven end to end on a disposable Postgres, with stand-ins stated in its doc** (2026-10-01): `docs/development-activity-follow-changes-2026-10-01.md`; deployed 2026-10-01 (refusals and capability verified live; no signed-in call yet) |
| 5 | retention clock and purge testable and auditable | proven; not armed | **still open** — the purge is not scheduled |

**Storing a real customer report stays switched off.** *(When this table was written, two gates were open: 4 and 5. Gate 5 has since been armed and gate 4 built; the open parts of gates 1, 2 and 5 are listed in the contract §6.)* This endpoint does not call the writer.

## 7. What this does NOT do (stated, not hidden)

- **No stored report, no `report_id`.** Order F's writer is untouched and uncalled.
- **No entitlement, quota, idempotency, rate limit or replay protection** (D-G1): Orders H, L, M.
- **No customer-facing content today.** The rights registry is empty (D-G2).
- **No "Things to Review With Your Client" section.** The plan lists it, but "investigation consideration" has no defined rules and
  none was invented. Order I designs the layout after the data contract is proven.
- **No source-applicability model** (D-G7) and **no per-source freshness SLA** (open decision 8).
- **No allow-list of record addresses** for a subject that is itself a project site (contract §8.3): such a report is marked not
  storable (fail closed), `national-report.test.mjs` 7g.
- **Geocoding depends on the Census one-line geocoder** through the existing `geocode-address`. The rights audit lists the
  geocoder's redistribution terms as not established; the address is used to find a point and is not redistributed, but this is
  the audit's item, not settled here.
- **Change intelligence is empty today** (`dev_change_event_reportable` = 0), so every report is Recent Official Activity until a
  recurring observation job exists (open decision 9). That job, the ledger writer question (option (b)), and the `Decided` fix
  are separate changes.
- **Performance on production is not yet measured** for dense 5-mile areas; the smoke test records it.

## 8. Proof

- `test/national-report.test.mjs` — **117** checks on the assembly: the rights gate, the window and its sentinels, Type and
  lifecycle equal to the source authority on 9 types × 10 statuses, change intelligence, coverage states, the split on six
  subjects, and the boundary check by name.
- `test/national-report-function.test.mjs` — **85** checks on the access model and the reads: no token, the anon key, a signed-in
  non-admin, a failing auth or allow-list service, validation after identity, size bounds, fail-closed reads (a refused radius is an
  error and never "nothing nearby"), the row cap, CORS, nothing logged, and the exact requests `data.ts` sends.
- `test/national-report-structure.test.mjs` — **64** pins *(59 when this endpoint deployed; re-pointed at the shared files and extended by the Follow change)*: one classifier, one geocoder, one spatial read, nothing stored, JWT
  pinned, the rights registry closed, the round trip wired to CI.
- `test/national_report_pg/` — **28** checks: the engine's real output through the real snapshot module and the real Postgres
  writer (run in `report-snapshot-suite.yml`, Postgres 17, no Supabase credential).
- `test/national_report_mutants.py` — **109** prohibited mutations *(107 when this endpoint deployed)*, each killed by a named suite. The first run left four
  survivors, and each was a real finding: an invalid date that sorted inside the window as text, a redundant sort, an untested
  default radius, and an inert mutation; a later run found a merge-gate pin that matched the wrong trigger. All fixed.
  (Manual, like the other module mutation loops: CI runs the tests, not the loop.)

## 9. Deployment and smoke

Not deployed when this file was written. The production receipt is recorded as §11 after the deploy and the smoke test, in its own
change, so this file never describes a state it did not measure. **§11 now exists; read it for what is live.**

## 10. Rollback

No database object changed. To remove the endpoint: delete the function (Supabase dashboard or `supabase functions delete
get-development-activity-report`). Nothing else depends on it.

## 11. Production receipt (2026-09-30) — deployed, gates smoked, the signed-in path NOT exercised

**Deployed.** `deploy-edge-functions.yml` run `36648751939` (dispatch from `main`, head `51e495b`, the #1483 merge) succeeded in
under a minute (job 00:07:46–00:08:26Z), every step green, including the unconditional post-deploy `registry_incomplete_entries` recompute (checked beforehand to be a
no-op: md5 `24d72bc484e5c34ab4691fef3d710949` on both sides, 10 rows, registry sha `d9dabc6b…`). Read back with
`list_edge_functions`: slug `get-development-activity-report`, **ACTIVE, version 1, `verify_jwt: true`**, entrypoint the repo path
`supabase/functions/get-development-activity-report/index.ts`. The 20 other functions in the listing all carry an update time
earlier than this function's creation, so the run changed none of them.

**What was exercised in production** (from Postgres through `pg_net`, since the sandbox has no egress; requests 6896–6899):

| probe | answer | what it shows |
|---|---|---|
| POST, no `Authorization` | **401** `UNAUTHORIZED_NO_AUTH_HEADER` | the gateway refuses an unsigned call |
| POST, `Bearer not-a-real-token` | **401** `UNAUTHORIZED_INVALID_JWT_FORMAT` | the gateway refuses a malformed token |
| POST, the public **anon key** as apikey and Bearer | **401** `{"error":"unauthorized"}`, `Cache-Control: no-store` | **the second gate works**: the anon key is validly signed and passes the gateway, and the handler's own answer (it has no signed-in user) is what stops it. This is the case the design exists for. |
| GET, anon key | **200**, `stores_reports: false`, `access: "signed-in internal user only …"`, `Cache-Control: no-store` | the capability answer, and the store switch reads OFF |

**Nothing was stored.** Read straight after: `report_snapshot` **0** rows, `report_private_context` **0** rows (controls in the same
query: `dashboard_admins` 1, `canonical_zip_registry` 12,722). The endpoint never calls the writer (pinned), and none of the four
probes got past authentication, so none reached a data read.

**What was NOT exercised, and must not be read as proven:** the signed-in, allow-listed path (geocode → registry → radius →
hydrate → ledger → events → health → compose). The sandbox holds no admin session token and none was minted or forged, so **no
end-to-end report has been generated in production.** What stands in for it is narrower, and each piece is a read of production:

- **Every column the function selects exists**: 38 of 38 (`app_projects` 16, `dev_change_project` 7,
  `dev_change_event_reportable` 9, `dev_change_source_health` 4, `dashboard_admins.email`, `canonical_zip_registry.zip`). A wrong
  column name would have turned every admin call into a 502; none is wrong.
- **The spatial read answers with the shape the function expects**: `n5_projects_within_radius(lat, lng, radius, limit)` returns
  `source_key, feature_id, registry_id, provenance, distance_mi, geometry_type, marker_lat, marker_lng, has_more`. New Orleans,
  1 mile: 100 rows, 100 distinct projects, nearest 0.111 mi, farthest 0.995 mi, `has_more` false (so the 100 is a real count and
  not a cap). Same point, 5 miles: 1,000 rows, `has_more` **true** — the truncation the report discloses as `AREA_TRUNCATED`.
  Brigham City, 1 mile: 10 rows.
- **The ledger has no events to report yet**: `dev_change_event_reportable` holds **0** rows, against `dev_change_project` 932,969
  and `dev_change_source_health` 237. So today no project can reach **What Changed Recently**; everything a report shows is
  **Recent Official Activity** from the publisher's own dates, and the change section is empty by construction until a second
  observation of the same records exists. That is Order D's recurring observation, which is a separate go.

**Database cost, measured in Postgres only** (the Census geocode and the network are not in these numbers): the 5-mile radius read
at New Orleans, 1,000 rows, **134 ms**; the 1-mile radius read joined to a 25-key hydrate from `app_projects` (an index-only scan,
256 rows) in one plan, **109 ms** in total, so the hydrate alone is less than that. A full 5-mile report reads up to 40 hydrate
chunks, four at a time; the total for a whole request was not measured.

**A limit found while measuring, not fixed here.** A project has one `app_projects` copy per ZIP page it appears on, so a 25-key
chunk returns more than 25 rows. Six dense centres at 5 miles (each 1,000 keys, sorted as the handler sorts them): worst chunk
**572 rows** (Chicago Loop), most copies of one key **38** (Miami), **0 chunks at or over the 1,000-row cap**. `data.ts` refuses a
response that reaches the cap, so a chunk that did reach it would fail the request as `data_unavailable` (502), never return a
short list. That is the safe direction, but the margin at Chicago is under a factor of two. The fix is to split a capped chunk and
retry rather than fail; it is a code change and is **logged, not taken**.

**Still true after deploy:**
- Nothing customer-facing exists: no page, no navigation, no caller. The only callers are a signed-in allow-listed user with a
  hand-built request.
- The rights registry is empty, so every customer-view report is LIMITED COVERAGE with no records; the internal view shows records
  labelled HOLD and reports `storable: false` with its blockers.
- Storing a real customer report stays off until the two open gates in the private-context contract §6 close: the Follow / Changes
  Since Report surface, and arming the purge (a new scheduled job, its own go).
  *(Dated annotation, 2026-10-01: the purge is armed and reading ok — contract §13 — and the Follow / Changes Since Report function is
  built, proven end to end and deployed (2026-10-01, no signed-in production call yet): `docs/development-activity-follow-changes-2026-10-01.md`. The text above is the state at deploy.)*

**Annotation, 2026-10-01 (the Follow change).** This function was refactored onto the shared modules named in §4, and its source-health read
now queries the new narrow view `dev_change_source_fetch_health` (applied to production, migration `20261001220554`; the follow doc §6b has
the measurement: 6.1–6.2 s on the wide view against PostgREST's 8 s timeout, about 0.1–0.2 s on the narrow one). **What is deployed is the
2026-09-30 version recorded above, which reads the wide view** *(superseded 2026-10-01 22:32Z: the refactored function is deployed as v2, reading the
narrow view; follow doc §9 has the run, the smoke and the one thing not exercised, a signed-in call)*. This section's receipt describes the
2026-09-30 code and is left as written.

**Rollback** is §10: delete the function. Nothing depends on it.
