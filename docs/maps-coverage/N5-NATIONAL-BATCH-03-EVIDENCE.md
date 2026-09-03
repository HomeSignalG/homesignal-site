# N5 national batch 03 — 23 prefixes through acquisition, boundary, shadow and markers

Continuation of the national Development-geography execution unit. Batch 02 acquired 23
prefixes and then died on a gateway throttle; this batch carried those 23 through the rest
of the pipeline, fixed the throttle cause, and closed two classification gaps.

## 1. The batch-02 failure was the INSTRUMENT, not the data

`n3_pilot.sql()` turned every `HTTPError` into `SystemExit`, so one `HTTP 429
ThrottlerException` from the Supabase Management API killed a batch that was otherwise
correct at 23 of 40 prefixes. Shard 354 was reset `running -> pending` and its
`geo.n5_frozen` slice cleared; no data was wrong, only lost work.

Fixed narrowly, and the narrowness is the point:

| status | behaviour | why |
|---|---|---|
| 429 | retry, bounded 6 attempts, 2/5/15/30/60 s, `Retry-After` honoured | refused AT the gateway — the statement never reached Postgres, so re-sending is safe even for a write |
| 5xx | **no retry** | a 5xx can mean the statement RAN and the response was lost; re-sending a non-idempotent write would apply it twice |
| everything else | **no retry** | a real SQL/auth error must never be masked by a retry loop |

Every retry prints, so a batch that spent 40 s in backoff is never indistinguishable from
one that did not. `scripts/test_sql_retry.py` proves it load-bearing in BOTH directions
offline (12 assertions, `urlopen` replaced, no network) and is wired as an
**unconditional** preflight step in `phase2-b1-zcta.yml` — sql() guards every mode in that
workflow, so the instrument that decides whether a batch survives a throttle is itself
checked on every dispatch rather than trusted.

## 2. A latent production hazard found and closed before it fired

Both `n5_unit_a_shadow.populate()` and `n5_a3_markers` build mode are delete-then-insert
**per prefix**, and both iterated EVERY completed prefix. So each batch re-deleted
membership and markers under ZIPs that are already `production_geography_verified`, and for
the width of that rebuild those ZIPs carry zero rows.

That is not cosmetic. `public.app_authoritative_projects_for_zip` raises on
"marker count != relation count" and deliberately never falls back to legacy — the
fail-closed contract — so a live page whose prefix was mid-rebuild would ERROR rather than
degrade. Nothing caught it before because the rules are deterministic and the rebuilt rows
come back identical: **the hazard is the window, not the result.**

`PREFIXES` now restricts both. Unset, behaviour is exactly as before. A named prefix that
is not eligible is a HARD ERROR, never a silent skip — a restriction that selects nothing
looks exactly like one that worked. This batch's marker build named only the 21 prefixes
with membership and none already serving.

## 3. Boundary placement — 23 prefixes, 508 s, guard CLEAN throughout

`n5-boundary-first` run 33808271040, "prefixes completed 23". 21 produced boundary rows;
**2 produced none, and they are two DIFFERENT zeros** — the distinction decides whether
they may be cut over:

| prefix | ZCTAs in TIGER | boundaries loaded | bbox candidates | exact true | verdict |
|---|---:|---:|---:|---:|---|
| **118** (Hicksville NY) | 3 | 3 (704 vertices) | 2 | 0 | **measured zero** — the spatial test ran and rejected |
| **055** (Andover MA IRS) | **0** | 0 | 0 | 0 | **not measured** — nothing was ever tested |

`05501`/`05544` are the Andover IRS ZIPs this repo already documents in the Massachusetts
build: USPS unique ZIPs serving an IRS facility, with no populated census blocks, so TIGER
has no ZCTA for them. Treating that as a measured zero would assert an answer from an
absence of measurement.

## 4. Shadow build and markers

`n5-unit-a` run 33809272853 over the 22 processed prefixes: membership **6,344 -> 6,516**
(+172), `boundary_complete` **451 -> 744**, **0 points unresolved**. 118's three ZIPs landed
as `boundary_complete` with `membership_rows = 0`, which is the correct honest-empty state.

## 5. The `not_measured` rule is now DERIVED, and validated against its own history

`not_measured` rows had been written by an ad-hoc step, not by the driver, so every batch
silently left ZIPs unclassified. The rule was recovered and **validated by reproduction
before being applied to anything**: "a canonical ZIP in a done-shard prefix that boundary
placement loaded no TIGER ZCTA for".

Run over the prefixes the existing 64 came from, it reproduces them **exactly** — not just
the same count but the same set:

```
existing 64 | rule produces 64 | extra 0 | missing 0
md5 existing 994fe2e3f49e4be95367af6c5af9a9df
md5 rule     994fe2e3f49e4be95367af6c5af9a9df      (order pinned, collate "C")
```

Applied, it classified **12** newly-processed ZIPs, all `NO_ZCTA_IN_TIGER_2025`:
`05501, 05544` (Andover IRS) · `10260, 10265, 10270, 10281` (Manhattan unique/PO) ·
`48501, 48531` (Flint PO) · `48805, 48826, 48844, 48863` (Lansing area).

