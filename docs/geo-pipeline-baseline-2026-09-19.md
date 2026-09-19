# Geography pipeline — PHASE 0 BASELINE (captured 2026-09-19 17:28:10Z)

Read-only capture taken before any mutation of the national geography pipeline.
Reproduce with `docs/geo-pipeline-baseline.sql`; fingerprints in `docs/geo-baseline/`.

**No production data was mutated to produce this file.**

---

## ⚠️ MATERIAL CORRECTION TO THE ACCEPTED BASELINE

The figures carried into the implementation brief (66,511 keys / 159,887 pairs /
177,522 rows / 3,339 ZIPs) were computed with **predA** — "no membership row at
`(p.zip, p.source_key)`".

Authoritative membership is assigned by **ZCTA boundary**, not by the ingest row's
`zip`. A project whose boundary lands in a neighbouring ZCTA is **correctly
represented there**. predA counts those as missing. They are not.

Measured: **17,820** eligible post-freeze source keys are already represented at a
different, boundary-correct ZCTA.

| measure | predA (accepted brief) | **predB (corrected)** | overcount |
|---|---:|---:|---:|
| source keys | 66,511 | **53,610** | −12,901 (19.4%) |
| (zip, source_key) pairs | 159,887 | **124,070** | −35,817 (22.4%) |
| underlying rows | 177,522 | **141,612** | −35,910 (20.2%) |
| affected ZIP pages | 3,339 | **3,152** | −187 |
| registries | 155 | **147** | −8 |

**predB is the backlog. All acceptance gates use predB.**

---

## 1. Headline counts

| metric | value |
|---|---:|
| `geo.n5_geom` rows | 1,209,747 |
| `geo.n5_geom` distinct source keys | 878,460 |
| `geo.zip_authoritative_membership` rows | 901,465 |
| `geo.zip_authoritative_marker` rows | 1,004,080 |
| ZIPs `boundary_complete` | 12,013 |
| ZIPs `not_measured` (`NO_ZCTA_IN_TIGER_2025`, out of scope) | 706 |
| canonical ZIP universe | 12,722 |
| `preservation.app_project_identity` @ `phase1-2026-09-01` | 3,172,292 |
| protected snapshots | 1 |

## 2. Backlog (predB)

| metric | value |
|---|---:|
| distinct source keys | **53,610** |
| underlying rows | 141,612 |
| (zip, source_key) pairs / cards | 124,070 |
| affected ZIP pages | 3,152 |
| registries | 147 |
| oldest unprocessed record | 2026-09-01 13:45:01Z |
| **oldest backlog age** | **18.17 days** |

## 3. Backlog by treatment — sizes Phases 8 / 9 / 10

| treatment | keys | rows | pairs | ZIPs | registries | phase |
|---|---:|---:|---:|---:|---:|---|
| PROVEN | 47,776 | 120,647 | 103,817 | 2,038 | 105 | 8 — DB-side, zero publisher I/O |
| RECOVERY | 5,559 | 17,962 | 17,250 | 1,409 | 41 | 9 — publisher acquisition |
| (UNCLASSIFIED) | 275 | 3,003 | 3,003 | 38 | 1 | 10 — classify first |
| **total** | **53,610** | **141,612** | **124,070** | **3,152** | **147** | |

47,776 + 5,559 + 275 = 53,610 exactly — the partition is disjoint and exhaustive.
The single unclassified registry is `baltimore-city-housing-permits`.
**Phase 10 must re-measure at execution time; 275 is a 2026-09-19 reading.**

## 4. National fingerprints

`docs/geo-baseline/membership-zip2-2026-09-19.txt` — 91 bands, rows sum **901,465** ✓
`docs/geo-baseline/marker-zip2-2026-09-19.txt` — 91 bands, rows sum **1,004,080** ✓

Both reconcile exactly to the table counts in §1. Format `zip2:rows:md5`, sorted
and aggregated under `collate "C"`.

## 5. Regression ZIP controls (11)

