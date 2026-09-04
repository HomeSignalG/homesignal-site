# N5 national batches 05-07 — production geography 935 -> 2,375 verified ZIPs

Three full cycles run back to back under the standing execution authorization:
ACQUIRE -> BOUNDARY -> MEMBERSHIP -> MARKERS -> SHADOW -> CUTOVER -> VERIFY.

| batch | shards done | prefixes | cutover enabled | held | verified after |
|---|---|---|---:|---:|---:|
| 05 | 121 | 40 | 368 | 3 | 1,303 |
| 06 | 161 | 40 | 410 | 0 | 1,713 |
| 07 | 201 | 40 | 662 | 10 | 2,375 |

Every batch: `not_measured` re-derived under the guarded rule with the pre-existing set
fingerprinted before and after, and closure held exactly at each step —
**2,466 = 2,389 boundary_complete + 77 not_measured + 0 unclassified** after batch 07,
0 non-canonical status rows, 0 points unresolved.

## The producer refused 14 ZIPs across the three batches, all ONE cause

`85641, 97106, 97116` (batch 05) and `03451, 05301, 05343, 05345, 05363, 43532, 76527,
85931, 97401, 97408` (batch 07), plus `05843` from batch 04 — **14 held in total.**

The class was verified rather than assumed. Across all 10 batch-07 refusals:

```
refused                                    10
invariant "N projects for M memberships"   10   <- all the same failure shape
refused WITHOUT a drift explanation         0   <- every one explained
missing source_keys NOT in the freeze       0   <- removal, never fabrication
```

Every refusal is a membership naming a `source_key` that is present in the
`phase1-2026-09-01` freeze but absent from live `public.app_projects` — an ingest refresh
removed rows the frozen basis still carries. **The invariant was never weakened and no
membership row was deleted**; the geometry facts are correct, the gap is on the live side.
Each held ZIP carries its cause on its cutover row, surfaces as a `blocker` in
`geo.maps_zip_export`, and was proven to still serve its original legacy output
**byte-identical** (dev and facility md5 both match the pre-staging baseline).

## Cutover receipts

| batch | dev legacy -> authoritative | dev = producer | facilities changed | measured-zero rendering |
|---|---|---:|---:|---:|
| 05 | 726 -> 363 | 368 of 368 | 0 | 234 |
| 06 | 1,208 -> 546 | 410 of 410 | 0 | 232 |
| 07 | 2,108 -> 1,122 | 662 of 662 | 0 | 297 |

Staging was proven inert every time (0 development and 0 facility changes while the rows
existed with `enabled=false`), so the switch remains the only thing that moves production.

## Whole-population reconciliation at 2,375 enabled ZIPs — exact and bidirectional

```
production projects  8,633  =  membership rows  8,633
production markers  24,568  =  marker rows     24,568
0 no source_key · 0 project without marker · 0 duplicate source_key
0 missing in production     · 0 missing in relation
24,568 markers compared: 0 not in relation, 0 coordinate differences
```

Marker relation quality: 0 membership without a marker · 0 orphans · 0 missing coordinates
· 0 duplicate markers · 0 duplicate memberships.

⚠️ **The reconciliation outgrew the 60 s statement budget and the UPDATE that followed it
rolled back atomically** — 662 ZIPs stayed unverified rather than being half-marked, which
is the transaction doing its job. Re-run by materializing production output once into
`geo.n5_recon_flat` in 800-ZIP chunks, then running every check against that table. The
verification is unchanged; only its shape is. **Do not go back to the inline form** — it
will time out again as the population grows, and a timed-out verification is
indistinguishable from one that never ran.

## Latency (EXPLAIN ANALYZE, the method that held)

| enabled ZIPs | total ms | mean ms |
|---:|---:|---:|
| 744 | 12,283.9 | 16.5 |
| 935 | 14,547.1 | 15.6 |
| 1,303 | 21,083.7 | 16.2 |

Flat as the population tripled; the proven gate holds.

## Storage

Free disk moved 2,172 -> 3,115 MB across the three batches, never approaching the 2,048
floor. The dips are WAL oscillation, not persistent growth: during batch 04's boundary pass
free fell 3,059 -> 2,189 MB while the database itself grew ~8 MB and WAL went 1,104 ->
1,968 MB. Every batch boundary was measured before proceeding.
