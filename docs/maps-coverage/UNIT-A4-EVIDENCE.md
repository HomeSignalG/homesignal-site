# Unit A4 — delivery prerequisites: index + project/marker contract

Measured 2026-09-03. Authoritative production cutover remains OFF. No ZIP receives
authoritative results as a consequence of A4 shipping.

## 1. Pre-state, and the shard terminology corrected

| item | value |
|---|---|
| `public.app_projects_for_zip` md5 | `ec1b01ae4485ad2c59b9f946c9d565b6` |
| `app_projects` indexes (before) | 4 · set md5 `cb54ea1146439b94a0b329c42629255b` |
| `app_projects` rows / heap / indexes / total | 3,211,106 · 2,870 MB · 1,394 MB · 4,264 MB |
| free disk | 3,416.1 MB |
| membership / status fingerprints | 5,845 `ff09ed6d…` · 428 `3f452ffa…` |
| marker count / md5 | 13,221 · `e3a0efeb826befc77a4ec57762cf4a1f` |
| `n5_association` · `n5_boundary_membership` · `n5_geom` | 20,170 · 18,184 · 741,562 |

**Shard terminology — my A3 receipt was misleading and is corrected here.** "shards 544"
was a ROW COUNT of `geo.n5_shard` used as a preservation control; it is not evidence that
544 shards completed. Measured on `state`:

| | prefixes | projects | pairs | ZIPs |
|---|---:|---:|---:|---:|
| **total prefix universe** | **544** | 1,031,787 | 2,753,802 | 10,467 |
| **completed acquisition** | **13** | 10,077 | 19,913 | 408 |
| **pending acquisition** | **531** | 1,021,710 | 2,733,889 | 10,059 |

## 2. The index

```sql
create index concurrently if not exists app_projects_source_key_kind_idx
  on public.app_projects using btree (source_key, record_kind);
```

Preconditions checked, not assumed: 4 existing indexes — `(id)`, `(zip)`,
`(zip, record_kind, submitted_at DESC NULLS LAST, id)`, `(zip, source_key, source_seq)` —
and **none leads on `source_key`**. Projected free after a conservative 455 MB estimate:
2,961.1 MB, above the 2,048 MB hard floor.

| receipt | value |
|---|---|
| build method | `CREATE INDEX CONCURRENTLY` (no write lock on a live table) |
| build duration | **87.0 s** |
| `indisvalid` / `indisready` | **true / true** |
| actual size | **103 MB** (actual disk cost 103.3 MB) |
| free disk before → after | 3,416.1 → **3,312.8 MB** |
| planner uses it | **YES** |

⚠️ **Prediction refuted: I estimated ~455 MB and it is 103 MB.** My "empirical anchor" was
the 431 MB `(zip, source_key, source_seq)` index, reasoned from payload width (54 vs 57
bytes). That reasoning was wrong: the comparable is effectively unique per row, while
`(source_key, record_kind)` is heavily duplicated, so btree **deduplication** collapses
duplicate keys into posting lists. Width was the wrong variable; duplication was the
relevant one.

## 3. Post-index benchmark — exact A3 population and methodology

All 346, server-side timing, `geo.n5_a3_bench`, project counts required to equal 5,842.

| | A3 p1 (cold) | A3 p2 (warm) | **A4 p3 (cold)** | **A4 p4 (warm)** |
|---|---:|---:|---:|---:|
| p50 | 2,662.1 ms | 2,530.4 ms | **33.8 ms** | **8.1 ms** |
| p95 | 13,425.4 ms | 13,002.5 ms | **291.7 ms** | **44.4 ms** |
| p99 | 18,541.2 ms | 17,646.1 ms | **1,005.1 ms** | **61.8 ms** |
| max | 21,735.2 ms | 21,969.9 ms | **1,697.3 ms** | **70.4 ms** |
| total | 1,519.7 s | 1,453.8 s | **29.6 s** | **5.3 s** |
| timeouts | 0 | 0 | **0** | **0** |
| rows (project / marker) | 5,842 / 13,218 | 5,842 / 13,218 | **5,842 / 13,218** | **5,842 / 13,218** |

