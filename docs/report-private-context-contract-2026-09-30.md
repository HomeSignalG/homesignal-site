# Private context for stored reports — Order F2 (2026-09-30)

Founder decision of 2026-09-29 on the open Order F privacy question. SQL of record:
`docs/report-private-context.sql` (the deletable layer) and `docs/report-snapshot.sql` (the permanent layer, changed
by this unit). Engine-agnostic module: `supabase/functions/_shared/report-snapshot.ts`. Companion:
`docs/report-snapshot-contract-2026-09-30.md`.

> **Permanent intelligence survives. Customer-entered private context does not become permanent merely because it
> generated that intelligence.**

## 1. The decision, and where each part is enforced

| Founder decision | Enforced by | Proved by |
|---|---|---|
| A brokerage-entered street address is **not** permanent historical intelligence | the permanent table has no column that could hold it; the containment trigger refuses a snapshot whose body or engine inputs contain it | `report_snapshot_pg` T01, X01–X04; structural pins 6, 6b, 6d–6f |
| Do not store the raw address in `body`, in `inputs`, or in another permanent table | `inputs` and `property_key` are **removed** from the permanent table; nothing else in the repo names the private tables | `report_snapshot_pg` T01, upgrade stage; `report-private-context-structure` 5c |
| Separate, deletable private context; the snapshot references it by an internal id | `report_private_context` (+ needs + audit log); `report_snapshot.private_context_id`, a foreign key with **no cascade** | `report_snapshot_pg` I01–I03, T02, P03 |
| No client name, email, phone or other client identifier in the permanent snapshot (or anywhere here) | the private layer **refuses** any field outside six; the table has no such column | `report_private_context_pg` C03; `report_snapshot_pg` X08; structural 4, 4b |
| Keep while the report / Follow / account relationship needs it | a `need` row per reason; the context is kept while any is open | `report_private_context_pg` N01–N04; `report_snapshot_pg` P07 |
| After the last need ends: **no more than 90 days**, then purge | the clock starts when the last need closes; `purge_due_at <= last_needed_at + 90 days` is a CHECK; one definition of the number | `report_private_context_pg` E01, N01c, R02, R04; structural 1–1c |
| A verified privacy request or a legal requirement purges **earlier** and overrides the 90 days | `report_private_context_purge(context, 'verified_privacy_request' \| 'legal_requirement')` purges at once | `report_private_context_pg` P01–P05 |
| The 90 days is a recovery window, **not** a historical-intelligence retention period | it governs `report_private_context` only; the snapshot has no clock and no delete path | `report_snapshot_pg` P01–P06 |
| Deleting the private address must **not** delete the permanent record | purge is an UPDATE that blanks the values **in place**; nothing deletes a context row; the snapshot is untouched | `report_snapshot_pg` P01–P06 (row byte-identical, hash still verifies) |
| Do not weaken immutability to solve the privacy issue | the snapshot table is unchanged in this respect: update, delete, truncate still refused | `report_snapshot_pg` M01–M03, P05 |
| If exact rendering needs the raw address inside the body, change the boundary now | the body is address-free by construction; the exact rendering is **body + private context at render time** (§5) | module tests 3a–3g |

## 2. What was measured, before anything was changed

The legacy NYC report is the only report shape in the tree, so it is the evidence. Passed straight to Order F's
`issueSnapshot`, its body would have stored **permanently and immutably**, per report:

- the typed address (`buyer.address`) and the matched property: house number, street, address-point id
  (`property.addresspointid`, which resolves to exactly one address in public NYC data);
- the property's exact coordinates (`property.lat`, `property.lng`, 12 decimals);
- for every nearby record, `distance_mi`, `east_mi` and `north_mi` — **offsets measured from the property**.

The last item matters most, because it is easy to miss: the offsets are derived from the private point, and with the
record's own (public) coordinates they recover it. Measured on the shipped engine: **one record recovers the
property to within 0.73 m** (`report-snapshot.test.mjs` 2c; the offsets are rounded to 0.001 mile). So deleting the
address string would not have been enough — the location would have survived in the distances.

Order F's table also had two address-bearing columns of its own: `inputs` (the request as typed) and `property_key`
(for NYC, the address-point id). Both are gone.

## 3. The two layers

