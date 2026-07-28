# Phase 3 (Shelby County TN, Opendatasoft) — recon findings and scope finding

Branch: `claude/phase3-socrata-custom`. Probe targets: `scripts/recon/p3-round{1,2,3}.json`.
recon-fetch runs **30381742794** (r1), **30381831357** (r2), **30381943709** (r3).

## THE SCOPE FINDING — this phase is NOT config-only

Phases 1 and 2 were registry edits because the ArcGIS connector already existed. **There is no
Opendatasoft connector in this repo.** `supabase/functions/get-address-report/sources/` contains
`arcgis.ts`, `socrata.ts`, `ckan.ts`, `csv.ts`, `carto.ts` (+ `tceq-cr.ts`, `tdlr-tabs.ts`), and
`jurisdiction-registry.json` has exactly five platform arrays: `socrata`, `arcgis`, `ckan`, `csv`,
`carto`. The ODS Search API is a different shape from all five (records nested under
`records[].fields`, `nhits` for the count, `refine.<field>=` / `q=` filtering), so it cannot ride an
existing connector.

Wiring this endpoint therefore requires a **new additive `sources/opendatasoft.ts`**, an
`opendatasoft` array in the registry, and an `opendatasoftForZip(...)` call in `index.ts` — the same
path `ckan.ts`, `csv.ts` and `carto.ts` each took. That is permitted by site CLAUDE.md §8
("Additive only. A new source adapter is a new branch"), but it is engine code, not configuration,
and it was not what the task described.

**Nothing has been wired.** Only read-only recon target files are committed on this branch.

## The endpoint is live and unusually clean

`https://data.opendatasoft.com/api/records/1.0/search/?dataset=shelby-county-building-and-demolition-permits@datamidsouth`
— **8,751 records**, `records_count` 8,751, `update_frequency` MONTHLY, `data_processed`
2026-07-01. Publisher "Innovate Memphis"; attributions Shelby County / Develop 901.

### Vocabularies are COMPLETE (each sums to exactly 8,751)

**`status`** (3) — `Issued` 4,707 · `Closed - Complete` 4,036 · `Inspection Phase` 8.
A real status field, so `status_to_bucket` applies and `status_const` is NOT needed:
Issued + Inspection Phase → `approved`, Closed - Complete → `operating` (2 buckets).

**`permit_type`** (5, the packet's field) — `Alteration` 3,889 · `New Construction` 1,900 ·
`Accessory Structure` 1,478 · `Demolition` 757 · `Addition` 727. These are WORK CLASSES; they
cannot reach the packet's "≥3 use-types" bar (everything is Development, bar Accessory Structure).

**`record_type`** (9) — the better type source, and also complete:
Residential Alteration 2,373 · Residential New Construction 1,664 · Commercial Alteration 1,516 ·
Residential Accessory Structure 1,237 · Demolition 757 · Residential Addition 655 ·
Commercial Accessory Structure 241 · Commercial New Construction 236 · Commercial Addition 72.
It encodes use AND work class, so it maps to Residential / Commercial / Development = **3 use-types**.

Also available: `propclassdesc` (RESIDENTIAL 5,932 · COMMERCIAL 1,551 · EXEMPT 882 · INDUSTRIAL 283
· FARM/AGRICULTURAL 103) and `prop_lucdesc` (80 assessor land-use codes).

### Geography and scoping are all present

- Native **`zip_code`** (e.g. "38002"), and the ZIP filter is PROVEN three independent ways that
  agree: `refine.zip_code=38002` → **750**, `q=zip_code:38002` → **750**, and Explore v2.1
  `where=zip_code="38002"` → **750**. Control: `refine.zip_code=38117` → 351.
- Per-record **`lat`** / **`lon`** doubles, a `centroid` GeoJSON Point, `geo_point_2d`, and a
  record-level `geometry` Point — no geocoding needed.
- **`date_status`** is a real `date` field (e.g. "2025-10-24").
- `site_address` ("5836 LINDEN OAK DR E, Arlington 38002"), `record_id` ("RES-NEW-26-000019").

### Recommended shape for the build

Prefer the **Explore v2.1** API over Search v1 — it returns a flat `results[]` array with a
SQL-ish `where`, `limit`/`offset`, and `total_count`, which is much closer to the existing
connectors (v1 nests every row under `records[].fields` and caps `rows` at 10,000):
`/api/explore/v2.1/catalog/datasets/<dataset>/records?where=zip_code="<zip>"&limit=100&offset=N`

`record_url` has no per-record column — the Accela portal reference in the dataset metadata
(`https://aca-prod.accela.com/SHELBYCO/Default.aspx`) is a portal root, not a deep link, so this is
a `record_url_precision: "dataset"` entry (the Boulder/Philadelphia precedent).

## Suggested type_map / status_to_bucket (verbatim, ready to use)

```
type_source: record_type
  Residential Alteration Permit          -> Residential
  Residential New Construction Permit    -> Residential
  Residential Accessory Structure Permit -> Residential
  Residential Addition Permit            -> Residential
  Commercial Alteration Permit           -> Commercial
  Commercial New Construction Permit     -> Commercial
  Commercial Accessory Structure Permit  -> Commercial
  Commercial Addition Permit             -> Commercial
  Demolition Permit                      -> Development

status_to_bucket
  approved:  ["Issued", "Inspection Phase"]
  operating: ["Closed - Complete"]
  proposed: []   exclude: []
```

## Coverage

All 41 packet ZIPs are modeled and resolve to **TN / Shelby** — verified against `communities`.
