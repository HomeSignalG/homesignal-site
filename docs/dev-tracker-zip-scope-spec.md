# ZIP-scope the development page (resident enters address → their ZIP page)

## Goal
A resident enters an address, lands on their ZIP page, and sees developments in
their ZIP. Data comes from the `homesignal-ingest` Supabase DB (already built + exposed).
**This is the site half** — the homesignal-ingest / DB changes are done and live.

## Data contract (already live in Supabase, read via the anon key)
Page key = the resident's ZIP (geocode their address; the US Census geocoder returns the ZIP).

Constants:
```
BOX_ELDER = 'd67c558f-1f04-4811-a565-873ae2afd6f3'
DEV_CATEGORIES = ['Planning, zoning & development',
                  'Stratos data center project',
                  'County Commission & county business']
```

The page renders **three buckets**:

### Bucket (a) — resolved project anchor (ZIP-precise)
```js
// 1) which resolved projects touch this ZIP + straddle context
const { data: projects } = await sb
  .from('v_resolved_project_zip').select('*').eq('zip', zip);

// 2) roster + geometry for each project
const { data: parcels } = await sb
  .from('v_resolved_project_parcels').select('*')
  .eq('project_key', p.project_key).eq('in_anchor', true);
```
Render parcel polygons from `geom_geojson`. Presentation is driven by the flags the
view already returns — the site does **not** compute the straddle logic:
- `is_primary_zip === true`  → full display (this is the project's home ZIP).
- `is_primary_zip === false` → label: **"Part of a project centered in {primary_zip}
  — {parcels_in_this_zip} parcels in your ZIP".**
- Per parcel honesty labels (all fields are on the view):
  - `zip_basis === 'adjacency-ZCTA-gap'` → small note "ZIP by adjacency (not direct geometry)".
  - `off_target_zip === true` → the straddle note from `note`.

### Bucket (b) — address-precise notices (ZIP-scoped)
```js
sb.from('alerts').select('title,category,agency_name,source_url,comment_deadline,zip')
  .eq('community_id', BOX_ELDER).in('category', DEV_CATEGORIES)
  .eq('geo_scope', 'address').eq('zip', zip);
// meetings: same filters + the existing is_public_hearing / comment_period_open predicate
```

### Bucket (c) — county-wide notices (cascade, LABELED)
```js
sb.from('alerts').select('...')
  .eq('community_id', BOX_ELDER).in('category', DEV_CATEGORIES)
  .or('geo_scope.eq.countywide,geo_scope.is.null');
```
Render with a **"County-wide"** badge — shown, not hidden, not shown-as-local.

## Straddle behavior (built into the data, not the site's problem to compute)
The Stratos project spans 84336 (78 parcels) + 84307 (4 parcels). It surfaces on
**both** ZIP pages: on 84336 as the primary project, on 84307 labeled as above. The
view returns `is_primary_zip` / `parcels_in_this_zip` / `other_zips` — the site only
chooses presentation.

## Graceful default (works before the ingest-side backfill runs)
Until the ingest-side backfill populates `alerts.zip` / `geo_scope`, those are NULL →
bucket (b) is empty and everything falls into bucket (c) via the `geo_scope.is.null`
clause. The page still works; it's just less ZIP-precise for raw notices. No notice is
ever dropped.

## Test target
ZIP **84336** (Snowville, Box Elder). Confirmed by parcel geometry. On this page:
- Bucket (a): the Stratos anchor — **78 in-ZIP parcels** (52 direct-geometry + 26
  adjacency), each with per-parcel honesty labels; the project also shows on 84307
  labeled (4 straddle parcels).
- Bucket (b): expected ~empty for 84336 (government meetings happen in Brigham City
  84302, not Snowville) — that's correct, not a bug.
- Bucket (c): county-wide Box Elder notices, badged "County-wide".

## Acceptance criteria
- 84336 page shows the Stratos anchor (78 parcels) with the per-parcel honesty labels
  (`zip_basis` adjacency vs direct; `off_target_zip` straddle).
- County-wide notices show, badged **"County-wide"** (never hidden, never shown-as-local).
- No notice is ever dropped.
- Straddle: Stratos also appears on the 84307 page, labeled "part of a project
  centered in 84336".
- (Later, once the ingest-side backfill runs) address-precise notices appear in
  bucket (b) filtered to the ZIP.

## Exposure / security notes (already in place on the DB side)
- `v_resolved_project_zip` and `v_resolved_project_parcels` are `security_invoker`
  views over `resolved_projects` / `resolved_project_parcels`, readable by `anon`
  via public-read RLS policies (matches the existing `alerts`/`meetings` pattern).
- **PUBLIC-RECORD ONLY:** these tables/views are world-readable because they hold
  public county parcel + government-record data with no PII. Do not add private/PII
  data to them.

---
_Ingest/DB half implemented in `homesignal-ingest` (resolved-project anchor,
public-read views, geocode-at-ingest columns). This doc is the site-half spec._