| zip | memb rows | membership md5 | marker rows | max seq | marker md5 |
|---|---:|---|---:|---:|---|
| **19475** (negative control) | 34 | `33b8cb185940b3f50b7ee2277f468a7a` | 40 | 3 | `c80f049b729dcb25aeca1e8e2dfebff6` |
| 20904 | 330 | `e9564a6a5a592a83654d8bb2f341324d` | 330 | 1 | `1cd38980d74e3041473e43dfb3901f1a` |
| 27560 | 293 | `0fa7b17be512bab0b9edadb390e61296` | 341 | 12 | `e101f92b9a08e90d1724b2101d26fb47` |
| 60607 | 172 | `b2e56f2b3c3f5afc1fcc7c912f8d78e9` | 172 | 1 | `74ba4d78aaccf598c9767eec327bf257` |
| 64105 | 51 | `1e84068d7e80243e5b6ab185f947fcbb` | 56 | 4 | `9f606c5844a0dda458c4b905bef15cc2` |
| 64153 | 179 | `b17ac963838557716525efc63ee0034c` | 247 | 11 | `079b182be49248703e6b8c27c6a5e2ee` |
| 64165 | 29 | `a3817e2abce0bcc59e2b5500b5d2f3fc` | 30 | 2 | `69a7ebc4b11a24870f472a0a4999ccc5` |
| 76140 | 919 | `df2748834d8f609ce12d2ebadcd41745` | 925 | 3 | `bfbce65adf54894b15c1fb4120b3fc54` |
| 85008 | 468 | `3eba9746dd5c93c3f481c2782b130ebf` | 474 | 7 | `4a66f4f592f59742e933334fccf4c807` |
| 85034 | 892 | `f770758c2bec237bff40f4a68d569815` | 898 | 4 | `9b1cd608a605677b2c7e479e6fadf58d` |
| 85212 | 400 | `1205520a6950b0b9819bf578df874171` | 409 | 10 | `e5c4fc8a54b528fa34fbc28d030c7136` |

## 6. KCMO 64165 control (`kcmo-development-cases`)

| cohort | rows | keys | in snapshot | in n5_geom | memb @64165 | marker @64165 |
|---|---:|---:|---:|---:|---:|---:|
| pre-freeze — **must stay intact** | 96 | 95 | 96 | 96 | **13** | **13** |
| post-freeze — **must progress** | 2 | 2 | 0 | 0 | **0** | **0** |

## 7. Preservation (must be byte-identical at every later phase)

`preservation.app_project_identity` — 1 snapshot, `phase1-2026-09-01`, 3,172,292 rows.
`preservation.protected_snapshot` — 1 row, `authorized_by = founder`.

---

## Operational findings recorded during capture (they shape later phases)

1. **The backlog cannot be computed by a national anti-join.** Every unbounded
   attempt exceeded the 60s statement budget. **Phase 6's health check must not be
   implemented as a national scan** — it needs the watermark/ledger form, or a
   banded/incremental computation.
2. **`geo.zip_authoritative_membership` has no index on `source_key` alone** (PK is
   `(zcta5, source_key)`), so "is this key represented anywhere" — the correct
   representation test — has no supporting index. Phase 5 needs this considered.
3. **`s.zip::text = p.zip` defeats the status table's primary key.** Use
   `s.zip = p.zip::bpchar`. This alone turned sub-second queries into timeouts.
4. `geo.n5_frozen` is a per-shard scratch table, currently 0 rows — it is not a
   persistent input and must not be treated as one.

---

## 8. Read-path function pins (added Phase 1, 2026-09-19)

Live function body md5 (`md5(pg_get_functiondef(oid))`). Phase 1 changed no function;
these are the pre-mutation pins every later phase must re-verify.

| function | body md5 | anon EXECUTE | descriptive-row rule |
|---|---|---|---|
| `public.app_zip_projects_markers` | `4037cc5b35113c22869d3cc91fa6e1de` | true | **min(id)** |
| `public.app_authoritative_projects_for_zip` | `a162cf212082eaf9b114d51f55d1ff66` | true | **min(id)** |
| `public.app_projects_for_zip` | `eec5777aac02228350dd437d4e37ccba` | true | routes to the above |
| `geo.n5_shadow_projects_for_zip` | `bfe60ff5b8cb940b5e4f2de18b606a98` | **false** | last_seen_at desc (shadow only) |

Canonical rule: `docs/geo-descriptive-row-contract.md`.