```
   PERMANENT (immutable, hashed, kept)                    PRIVATE (deletable, audited, 90-day clock)
   ───────────────────────────────────                    ──────────────────────────────────────────
   public.report_snapshot                                  public.report_private_context
     report_id            (database-minted uuid)             context_id, state (active | purged)
     content_hash         (sha256 of body, checked)          address, normalized_address
     report_version, generated_at                            latitude, longitude   (exact)
     engine_inputs        (radius, zip, versions …)          property_keys[]       (ids that resolve to one address)
     body                 (project facts, evidence …)        label                 (optional, customer's own)
     private_context_id ──────────────────────────────────►  last_needed_at, purge_due_at, purged_at, purge_reason
                          opaque reference, no cascade      public.report_private_context_need   (why it is still needed)
                                                            public.report_private_context_event  (append-only audit)
```

**Where a field goes** (NYC-shaped, as the worked example; the rule is the same for any engine):

| Field | Layer | Why |
|---|---|---|
| project records: source, dataset, case number, type, status, stage, dates, the record's own address / ZIP / coordinates, `record_url` | permanent | public development intelligence |
| attribution, exclusions, data state, coverage, versions, radius | permanent | how the report was made |
| `buyer.zip`, the ZIP and borough | permanent | a ZIP is the product's public geography, not a street address |
| `buyer.address` | **private** `address` | customer-entered |
| house number + street of the matched point | **private** `normalized_address` | resolves to one address |
| address-point id, parcel id, canonical property key | **private** `property_keys` | each resolves to one address |
| `property.lat`, `property.lng` | **private** `latitude`, `longitude` | exact property location |
| `distance_mi`, `east_mi`, `north_mi` per record | **derived, never stored**: computed at render time from the private point and the record's own coordinates | they recover the private point |
| a client name, email, phone | **nowhere**: the private layer refuses them | not needed, and not ours to keep |

## 4. The retention rule, as code

- **Needs.** `report_private_context_need` has one row per reason a context is still needed: `report`, `follow`,
  `account`, each with an opaque reference. The writer opens the `report` need in the same transaction that creates the
  context, referenced to the report_id it just minted. A property Follow or an account relationship registers its own.
- **The clock.** When the **last** open need closes, `purge_due_at = now() + 90 days` and `last_needed_at = now()`.
  Opening any need again inside the window clears the clock. A no-op close never restarts it.
- **The ceiling.** A CHECK refuses `purge_due_at > last_needed_at + 90 days`. The number is defined once,
  in `report_private_context_grace()`; every use goes through it.
- **Purge.** `report_private_context_purge(context, reason)`:
  `retention_expired` only when the clock has run out and nothing needs the context;
  `verified_privacy_request` and `legal_requirement` immediately, closing any open needs and overriding the clock.
  It NULLs address, normalized address, both coordinates, property keys and label, records `purged_at` and the reason,
  and writes the audit event. **It never deletes a row**: the tombstone (`context_id`, timestamps, state, reason) stays,
  so the snapshot's foreign key stays valid and "was this purged, when, and why" stays answerable. A purged context is
  terminal.
- **The batch.** `report_private_context_purge_due()` purges every context whose clock has run out. It was written and
  tested first and scheduled later, on its own go (2026-09-30): `docs/report-private-context-purge-schedule.sql` runs it
  every 15 minutes from pg_cron and watches it (§13).
- **Audit.** Every change is an append-only event: `created`, `need_opened`, `need_closed`, `grace_started`,
  `grace_cleared`, `purged`, with the need kind or purge reason and the time — and **never a private value** (the three
  text columns are restricted by CHECK to fixed vocabularies, so the log cannot hold an address even by mistake).
  `report_private_context_retention_check()` returns each invariant as a count that must be zero, beside a control
  count that must not be, plus one lag row (`clock_expired_but_not_yet_purged`).

## 5. What survives an address purge, and reopening a purged report

