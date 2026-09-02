# N5 / map-address-search — recovered architecture record (verified)

**Status: reconstructed and independently re-verified 2026-09-02.**

The `feature/map-address-search` branch (tip `ff71dcd`, six commits) was never pushed and is
unrecoverable (see `QUEUE.md` RESUME POINT and PR #1011). Its technical conclusions survived
only in a chat transcript, which makes them **hypotheses, not findings**. This document turns
each transcript claim into a **VERIFIED** finding backed by a committed repo receipt, or marks
it **NOT VERIFIED** with the reason. No claim is restated as fact without a receipt.

## Verification surface and its limit (read first)

Verification was performed in a Cloud Agent container with **no live-database access**: no
`SUPABASE_*` credentials, no `psql`, no `supabase` CLI, and no Supabase MCP. Therefore:

- **Structural claims** (schema shape, unique indexes, column lists, which table carries which
  column, discard/retain lifecycle, code semantics) are verified against the committed
  source of truth — chiefly `scripts/n5_shard.py`, `docs/app-projects-stable-key-migration.sql`,
  and `docs/maps-source-identity-migration.sql`.
- **Live-count claims** (distinct counts, row counts, "N of 544 shards", "723,449 PROVEN POINT",
  cache size) **cannot be run here**. They are marked NOT VERIFIED unless a committed artifact
  already carries the number. None of `544`, `723,449`, or a shard-state manifest exists anywhere
  in the repo (searched); the only committed corpus figures are the frozen-baseline numbers in
  `n5_shard.py` and the coverage table in `app-projects-stable-key-migration.sql`.

To close the NOT-VERIFIED items, run the queries named below with service-role credentials.

---

## Claim 1 — IDENTITY — VERIFIED (with one field-name correction)

**Claim:** `source_key` is the project identity; `source_seq` is multiplicity, not identity;
`source_ref` is dataset-level and must never be used as project identity.

**VERIFIED — `source_key` is the identity, `source_seq` is multiplicity.**
`docs/app-projects-stable-key-migration.sql` §4 creates the upsert target:

```
create unique index concurrently if not exists app_projects_zip_source_key_uidx
  on public.app_projects (zip, source_key, source_seq);
```

- `source_key` = deterministic namespaced source-record identity (`platform:scope:record`,
  e.g. `socrata:data.cityofchicago.org:ydr8-5enu:101077607`), derived by
  `public.app_source_key(el)`; **NULL when the source exposes no defensible record id** — never
  an address/title hash. (Same file, §1 + column comment.)
- `source_seq` = "Ordinal within `(zip, source_key)`, assigned by `md5(el::text)` … Always 1
  where the source key is unique (88.3% of sites). >1 only inside the 37,965 measured duplicate
  groups." (Column comment.) That is multiplicity, not identity, exactly as claimed.

**CORRECTION — the "`source_ref`" label in the claim is wrong for `app_projects`.** In
`app_projects`, `source_ref` is populated as `coalesce(el->>'record_url', el->>'url')` — the
**per-record URL**, not a dataset id (`app-projects-stable-key-migration.sql` materialiser insert;
`maps-source-identity-migration.sql`). The **dataset-level** identifier is `registry_id`
( = `el->>'source_registry_id'`, e.g. `austin-site-plan-cases`), which is shared across every
project a connector emits. The claim's *intent* — "do not use the dataset-level source reference
as project identity; use `source_key`" — is correct and is enforced by the unique index above.
The specific field named (`source_ref`) is not the dataset-level field; `registry_id` /
`source_registry_id` is.

**NOT VERIFIED — the distinct-count numbers.** "distinct counts for `source_key` vs
`source_ref`-based keys" requires the live DB. The committed **basis distribution** (measured
2026-08-10, not re-run here), over 3,022,921 qualifying sites, is the closest committed evidence
(`app-projects-stable-key-migration.sql` §1):

```
source_id:case_number    2,819,607   93.274%
epa_frs:registry_id        197,571    6.536%
source_id:row_id             5,113    0.169%
source_id:title(MUTABLE)       625    0.021%
tdlr:project_no                  5    0.000%
(no key)                         0    0.000%
```

To close: `select count(distinct source_key), count(distinct source_ref) from public.app_projects
where record_kind='development';`

