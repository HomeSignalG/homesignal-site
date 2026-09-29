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
- **The batch.** `report_private_context_purge_due()` purges every context whose clock has run out. **It is written and
  tested and is not scheduled** (a scheduled job waits for its own go).
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
| 1 | the exact address resides only in the deletable layer | **Enforced; not yet proven for a real engine** | Enforced at the schema (no column), the writer (one hand-off), the trigger and the module. Proven with the legacy engine's real data split at the boundary (module tests 3a–3g). **Open:** Order G's engine does not exist; it must produce the split (§8). |
| 2 | the permanent snapshot does not contain the raw address elsewhere in its body / inputs | **Enforced as a backstop, with named limits** | The trigger scans body **and** engine inputs for the address, the normalized address, every property key, the label and full-precision coordinates (X02a–X02i), naming the field and never the value (X03), atomically (X04). **Limits, pinned not hidden:** §9. |
| 3 | deleting private context does not damage canonical project / report history | **Proven** | `report_snapshot_pg` P01–P06: after a privacy-request purge and after a retention purge the snapshot row is byte-identical, `content_hash` still verifies, the reference still resolves to the tombstone, another customer is untouched, and history is still immutable. |
| 4 | Follow / Changes Since Report continues to work while the private context is active | **Half proven; cannot be finished yet** | Proven: a Follow need keeps the address readable and stops the clock while the report itself is closed, and the snapshot never changes (P07). **Open:** the Follow surface and the Changes Since Report reader do not exist. By design that reader needs only the body (project identities) and `dev_change_event_reportable`, never the private context; that must be shown end to end when it is built. |
| 5 | the retention clock and purge behaviour are testable and auditable | **Proven; not armed** | 52 checks and 51 mutations on the private layer (clock start, clear, restart, exact 90-day boundary, ceiling, every purge path, in-place blanking, terminal state, audit trail, retention check that can fail). **Open:** the purge batch is not scheduled, and the overdue-purge lag row is not yet an alertable check in the pipeline monitor. |

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
   and assert the body contains none of the private values and none of the subject-relative keys.
5. Make Changes Since Report read the body and `dev_change_event_reportable` only.
6. Not store a real customer report until §6 is closed.

## 9. Limits (stated, not hidden)

- The containment trigger matches **values it was given**. It cannot catch a paraphrase, a value the engine did not
  put in the private context, or a number derived from the private point (§2) — `report_snapshot_pg` X07 pins that
  last one on purpose. The primary control is structural (two objects, one hand-off), not the scan.
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
- `test/report_snapshot_pg` — 65 checks; applies twice; **upgrades the exact Order F table that is live in production**
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