Untouched by a purge, because the purge writes only the three private tables: `report_id`, `content_hash`, the issue
time, the version, the engine inputs and the body — which carries every project identity, source reference, fact as of
the report date, Type and Stage, and the structured development facts. Canonical project IDs, observations, change
events and lineage are not referenced by the purge at all. (`report_snapshot_pg` P01–P06: the row is byte-identical,
the hash still verifies, the other customer's context is unaffected.)

A report reopened **after** its private context was purged shows the historical intelligence with the originating
address **unavailable / redacted**: `report_private_context_read` returns the state and reason and nothing else, and
subject-relative distances (never stored) cannot be shown. **The read path itself is Order J**; this unit fixes what
it may return.

## 6. The five gates before the first real customer report is stored

The founder's rule: *Order G may build the national report engine, but no production path may permanently write a
brokerage-entered exact address into the immutable snapshot.* Before enabling the first real stored customer report,
prove:

| # | Gate | Status | Evidence, and what is still open |
|---|---|---|---|
| 1 | the exact address resides only in the deletable layer | **Proven for the Order G engine on the real writer** (2026-09-30, `docs/development-activity-report-engine-2026-09-30.md` §6; `test/national_report_pg`); enforced at the schema, the writer, the trigger and the module | Enforced at the schema (no column), the writer (one hand-off), the trigger and the module. Proven with the legacy engine's real data split at the boundary (module tests 3a–3g). **Closed by Order G:** the engine emits the split (§8.1); its output is stored through the real writer and the database is asked what it holds. |
| 2 | the permanent snapshot does not contain the raw address elsewhere in its body / inputs | **Enforced as a backstop, with named limits; proven for whole values and fragments on the Order G engine's real output** (its own `boundaryFindings` runs before any store, §8.4) | The trigger scans body **and** engine inputs for the address, the normalized address, every property key, the label and full-precision coordinates (X02a–X02i), naming the field and never the value (X03), atomically (X04). **Limits, pinned not hidden:** §9. |
| 3 | deleting private context does not damage canonical project / report history | **Proven** | `report_snapshot_pg` P01–P06: after a privacy-request purge and after a retention purge the snapshot row is byte-identical, `content_hash` still verifies, the reference still resolves to the tombstone, another customer is untouched, and history is still immutable. |
| 4 | Follow / Changes Since Report continues to work while the private context is active | **Half proven; cannot be finished yet** | Proven: a Follow need keeps the address readable and stops the clock while the report itself is closed, and the snapshot never changes (P07). **Open:** the Follow surface and the Changes Since Report reader do not exist. By design that reader needs only the body (project identities) and `dev_change_event_reportable`, never the private context; that must be shown end to end when it is built. |
| 5 | the retention clock and purge behaviour are testable and auditable | **Proven, and live: the schedule and its alarm are applied (§13) and the first monitor tick read ok** | 52 checks and 51 mutations on the private layer (clock start, clear, restart, exact 90-day boundary, ceiling, every purge path, in-place blanking, terminal state, audit trail, retention check that can fail). §13 adds the pg_cron job and an alertable monitor check (41 checks, 23 mutations, 33 structural pins). **Receipt in §13** (the apply, the first scheduled runs, the first monitor tick). **Not yet seen in production:** the purge of a real due context (none exists; §12's rolled-back probe shows what it does). |

**Gate 4 and the open parts of gates 1, 2 and 5 keep "store a real customer report" switched off.** Nothing calls the
writer, so that is the current state; this document is the checklist for turning it on.

## 7. Decisions taken by default in this unit (the founder may change any of them)

- **D-1. Distances from the subject are private-derived, not permanent.** The founder listed exact property
  coordinates as private; distances recover them (§2), so they are not stored. Consequence: a reopened report shows
  distances only while the private context is active. If a coarse form (a band such as "within 0.25 mi") is wanted in
  the permanent record, that is a product decision about how much location a permanent report may reveal.
- **D-2. A ZIP stays permanent.** It is the product's public geography, not a street address. The list of nearby
  projects within a radius of the subject also stays: it is what the founder listed as the retained baseline
  ("project facts shown at the report date"), and it locates the subject only to within the radius.
- **D-3. The purge keeps a tombstone row.** It holds no address, no client and no owner. If counsel decides even the
  tombstone must be erased on a privacy request, the foreign key from the permanent snapshot prevents it while a
  snapshot references it; that would be a legal question to raise, not an engineering change to make quietly.
- **D-4. The `report` need stays open until Orders J and L close it.** The rule says "keep while the report … remains
  active". What makes a report inactive (a brokerage archives it; the account closes) is theirs to define. Until then a
  context is kept while its report is active — and nothing here closes it.
- **D-5. `label` is kept as the one optional free-text field,** private and scanned out of the permanent record.
- **D-6. Unknown private fields are refused, not ignored.**

## 8. What Order G's engine must do

1. Emit **intelligence** and **private context** as two separate objects and call `issueSnapshot(rpc, intelligence,
   privateContext, opts)`. Never build one object and split it afterwards.
2. Emit **no subject-relative measurement** (distance, east / north offsets, bearing) into the intelligence. Compute
   them at render time while the context is active. The module refuses the well-known key names; the database cannot
   see them at all.
3. **Declare which body strings are public-record addresses.** If a brokerage evaluates a property that is itself a
   permit site, the record's own address is legitimately in the body and the trigger will refuse it (fail closed). The
   writer needs an allow-list of record addresses before such a report can be stored.
4. **Test the boundary on the engine's own output:** assemble reports for subject addresses that are not project sites
   and assert the body contains none of the private values, **no fragment of the address** (house number with street
   name, the street line alone), and none of the subject-relative keys. The database backstop matches whole values only
   (§9).
5. Make Changes Since Report read the body and `dev_change_event_reportable` only.
6. Not store a real customer report until §6 is closed.

## 9. Limits (stated, not hidden)

- The containment trigger matches **values it was given**. It cannot catch a paraphrase, a value the engine did not
  put in the private context, or a number derived from the private point (§2) — `report_snapshot_pg` X07 pins that
  last one on purpose. The primary control is structural (two objects, one hand-off), not the scan.
- It matches **whole values**. A body that carries only a **fragment** of the address — the street line without the city
  and ZIP the context holds — is accepted (`report_snapshot_pg` X07b; found on the production probe, §12). Order G's
  engine must not emit any part of the subject address, and its boundary test (§8.4) has to look for fragments, not only
  whole values.
- Comparison ignores case, runs of whitespace, commas and periods; it does not expand "St" to "Street".
- A value shorter than three characters, and a coordinate with fewer than five decimals, are not scanned.
- A subject that is itself a public record's address is refused (fail closed), §8.3.
- The audit log proves what the functions did; it cannot prove that a backup or a log elsewhere holds no copy. This
  unit governs the database tables only. **Backups** are outside it and are a question for the privacy decision's
  operational follow-up.
- `service_role` reaches private values only through `report_private_context_read`; nothing calls it yet.

## 10. Proof inventory

- `test/report_private_context_pg` — 52 checks, applies twice with an identical definition, **51 prohibited mutations,
  all killed by a named check, none by a suite crash**.
- `test/report_snapshot_pg` — 66 checks; applies twice; **upgrades the exact Order F table that is live in production**
  (`f1_applied.sql`, md5 `545d7d94…`) to a shape identical to a fresh install, and **refuses, changing nothing, when a
  report is stored**; **54 prohibited mutations, all killed by a named check**.
- `test/report-snapshot.test.mjs` — 38 checks on the module against a stand-in database; `test/report_snapshot_module_mutants.py`
  — 23 mutations of the module, all killed.
- `test/report-snapshot-structure.test.mjs` (45 pins) and `test/report-private-context-structure.test.mjs` (42 pins);
  eleven mutations of the pins themselves each turned the right pin red.
- `.github/workflows/report-snapshot-suite.yml` runs both database harnesses on Postgres 17 and holds no Supabase credential.

## 11. Applying it

Order matters: **`docs/report-private-context.sql` first, then `docs/report-snapshot.sql`** (its foreign key points at
the first). The snapshot file fails closed unless `report_snapshot` is empty (it was, at 0 rows, when this was
written). Both are idempotent. Rollback of the snapshot file first, then the private file (footers of both).

## 12. Production receipt (2026-09-29 22:22–22:23Z, founder-directed schema change on an empty table)

Merged as #1480 (`023b4bf`). Applied with `apply_migration` from the committed files, in the order above.

| step | migration name | ledger version | stored text |
|---|---|---|---|
| 1 | `report_private_context_f2a_20260930` | `20260929222229` | md5 `4ff525069649fd2595e8cbdc8e38b39d`, 25,562 bytes — equal to `docs/report-private-context.sql` |
| 2 | `report_snapshot_f2b_20260930` | `20260929222315` | md5 `6c109fa158539e64f4c7015f251c8826`, 17,383 bytes — equal to `docs/report-snapshot.sql` |

**Before:** `report_snapshot` 0 rows, Order F shape (`inputs`, `property_key`, the five-argument writer), no private
objects. The upgrade refuses unless the table is empty, and it was.

**Read back after the apply (`execute_sql`, not the apply's own success message):**
- `report_snapshot` has exactly eight columns — `report_id, content_hash, report_version, generated_at, private_context_id,
  engine_inputs, body, body_bytes`. `inputs` and `property_key` are gone.
- The foreign key is `FOREIGN KEY (private_context_id) REFERENCES report_private_context(context_id)`, with no cascade.
- Row level security is on for all four tables. `anon`/`authenticated`/`public` hold **0** table grants and **0**
  function grants on any of them. `service_role` holds SELECT on the snapshot, need and event tables and **nothing** on
  the private table (`{postgres=arwdDxtm/postgres}`).
- All 15 `report_private_context_*` and `report_snapshot_*` functions are executable by `postgres` and `service_role`
  only. The eight that carry logic (seven in the private layer, plus the snapshot writer) are `SECURITY DEFINER` with
  `search_path=public, pg_temp`; the other seven are trigger and helper functions. One `report_snapshot_issue` exists,
  `(text,text,text,jsonb,jsonb)`; the Order F writer is gone.
- Triggers: three on `report_snapshot` (no update/delete, no truncate, containment), two each on the need and event
  tables, one on the private table (no delete or reopen — deliberately no truncate trigger, see the SQL comment).
- After everything below: 0 rows in all four tables, no pg_cron job mentions `report_private_context`, and the retention
  check reads `contexts_total=0` with all six invariants and the lag row at 0. The migration ledger went 618 → 620.

**Behaviour probe on production, rolled back** (a `DO` block that always raises at the end, so nothing is kept; the
synthetic address "1 Probe Test Lane, Nowhereville" is not a real property). Everything below happened inside it:

- Issue with a private context: a `report_id` and a `private_context_id` were returned, one `report` need opened whose
  reference is that `report_id`, the private values were readable through `report_private_context_read`, and the stored
  body and engine inputs held none of them.
- The boundary refused (SQLSTATE `23514`) an address in the body, the same address in different case and spacing, the
  **full** address in `engine_inputs`, a full-precision coordinate, a property key and the label. The message named the
  field and never the value. An unknown field (a client name) was refused by the private layer (`22023`). **The
  refusals left nothing behind:** 0 extra contexts, 0 extra snapshots.
- Retention: a purge while a need was open and a purge before the clock ran out were both refused (`55000`); closing the
  last need put `purge_due_at` exactly 90 days after `last_needed_at`; opening a Follow need cleared the clock and closing
  it started it again; the batch purged an expired context (`retention_expired` — the expiry was simulated by moving
  `purge_due_at` a minute into the past inside the rolled-back transaction, since 90 days cannot be waited out); a
  `verified_privacy_request` purge
  worked at once with a need still open; a second purge returned `false` and wrote no second event; a purged context
  could not be reopened (`55000`).
- After both purges, every private value was null, the read returned the state and nothing else, and **both stored
  snapshots were byte-identical** (row md5 before = after) with their foreign keys still resolving.
- Update or delete of a snapshot, delete of a context, update of a purged context, update of an event and delete of
  a need were each refused (`P0001`). The audit trail for the expired context read `created, need_opened:report,
  need_closed:report, grace_started, need_opened:follow, grace_cleared, need_closed:follow, grace_started,
  purged:retention_expired`.

**What the probe found, and what I got wrong doing it:**
- Its **first** complete run reported one case not refused: a `engine_inputs` value containing "1 probe test lane".
  That was my test input — it left out the city the private address holds, so it was a **fragment**, not the value. The
  database matches whole values (§9), so accepting it is consistent with the documented limit; but the limit did not say
  "fragment", and the suite did not pin it. Both are fixed here: §9 and §8.4 say it, and `report_snapshot_pg` X07b pins
  it (the suite is now 66 checks, 54 of 54 mutations still killed). I re-ran the probe with the full address in
  `engine_inputs` and it was refused (`23514`).
- The same first run also read `fk_still_resolves: false` and `open_needs_after_purge: 1`. Both were the leaked extra
  snapshot from that one non-refusal (3 snapshots against my assertion of 2; one open `report` need on its context), not
  a separate defect. The second run, with the input corrected, read `true` and `0`.
- Three probe runs happened, not one: the first aborted on a clash between one of my variable names and a column name
  before it reached any check; the second is the one that found the fragment; the third is clean. All three rolled back.
- Side effect that does not roll back: the identity sequence behind `report_private_context_event.event_id` advanced
  (sequences are not transactional), so the first real event will not be number 1. Nothing references those numbers.

**What CI found on the receipt PR (#1481), and the fix:** the `snapshot` check went red on the first run although both
suites read "0 failed" (52 and 66 checks). The mutation loop printed the first four failures of each killed mutation as
`grep | sed | cut | head -4` under `set -o pipefail`; when a mutation failed 34 checks, `head` exited while `cut` was still
writing, `cut` died with "Broken pipe" and the script ended. It is a race, which is why #1480's run passed: replayed
in isolation the old form exited non-zero on **80 of 1,500** runs and the form that reads to the end (`sed -n '1,4p'`)
on **0 of 1,500**. Fixed in both harnesses (`report_snapshot_pg/run.sh`, `report_private_context_pg/run.sh`); nothing
about what is checked changed (52 + 66 checks, 51 + 54 = 105 mutations, all killed, 0 survived). The same
`| head -4` line exists in other suites' harnesses that belong to other work; they are not touched here.

**Not done, on purpose** (each needs its own go; the first two were given 2026-09-30 and are §13): the purge batch is not
scheduled; the overdue-purge lag is not a pipeline-monitor check; nothing calls the writer; the owner column, and what closes a `report` need, belong to Orders J
and L; backups are outside this unit (§9).

## 13. Arming the purge, and watching it (2026-10-01 — built, applied, and reading ok; receipt at the end of this section)

Founder go 2026-09-30 for "arming the purge cron". SQL of record: `docs/report-private-context-purge-schedule.sql`. It adds
**no purge logic**: the batch, the per-context purge, the in-place blanking and the audit log are the F2 functions above.

**What it does.**
1. pg_cron job **`report-private-context-purge`** calls `report_private_context_purge_due()` at minutes **5, 20, 35 and 50**
   of every hour. **The one number it chooses is that cadence.** The founder's value is "no more than 90 days after the last
   need ends"; the clock is set to exactly 90 days (a CHECK), so the job's period is the only slack between "due" and
   "blanked": 15 minutes, not the 24 hours a daily job would add to a rule that says "no more than". Change it by editing
   the one constant in the file; the structural pin (`report-private-context-purge-structure.test.mjs` 1b, 3e) fails
   unless the longest gap stays 15 minutes and the monitor's grace stays at least four job periods.
2. A new alertable check **`report_private_context_retention`** on the one existing monitor (`pipeline_health_tick`,
   hourly at :10, then `notify-health`): it **fails** when the job is missing, inactive or no longer calls the batch; when
   any context is **more than 1 hour past its purge date** and still holds its values; or when any invariant of
   `report_private_context_retention_check()` is non-zero. The one-hour grace is four job periods; pg_cron is punctual (the
   monitor's own job measured 0 s late on 8 of 8 fires), so a context stuck that long means the job is not purging, not that
   it is late. It measures the **harm** (a private value held past its ceiling), so a job that runs and fails is caught
   exactly as one that does not run.
3. Both live in **one transaction** (a migration runs the file as one), and it refuses, changing nothing, when the private
   layer, the monitor, or the monitor's single splice anchor is missing, so the purge is never armed without its alarm.

**Decisions taken by default (the founder may change any):**
- **D-7. Cadence every 15 minutes** (above). A daily job would be cheaper and would add up to 24 hours to a founder rule.
- **D-8. The check is alertable from the first tick**, even with 0 contexts held: a missing or inactive job is a defect
  whether or not anything is waiting.
- **D-9. "Overdue" is the F2 audit's own predicate plus a grace**, in a new function `report_private_context_purge_health()`
  that returns **counts, one date and fixed words only** and names no private column. At grace 0 it equals the audit's lag
  row exactly (pinned: suite H05, structural 2c).
- **D-10. A check that cannot run is a failing check, not a dead monitor.** The spliced block catches its own failure and
  reports it as a failing row carrying the SQLSTATE only, so breaking or rolling back this one function can never stop the
  other checks from running.

**What it cannot prove, stated:**
- The suite runs against a stand-in for pg_cron (the CI and local images do not carry it). It reproduces the three calls
  the file makes and the unique `(jobname, username)` rule. Real pg_cron 1.6.4 behaviour is shown by the production
  read-back after the apply, not by the suite.
- A job that is scheduled and active but whose runs fail is caught **when a context becomes due**, not before; with nothing
  held, a failing job harms nothing.
- The batch scans the table each run. At 0 rows it costs nothing; if the table ever holds many thousands of rows, a partial
  index on `purge_due_at` is a one-line additive change to the F2 table and was deliberately not added now.
- The alarm lives in pg_cron and the monitor, never in GitHub Actions: one of the failures it watches for is "Actions will
  not run jobs". `report-private-context-purge-structure.test.mjs` 7 fails if any workflow, script or edge function calls
  the purge.

**Proof.** `test/report_private_context_purge_pg` (41 checks; the file applies twice with an identical result; the rollback
restores the monitor **byte for byte**, unschedules the job and drops the health function without touching a private
context; it is refused, arming nothing, without the private layer or without a splice anchor; **23 prohibited mutations, all
killed by a named check**), and `test/report-private-context-purge-structure.test.mjs` (33 pins; 13 of 13 distinct mutations of the SQL
turn the right pin red — a first run found that a comment stripper had swapped strings and code after a `--` inside a string
literal, so one pin passed vacuously; fixed with a scanner and a quote-parity control). One mutation was deliberately NOT
registered: removing the explicit `grant execute … to service_role` is an equivalent mutant while the platform's default
privileges grant it anyway (the fixture reproduces them), and a suite that "killed" it would be asserting the fixture.

**Applying it.** `apply_migration` from the committed file, **after** reading the live monitor's definition md5 and
confirming the anchor still appears once (other sessions splice the same function: Rule #0a). Rollback: the commented
footer of the file, which the harness extracts and runs.

**Production receipt (2026-10-01).** Merged as #1502 (`31ab384`). Applied **16:34:38Z** by `apply_migration`, migration name
`report_private_context_purge_schedule_f2_gate5_20261001`, ledger version `20261001163438`.

- **The stored migration text is the committed file, byte for byte:** md5 `d13f1d30b7f9caaca9c2b9f2bbdc5741`, 13,425 characters
  (13,580 bytes: the file carries multi-byte characters), the same value computed from the file in the repository.
- **The job (read 2026-10-01).** `jobid 70`, `report-private-context-purge`, schedule `5,20,35,50 * * * *`, **active**, calling
  `select public.report_private_context_purge_due()`. Its first run was **16:35:00Z**, 22 seconds after the apply. **4 runs
  recorded, 4 succeeded, newest 2026-10-01 17:20:00Z** (pg_cron's own run log).
- **The first monitor tick after the apply (17:10:00Z) read the new check ok:** `report_private_context_retention`, `ok = true`,
  `alertable = true`, `since 2026-10-01 17:10:00Z`, detail *"purge job active; 0 private context(s) held (0 ever created); none
  more than 1 hour past its purge date; no retention invariant broken"*. The monitor holds 20 rows and the check block appears
  **once** in the live function (the splice is idempotent and was not applied twice). The one failing row at that tick,
  `dc_resolvers` ("dc-resolve-geography slowest run in 24h took 236 s, past 200 s"), belongs to another session's check and has
  nothing to do with this one.
- **What this does not show, stated.** No private context exists yet (0 held, 0 ever created), so the **purge of a real due
  context has not happened in production**; the job runs and succeeds against an empty table, and §12's rolled-back probe is the
  evidence of what it does to a due one. The check's failure path (a missing or inactive job, an overdue context) is proven in the
  disposable suite, not by an incident. The next honest evidence is the first context that reaches its purge date.
