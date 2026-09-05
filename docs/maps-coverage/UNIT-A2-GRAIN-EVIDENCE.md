# Unit A2 — marker grain and descriptive-row reference: evidence, and why the schema was NOT amended

**Nothing was implemented.** This turn ran `SELECT` only. Production is on the Unit B rollback
body (`read_path_md5 ec1b01ae4485ad2c59b9f946c9d565b6`), `app_projects` still has its 4 original
indexes, and the Unit A shadow is untouched (membership `ff09ed6d59b3a436bf0a8c9ca6f5eaa9`,
status `66abb4e62d60f95cc9eb81ae66d33a81`).

---

## 1. What `source_seq` actually is, measured per registry over the 346 cutover ZIPs

| registry | projects | current rows | (ZIP,project) pairs | rows/pair | max | multi-row pairs | of those, redundant coordinates | authoritative family |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| **massdot-highway-projects** | 1,496 | 26,905 | 6,127 | **4.39** | **136** | **3,932** | **0** | MultiLineString |
| worcester-building-permits | 7,664 | 7,664 | 7,664 | 1.00 | 1 | 0 | — | none (NOAUTH) |
| ctdot-project-work-areas | 455 | 3,918 | 3,918 | 1.00 | 1 | 0 | — | MultiPolygon |
| iowa-dot-* (3 registries) | 5 | 5 | 5 | 1.00 | 1 | 0 | — | line / point |

🔑 **Exactly one registry produces repeated rows for a `(ZIP, project)` pair, and none of them is a
duplicate.** Distinct coordinates across MassDOT pairs total **26,905 — the same as the row count**,
so no two rows in a pair share a coordinate. Category **A (identical/redundant) is empty**.

**Are the extra points real project locations?** Yes, and this is the decisive test: sampling
**3,000** MassDOT legacy points and measuring each one's distance to that project's own
authoritative geometry — **3,000 of 3,000 lie ON the line (≤ 1 m; max 1 m, p95 1.0 m)**. They are
vertices of the authoritative linework, not fan-out artefacts.

**How far apart are they inside one ZIP page?** Bounding-box diagonal per multi-point pair
(3,932 pairs, avg 6.28 points): **p50 362 m · p95 7,253 m · max 95,842 m**; under 100 m **1,387
(35%)**, 100–500 m 754, 500 m–2 km 978, **over 2 km 813 (21%)**.

So the classification is unambiguous: **category D — a line source represented today by multiple
legitimate points along the line.** Every other source in scope is one row per pair.

---

## 2. Marker-grain conclusion: multiple markers are legitimately required

One marker per `(ZIP, project)` is correct for **CTDOT (polygon), Iowa, and every single-row
pair** — three registries entirely, plus 2,195 of MassDOT's own pairs. It is **not** correct for
the 3,932 MassDOT pairs whose points span a real distance inside the ZIP: collapsing a highway
project's linework to one dot would answer "is this near my house?" with a point that can be
kilometres from the part of the project actually crossing the resident's ZIP. On the measured
spread, **65% of MassDOT multi-point pairs span more than 100 m and 21% more than 2 km**.

Per the authorization, that ends this unit: **STOP before changing the schema.** No
`app_project_id` column was added and no marker relation was created.

⚠️ **One measurement is missing and it is the one that sizes the fix.** The right question is not
how far the *legacy* points spread — legacy assignment is what the programme is correcting — but
how long the **authoritative geometry clipped to that ZCTA** is. Unit A stored `clip_dim` but not
the clip or its length, and dropped the boundary scratch table, so it cannot be computed from what
is stored. It needs one bounded runner pass that re-loads the 13 prefixes' boundaries and records,
per membership, the clipped length and vertex count.

**Smallest design that would follow** (reported, not built): keep membership at `(ZIP, project)` —
it is the right unit for "does this project belong on this page" — and add a separate
`geo.zip_authoritative_marker (zcta5, source_key, marker_seq, lat, lng, rule)` derived from the
clipped geometry, one row for a point or short clip and N for a long one. Membership stays the
gate; markers become the rendering grain. Unit A's geography and status semantics do not move.

---

## 3. Descriptive-row reference: resolution is perfect, persistence is not safe

**Resolution** (Unit A's existing rule, `last_seen_at DESC, id ASC`), measured set-based:
5,845 memberships over **1,875 projects → 1,875 ids resolved, 0 missing, 0 non-development,
0 source_key mismatches**, selection fingerprint `8dc4fcb9eb34767954b4a2831e205559`, reproduced
identically on a second pass. 38 projects have a NULL `submitted_at` — legitimate, present in
today's output too, already handled by `nulls last`; `name` and `source_ref` are 100% present.

**Staleness**, measured against the frozen snapshot `phase1-2026-09-01` (~2 days):

| | |
|---|---:|
| snapshot rows for these projects | 48,070 |
| current rows | 48,032 |
| snapshot ids still present | 48,031 |
| snapshot ids **vanished** | **39** (0.081%) |
| id changed while `(zip, source_key, source_seq)` survived | **0** |
| natural keys gone / new | 39 / 1 |

🔑 **The finding that decides it: `last_seen_at` is rewritten wholesale on every reconciliation.**
All 48,032 rows carry a `last_seen_at` inside a single one-hour window (2026-09-03 11:16–12:15Z);
`distinct_last_seen_days = 1`. Of the 1,875 projects, **871 (46.5%) have their pick decided by
`last_seen_at` alone**, 814 fall through to the `id` tie-break, 190 have a single row. So a
persisted id would go stale in *meaning* for nearly half the projects on every refresh, even though
ids are stable for surviving rows — and 39 rows genuinely disappeared in two days.

**Recommendation: neither a persisted id (A) nor a refresh-maintained reference (B), but (C)** —
two smaller moves that remove the problem instead of tracking it:

1. **Make the selection rule independent of a rewritten timestamp** — order by `id` alone, or by
   `(source_seq, id)`. It costs almost nothing in fidelity: **1,791 of 1,875 projects have exactly
   one descriptive variant**, and the 84 that differ do so mostly in `type_raw` (47) and `stage`
   (25).
2. **Fix the Unit B read shape rather than the data.** The Unit B failure was **N sequential scans,
   not scan cost**: one full scan of `app_projects` costs **312 ms**, and the set-based resolution
   of all 1,875 projects at once completed inside a single query here. The failure came from the
   planner choosing a nested loop over a small membership set (76 rows → 76 scans → 18.5 s). A read
   that resolves descriptive rows in **one pass** needs no new column, no index and no persisted
   reference. **This is an inference from two measurements, not a benchmark of the proposed read —
   that benchmark has not been run.**

---

## 4. What could not be measured, stated rather than skipped

- **Clipped-geometry length per membership** (§2) — needs a bounded runner pass.
- **Performance probes and the all-346 timing run** (steps 9–10) — both require the amended shadow,
  which the grain result forbids building. Not run, not estimated.
- **Fail-closed invariant for a stale id** (step 7) — designed only, because no id was persisted.
