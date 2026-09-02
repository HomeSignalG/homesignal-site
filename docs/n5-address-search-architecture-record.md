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
  cache size) **cannot be run here**. Where a number was needed, it was **founder-measured
  directly against the live database on 2026-09-02** and is labelled as such below — this agent
  did not reach the DB itself. Numbers with no founder measurement and no committed artifact stay
  NOT VERIFIED (the only committed corpus figures are the frozen-baseline numbers in `n5_shard.py`
  and the coverage table in `app-projects-stable-key-migration.sql`).

To re-close any FOUNDER-MEASURED item independently, run the queries named below with
service-role credentials.

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

**RECONCILED — `source_ref` IS a record-URL field, and that is exactly why it must not be the
identity.** Both halves of the transcript claim are right once reconciled, so neither is "the
wrong side": in `app_projects`, `source_ref` is populated as `coalesce(el->>'record_url',
el->>'url')` — a record-URL field (`app-projects-stable-key-migration.sql` materialiser insert;
`maps-source-identity-migration.sql`). **But for sources at `record_url_precision = "dataset"` it
holds the same URL for every record**, so it does not distinguish per-record identity for those
sources. The dataset-level source identifier proper is `registry_id` ( = `el->>'source_registry_id'`,
e.g. `austin-site-plan-cases`).

**FOUNDER-MEASURED 2026-09-02 (live DB):**

- distinct `source_key` (development) = **932,736** — the real project count.
- distinct `(source_ref, lat, lng)` = **629,617** — **below** 932,736.

The `source_ref`-based key measures **303,119 fewer** than the real projects, precisely because it
collapses every dataset-precision source's rows onto one shared URL. So using `source_ref` as
project identity **merges distinct projects** — the claim's conclusion, now with a number behind
it. Identity must be `source_key`, enforced by the unique index above.

To re-measure: `select count(distinct source_key) from public.app_projects where
record_kind='development';` and
`select count(distinct (source_ref, lat, lng)) from public.app_projects where
record_kind='development';`

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

**FOUNDER-MEASURED 2026-09-02 (live DB) — the count is real and non-trivial.** Development
projects with >1 distinct `(lat,lng)` = **9,121**. A `DISTINCT ON (source_key)` collapse would
therefore silently drop spatial memberships for 9,121 real projects. To re-measure:
`select count(*) from (select source_key from public.app_projects where record_kind='development'
group by source_key having count(distinct (lat,lng)) > 1) t;`

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

**Shards `520` and `062` are corroborated from committed source** (named in `n5_shard.py` as the
two run/debugged). **But the live counts do NOT match "only those two."** Founder-measured:

| measurement | shards 520 + 062 (earlier 2026-09-02) | live now (2026-09-02) |
|---|---|---|
| `geo.n5_association` rows | 1,892 | **4,068** |
| `geo.n5_geom` features | 256 | **449** |

4,068 > 1,892 and 449 > 256, so **at least one further shard completed after the two-shard
measurement** — almost certainly `063` (the next-smallest-`pairs` pending shard, and the one whose
`rings` branch the `062` fix unblocked). **The exact current shard count is NOT VERIFIED from this
container.** The transcript's "2 of 544" was true when written and is now stale.

⚠️ **Method note (this is a corrected mistake, kept as the lesson): a number that merely fails to
contradict a hypothesis is not corroboration of it.** An earlier version of this section read the
small `4,068 / 449` counts as "consistent with only two shards done." They are not: they *exceed*
what two shards produced, which is evidence *against* that hypothesis, not for it. Before a number
counts as corroboration, check that the hypothesis actually *predicts* it — not merely that it is
not obviously refuted. To re-measure the true state:
`select state, count(*) from geo.n5_shard where snapshot_id='phase1-2026-09-01' group by 1;` ·
`select count(*) from geo.n5_association;` · `select count(*) from geo.n5_geom;`

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
- **`app_projects` remains the ZIP read model and is NOT the address-radius source** — it stores
  one representative `lat/lng` per row, while authoritative geometry is polygons and polylines, so
  no view over it can answer distance-to-polygon at any effort. (Founder-confirmed wording,
  2026-09-02; supersedes the earlier truncated/inferred completion.)

---

## One-line summary

Of the five claims: **1 is VERIFIED** — structure from the repo, and the `source_ref` question
reconciled with founder-measured numbers (932,736 real projects vs 629,617 distinct
`(source_ref, lat, lng)`, so `source_ref` merges distinct projects); **2 is VERIFIED** — multi-geometry
by design, with 9,121 development projects carrying >1 `(lat,lng)` (founder-measured); **3 is
VERIFIED structurally** — no coordinate-fidelity field, `treatment` a per-source label discarded
per shard, association only `(source_key, zip, evidence)` — with the `723,449` PROVEN-POINT figure
left **NOT VERIFIED** (transcript-only); **4** corroborates shards 520/062 from source, but
the live counts (`n5_association` 4,068 > 1,892; `n5_geom` 449 > 256, founder-measured) show **at
least one further shard completed since** the two-shard measurement (likely 063) — exact shard
count NOT VERIFIED; **5 is a recorded founder ruling** whose read-surface RPC does not yet exist in
`main`. Live numbers are
founder-measured 2026-09-02; this agent had no DB access.