---

## Claim 2 — MULTI-GEOMETRY PROJECTS — VERIFIED structurally; count NOT VERIFIED

**Claim:** one `source_key` can legitimately own multiple geometries, so
`DISTINCT ON (source_key)` would destroy real spatial data.

**VERIFIED structurally.** The canonical geometry store `geo.n5_geom` is keyed
`(source_key, feature_id)` (`n5_shard.py`, `insert into geo.n5_geom … on conflict
(source_key, feature_id) do nothing`), and recovery **preserves publisher feature multiplicity**
— "one row per `source_key` × OBJECTID" (`recover_shard` docstring). The association build
intersects **all** of a project's geometries and only then reduces to distinct `(source_key, zip)`
(`build_associations`: `allgeom = pt UNION ALL rec`, then
`select distinct a.source_key, b.zcta5 … ST_Intersects`). Collapsing to one geometry per
`source_key` (a `DISTINCT ON (source_key)`) would drop the ZIP memberships contributed by every
other geometry of that project — i.e. destroy real associations. The design is explicitly
multi-geometry.

**NOT VERIFIED — the count.** "development projects with >1 distinct `(lat,lng)`" requires the
live DB. To close, against the frozen baseline:
`select count(*) from (select source_key from preservation.app_project_identity where
snapshot_id='phase1-2026-09-01' and record_kind='development' group by source_key
having count(distinct (lat,lng)) > 1) t;`

---

## Claim 3 — TREATMENT ELIGIBILITY GAP — VERIFIED structurally; number NOT VERIFIED

**Claim:** no coordinate-fidelity field exists; `geo.n5_frozen` carries `treatment` but is
discarded per shard; `geo.n5_association` carries only `(source_key, zip, evidence)` — no
treatment, no registry, no fidelity. So radius eligibility cannot be enforced structurally, and
PROVEN POINT's 723,449 is a treatment **label**, not a count of radius-trustworthy coordinates.

**Column lists — VERIFIED** (all from `scripts/n5_shard.py`, which reads/writes every table):

| table | columns | lifecycle |
|---|---|---|
| `geo.n5_frozen` | `z3, source_key, zip, source_seq, registry_id, treatment, lat, lng, source_key_basis` | **discarded per shard** (step 6: `delete from geo.n5_frozen where z3=…`) |
| `geo.n5_geom` | `source_key, registry_id, feature_id, outcome, geom, invalid_reason, first_z3` | **retained** — "the cross-shard geometry cache", deliberately not discarded |
| `geo.n5_association` | `source_key, zip, evidence` | the durable output |
| `geo.n5_zcta` | `z3, zcta5, geom` | per-shard boundaries, discarded |
| `geo.n5_shard` | `snapshot_id, z3, state, projects, pairs, zips, checksum, started_at, finished_at, detail` | manifest / state |
| `geo.n5_snapshot` | `snapshot_id, sources, projects, pairs, n_rows` | baseline header |
| `geo.n5_accepted_source` | `registry_id, treatment` | source→treatment map |
| `geo.n5_recovery_attempt` | `z3, registry_id, projects_in_shard, cache_hits, fetched, features, bytes_in, requests` | recovery audit |

- **No coordinate-fidelity field exists** anywhere in the layer — VERIFIED (see the column
  lists; `n5_frozen` has `lat/lng/treatment` but no fidelity column; `n5_association.evidence`
  is a 1–4 provenance class — geometry_verified / legacy_unverifiable / legacy_unsupported /
  unresolved — not a coordinate fidelity).
- **`treatment` is discarded per shard** — VERIFIED (`n5_frozen` deleted in step 6 while
  `n5_geom` is kept).
- **`geo.n5_association` carries only `(source_key, zip, evidence)`** — VERIFIED (insert list).
  No treatment, no registry, no fidelity.
- **`treatment` is a source-level label, not a per-coordinate measure** — VERIFIED. It is
  assigned at freeze by joining `geo.n5_accepted_source` **on `registry_id`**
  (`join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')`), so every
  project from a given source shares that source's label. PROVEN projects then use their frozen
  stored `lat/lng` **verbatim** — the association docstring states "No centroid, no radius, no
  bounding box, no nearest-ZIP, no buffer, no simplification, no snapping, and no ST_MakeValid."
  So a "PROVEN POINT" total counts projects whose **source** was classified PROVEN, not
  coordinates independently shown to be radius-trustworthy. The claim's conclusion holds.
