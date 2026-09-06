# app_zip_geography_cutover

## Defect

```sql
select c.zip, w.enabled, (w.production_geography_verified_at is not null) as stamped
from public.canonical_zip_registry c
join geo.maps_zip_geography_status s on s.zip = c.zip
join public.app_zip_geography_cutover w on w.zip = c.zip
where s.status = 'not_measured'
  and s.note   = 'NO_ZCTA_IN_TIGER_2025'
  and coalesce(s.membership_rows, 0) = 0;
```

**64 rows**, md5 of the zip set with the collation pinned
(`md5(string_agg(zip::text, ',' order by zip::text collate "C"))`) =
`161ba702caee12bab4d0b1fd783cdf8a`, equal to the fingerprint carried in prior state.

Measured 2026-09-06 17:47Z, those 64 rows read **`enabled=0`, `stamped=0`**. The brief describes
them as enabled and stamped; that was true when the brief was written and is not true now — the
stamps were cleared earlier in this session by migration `retire_stale_cutover_on_not_measured_zips`,
which was reported at the time. The table holds **12,077 rows, 12,013 enabled**; 12,077 − 64 = 12,013.

## Measured blast radius

**Map 1 — unaffected.** Its read path is `public.app_zip_projects_markers`. Checked against the
live function body rather than inferred:

```
app_zip_projects_markers  reads app_zip_geography_cutover: false   reads maps_zip_geography_status: true
app_projects_for_zip      reads app_zip_geography_cutover: true    reads maps_zip_geography_status: true
```

Map 1 never consults the cutover table, so no state of these 64 rows can reach it.

**`app_projects_for_zip` — affected.** It gates on `geo.maps_zip_geography_status` first and only
then consults the cutover table:

```sql
select s.status into v_status from geo.maps_zip_geography_status s where s.zip = p_zip;
if coalesce(v_status,'') <> 'boundary_complete' then
  return jsonb_build_object('unavailable', true, 'zip_geography_status', coalesce(v_status,'unknown'), 'projects', null);
end if;
if exists (select 1 from public.app_zip_geography_cutover c where c.zip = p_zip and c.enabled) then
  return public.app_authoritative_projects_for_zip(p_zip);
end if;
```

Reproduced as `anon`, actual output, 2026-09-06 17:49Z:

| zip | geo status | cutover enabled | `app_projects_for_zip(zip,'development')` | rows the legacy branch would serve |
|---|---|---|---|---:|
| 10015 | not_measured | false | `UNAVAILABLE:not_measured` | 102 |
| 78711 | not_measured | false | `UNAVAILABLE:not_measured` | 473 |
| 01004 | not_measured | false | `UNAVAILABLE:not_measured` | 90 |

The brief's expected outputs — 10015 and 78711 returning 0 rows through the authoritative branch,
01004 returning 90 legacy rows — no longer reproduce. All three now answer identically.

## Why not repaired here

The half of this defect that changed what a resident sees is already closed, and closing it is what
made the brief's premise stale: the status gate shown above was added to `app_projects_for_zip`
before the stamps were cleared, so clearing them could not flip 01004 to its 90 legacy centroid rows
— the legacy branch is unreachable for any ZIP that is not `boundary_complete`. What remains is 64
retired rows still physically present in `app_zip_geography_cutover` with `enabled=false` and no
stamp. They are inert against both read paths, and deleting them would destroy the only record of
which ZIPs were retired and why, so this unit left the table exactly as measured and modified
nothing in it.

## Open questions for next owner

- Should a retired cutover row be deleted, or is `enabled=false` with a cleared stamp the intended
  terminal state for a ZIP that can never be cut over?
- If retired rows stay, what distinguishes "retired because the pinned TIGER archive has no ZCTA"
  from "retired because measurement failed and may be retried"? The table carries no reason column.
- Should `app_zip_geography_cutover` be constrained so a row can never be enabled for a ZIP whose
  `geo.maps_zip_geography_status` is not `boundary_complete`, rather than the two tables being kept
  consistent by convention?
- Which table is authoritative when they disagree — and which one should a future reader be told to
  trust first?
- `app_projects_for_zip` consults both tables while `app_zip_projects_markers` consults only status.
  Is that difference intended, or is the cutover check redundant now that the status gate precedes it?
- The 64 ZIPs still hold 102 / 473 / 90-style legacy development rows in `app_projects`. Are those
  rows meant to be retained, quarantined, or removed?
- Does anything outside these two functions still read `production_geography_verified_at` as a
  liveness signal?