The write was guarded: the pre-existing 64 were fingerprinted before and re-fingerprinted
after excluding the new `run_id`, and a difference would have raised. It did not.
`not_measured` 64 -> 76, and the founder's "do not change the 62/64" constraint holds by
proof rather than by assertion.

**Closure over every done shard, exact:**

```
canonical ZIPs in done prefixes   820
  boundary_complete               744
  not_measured                     76
  unclassified                      0
non-canonical status rows           0
```

## 6. 445 canonical ZIP pages need no acquisition at all — measured, with two controls

40 canonical ZIP prefixes have **no shard in the 544-shard universe**, covering **445
canonical ZIP pages**. A shard exists only where the frozen snapshot carries pairs, so the
question is whether those 445 are a gap or a measured zero. Measured:

```
shard-less canonical ZIPs                                   445
  development rows in preservation.app_project_identity       0
  rows of ANY record_kind for those same ZIPs             4,243   <- control: the join works
  control, prefix 352 (has a shard), development rows         68   <- control: the filter is not always 0
```

Both controls are non-zero, so the zero is real rather than a wrong-filter artifact. Those
445 pages carry **zero development projects by measurement**. They are reported, not
reclassified — changing their status changes cutover eligibility for 445 resident pages and
that is the founder's call, not a side effect of a batch.

## 7. Storage

Free disk **2,304 -> 2,530 MB** across the whole batch — it went UP, because WAL recycled
(2,016 -> 1,856 MB) faster than the batch consumed. The 2,048 MB floor was never approached.

⚠️ One honest caveat on every free-disk figure in this series: it is computed as
`11,607 MB - (database + WAL)`, and 11,607 is a CONSTANT in the driver, not a reading of
provisioned capacity. If provisioning was raised operationally, true headroom is larger than
these numbers; if it was not, the floor gate stops the build rather than the build breaking.
Either way the gate behaves correctly, but the number should not be quoted as measured
capacity.

## Runs of record

| run | mode | result |
|---|---|---|
| 33808271040 | n5-boundary-first, 23 prefixes | success, 508 s, 23 completed |
| 33809272853 | n5-unit-a, 22 prefixes | success |
| 33809480908 | n5-a3-marker build, 21 prefixes | success, markers 13,720 -> 13,895 |

## 8. Cutover group 3 — production geography 420 -> 744 verified ZIPs

Markers after the build: **13,895** (+175), membership **6,516**, and the four quality
counts all zero — 0 membership without a marker, 0 marker orphans, 0 markers missing
coordinates, 0 duplicate `(zip, source_key, marker_seq)`.

**324 ZIPs became eligible** (238 measured-zero + 86 carrying 172 memberships / 175
markers, 0 status-vs-membership mismatches). The proven sequence was followed exactly:

1. **Baseline captured first** so the change is measured, not described.
   ⚠️ **The first capture was WRONG and is discarded, not amended.** It used
   `count(*) from public.app_projects_for_zip(...)`, but that function returns a **scalar
   jsonb array**, not a set — so the count was always 1 and it reported
   `324 / 324 / 324`, identical for ZIP count, development rows and facility rows. Three
   equal numbers is the shape of an instrument fault, not of data. Re-measured with
   `jsonb_array_length`: **legacy development 1,658 rows · facilities 4,393 · 94 ZIPs
   already legacy-zero · max 75 development / 40 facility on a single ZIP.**
2. **Staged disabled, and proven inert** — with the 324 rows present but `enabled=false`,
   development and facility output were byte-identical to the baseline on all 324
   (0 changed / 0 changed). The switch is genuinely the gate; nothing is inferred from the
   presence of authoritative data.
3. **All 324 exercised through the producer before enabling.** It raises on any invariant
   breach, so the statement completing is the test: 172 authoritative rows, 238 measured
   zero, 86 with projects, 0 non-array.
4. **Enabled**, then verified:

```
development now equals the authoritative producer   324 of 324   (0 differences)
development rows      legacy 1,658  ->  authoritative 172
FACILITIES CHANGED                                  0            <- byte-identical
ZIPs rendering a measured zero                      238
```

The 1,486-row drop is the authoritative model rejecting legacy over-inclusion, which is
the same direction every prefix's boundary log reported independently.

**Full bidirectional reconciliation over all 744 enabled ZIPs — exact:**

```
production projects 6,516  =  membership rows 6,516
production markers 13,895  =  marker rows    13,895
0 project without source_key · 0 project without marker · 0 duplicate source_key
0 missing in production      · 0 missing in relation
13,895 markers compared: 0 not in relation, 0 coordinate differences
```

**Latency.** ⚠️ A `clock_timestamp()` lateral returned 0.0 ms for every percentile — the
same invalid-attribution fault this series hit once before — so it is discarded rather than
reported. Measured with `EXPLAIN ANALYZE`, which is the method that held: **12,283.9 ms for
all 744 calls = 16.5 ms mean**, against 15.1 ms p50 before the batch, so tripling the ZIP
count did not move it. Worst case measured individually: **10280 (131 memberships) at
39.1 ms**.

**Rollback** is unchanged and one statement:
`update public.app_zip_geography_cutover set enabled = false;` — it destroys no
authoritative data, and this batch's rows carry `set_fingerprint = 'cutover3-2026-09-03'`
so they can be reverted alone.