- **Radius eligibility cannot be enforced from the association layer** — VERIFIED as a structural
  consequence: the association layer has no treatment/registry/fidelity column, and the one table
  that did carry `treatment` (`n5_frozen`) is discarded per shard.

**`n5_association.source_key` → `registry_id`: does it resolve? — VERIFIED (it does NOT, cleanly).**
`geo.n5_association` has **no `registry_id` column**. `registry_id` is recoverable only:
(a) by **string-parsing** the key for 3-segment arcgis keys `platform:registry_id:ident`
(`fetch_features`: "everything after the SECOND colon is the identity"), which does **not**
generalise to 4-segment socrata keys `platform:domain:dataset:ident`; or (b) by joining
`geo.n5_geom` (retained, carries `registry_id`) — but only **RECOVERY** projects have an
`n5_geom` row; **PROVEN** projects have none. So after the frozen slice is discarded there is no
reliable stored path from an association back to `registry_id`, confirming the association layer
lacks source/treatment/fidelity provenance.

**NOT VERIFIED — the 723,449 figure and current row counts.** No DB access; `723,449` appears
nowhere in the repo. To close: column lists via `information_schema.columns where table_schema='geo'`;
counts via `select count(*) from geo.n5_association;` and
`select treatment, count(*) from geo.n5_accepted_source group by 1;`

---

## Claim 4 — N5 STATUS — PARTIALLY corroborated in code; live numbers NOT VERIFIED

**Claim:** N5 stands at 2 of 544 shards (`520`, `062`).

**Corroborated by committed code:** shards **`520`** and **`062`** are exactly the two named in
`scripts/n5_shard.py` as the shards that were run/debugged — `062` "failed … after the freeze and
boundary steps had already succeeded" on the `rings_to_wkt` `(wkt, reason)` marshalling, and
"Shard `520` could not have caught it: its source is a polyline, so it never took the rings
branch." So "the two shards worked were 520 and 062" is consistent with the repo.

**NOT VERIFIED — "2 of 544", the association count, and cache size.** These are live state in
`geo.n5_shard` / `geo.n5_association` / `geo.n5_geom`. There is no DB access here, and neither the
number `544` nor a shard-state manifest is committed. To close:
`select state, count(*) from geo.n5_shard where snapshot_id='phase1-2026-09-01' group by 1;`
`select count(*) from geo.n5_association;`
`select pg_size_pretty(pg_total_relation_size('geo.n5_geom'));`

---

## Claim 5 — ARCHITECTURE RULING (founder decision — recorded, not verified)

Recorded verbatim in intent:

- **Canonical spatial storage is the N-series geo layer, keyed `(source_key,
  geometry_instance_key)`.** Consistent with the committed store: `geo.n5_geom` is keyed
  `(source_key, feature_id)`, where `feature_id` is the geometry-instance key.
- **The read surface is a bounded private RPC.** ⚠️ **No such RPC exists in `main`.** A search
  finds `geo.n5_association` referenced only by `scripts/n5_shard.py` (the builder); there is no
  `SECURITY DEFINER` read function over any `geo.n5_*` table. This is consistent with the read
  surface having lived only on the unpushed branch — the ruling stands as a decision, but its
  implementation is not present and must be built (from scratch) if address mode is rebuilt.
- **`app_projects` remains the ZIP read model and is NOT the canonical spatial store.**
  ⚠️ The instruction text was truncated at "…and is NOT"; the clause is completed here to the
  evident intent (NOT the canonical spatial store — the geometry lives in the N-series layer),
  and is flagged as **inferred, not dictated**. Confirm before relying on the completion.

---

## One-line summary

Of the five claims: **1 and 3 are VERIFIED structurally** (with a field-name correction on 1);
**2 is VERIFIED structurally** but its count is unrun; **4 is corroborated only as to which two
shards (520, 062)**; every **numeric/live-state figure is NOT VERIFIED** for lack of DB access;
**5 is a recorded founder ruling whose read-surface RPC does not yet exist in `main`.**