Warm-to-warm: **p50 312x, p95 293x, p99 286x, max 312x, total 274x faster.** Measured, not
inferred from EXPLAIN.

## 4-7. The response contract

`public.app_zip_projects_markers(p_zip text, p_kind text default 'development',
p_authoritative boolean default false)` → `{mode, zip, status, projects[], markers[]}`.
DDL of record: `docs/n5-unit-a4-delivery-contract.sql`.

- **Projects** — one card per `(ZIP, source_key)` in authoritative mode, carrying `to_jsonb(p)`
  so every field production renders today survives verbatim (`source_key`, `name`, `type`,
  `status`, `stage`, `submitted_at`, `address`, `developer`, `scope_text`, `source_ref`,
  `registry_id`, …). Descriptive row chosen by A3's rule: **lowest stable `id`**.
  `last_seen_at` is not a selector; `source_seq` is never geographic identity.
- **Markers** — `{project_ref, marker_seq, lat, lng, marker_rule}` only. The project is not
  copied into the marker.
- **Association** — `marker.project_ref = project.project_ref`. In authoritative mode that is
  `source_key`; in legacy mode `source_key#source_seq`, because legacy `source_key` is not
  unique within a ZIP.
- **Authoritative project coordinates are overwritten with the authoritative representative
  point**, so no legacy coordinate can reach the map through a card.
- **Absence is never an authoritative zero**: a ZIP that is not `boundary_complete` returns
  `projects: null, markers: null` plus its real status.

## 8. Legacy contract still works

Legacy mode reproduces `app_projects_for_zip` exactly — same filter, same grain (including
`source_seq`), same ordering, one marker per row. Verified byte-identical after stripping the
single added `project_ref` key:

| ZIP | production rows | new projects | new markers | identical |
|---|---:|---:|---:|---|
| 01001 | 173 | 173 | 173 | ✅ |
| 01004 | 90 | 90 | 90 | ✅ |
| 01252 | 15 | 15 | 15 | ✅ |
| 01373 | 0 | 0 | 0 | ✅ |
| 01441 | 26 | 26 | 26 | ✅ |
| 06390 | 0 | 0 | 0 | ✅ |
| 78617 | 511 | 511 | 511 | ✅ |
| 84302 | 41 | 41 | 41 | ✅ |

## 9. Frontend separation

`HS.markerPoints(item)` (lib/map.js) is the single helper: it returns the authoritative
marker list when supplied and **otherwise the item's own single point**, which is exactly
what shipped before — so with the cutover OFF nothing changes. Every marker loop now
iterates it while the card list stays `items`:

- `lib/map.js` Leaflet loop and MapLibre loop
- `maps.html` GL lettered pins, Leaflet lettered pins, Leaflet rest layer, SVG fallback rest pins

Each emitted marker closes over the SAME item, so clicking any marker opens that one card.

`HS.authoritativeMode()` reads `?hs_auth=1` and defaults **false**. A ZIP that is not
`boundary_complete` falls through to the legacy read.

## 10-12. Authoritative shadow equality, all 346

| check | required | measured |
|---|---|---|
| projects | 5,842 | **5,842** |
| markers | 13,218 | **13,218** |
| duplicate project_ref within a ZIP | 0 | **0** |
| orphan markers | 0 | **0** |
| markers referencing another ZIP's project | 0 | **0** |
| projects missing required card fields | 0 | **0** |
| authoritative projects without markers | 0 | **0** |
| marker coordinate differences vs the relation | 0 | **0** |
| markers absent from the relation | 0 | **0** |

Named controls:

| ZIP | role | auth status | projects | markers | relation | production |
|---|---|---|---:|---:|---:|---:|
| 06390 | named | boundary_complete | **7** | 7 | 7 | 0 |
| 01009 | measured-zero, boundary_complete | boundary_complete | **0** | **0** | 0 | 79 |
| 06360 | largest authoritative-project | boundary_complete | 86 | 154 | 154 | 92 |
| 06238 | largest markers + multi-component polygon | boundary_complete | 61 | **175** | 175 | 64 |
| 01507 | heavy line project | boundary_complete | 24 | **173** | 173 | 54 |
| 01004 / 01252 / 01441 | not_measured | not_measured | null | null | 0 | 90 / 15 / 26 |
| 01373 | noncanonical (registry 0) | unknown | null | null | 0 | 0 |
| 78617 | outside completed acquisition | unknown | null | null | 0 | 511 |

01009 returns **empty arrays, not null** — an honest empty authoritative page that does not
fall back to legacy, even though production carries 79 rows there. The not_measured and
out-of-scope ZIPs return null and therefore fall through to unchanged production behaviour.

## 13. Frontend evidence

`test/a4-project-marker-contract.test.mjs` — 19 assertions against the SHIPPED `lib/map.js`:
legacy single-point behaviour, dropped half-coordinates, three markers → three points,
`marker_seq` ordering, a marker with no coordinate dropped rather than placed at a fabricated
point, and the invariant itself — three projects fan out to six markers while the card list
stays three and every marker resolves to one project. Full suite: **142 files, all passing**
(141 before this unit).

## 14. Security

The delivery surface is the FUNCTION, never the tables. `prosecdef = true`,
`search_path = public, geo, pg_temp`, closed input vocabularies (`^[0-9]{5}$`, kind in
development/facility), no dynamic SQL, EXECUTE granted to anon/authenticated/service_role only.
**`geo` schema USAGE for anon/authenticated/PUBLIC: NONE. Table grants: NONE.**

## 15. Complete contract performance, all 346

| | value |
|---|---:|
| projects half p50 / p95 | 3.8 ms / 23.3 ms |
| markers half p95 | 4.81 ms |
| **combined p50 / p95 / p99 / max** | **8.8 / 38.7 / 47.0 / 61.9 ms** |
| response bytes p50 / p95 / max | 20 kB / 108 kB / **171 kB** |
| timeouts | **0** |
| projects / markers returned | 5,842 / 13,218 |

## 16. Rollback — independent

- **A (contract):** `drop function if exists public.app_zip_projects_markers(text, text, boolean);`
  plus reverting the frontend commit. `HS.markerPoints` degrades to the legacy single point,
  so removing it alone cannot change resident output.
- **B (index):** `drop index concurrently if exists public.app_projects_source_key_kind_idx;`
  It carries no data — dropping it restores A3 performance and nothing else.

Neither was rolled back; every gate passed.

## 17. Preservation

| artifact | state |
|---|---|
| `app_projects_for_zip` md5 | `ec1b01ae4485ad2c59b9f946c9d565b6` — unchanged |
| `app_projects` indexes | 4 → **5** (the authorized index); md5 `cb54ea11…` → `8737ec12…`; none removed |
| membership | 5,845 · `ff09ed6d59b3a436bf0a8c9ca6f5eaa9` — unchanged |
| status | 428 · `3f452ffa40fc1f540af3270655ad7400` — unchanged |
| marker fingerprint | 13,221 · `e3a0efeb826befc77a4ec57762cf4a1f` — unchanged |
| `n5_association` / `n5_boundary_membership` / `n5_geom` | 20,170 / 18,184 / 741,562 — unchanged |
| canonical registry / development_reports | 12,722 / 12,722 — unchanged |
| acquisition shards | 13 done / 531 pending — unchanged |
| SEO / indexability / sitemap / workbook | not touched |
| `geo` browser exposure | NONE — unchanged |

New objects: the index, `public.app_zip_projects_markers`, `geo.n5_a4_contract_bench`.
No ordinary ingestion movement was observed in `app_projects` row count during this unit.
