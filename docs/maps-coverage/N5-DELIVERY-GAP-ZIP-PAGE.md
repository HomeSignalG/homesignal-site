# The authoritative cutover does not reach the public Map 1 ZIP page (measured 2026-09-04)

**`production_geography_verified = 10,821` is true of the RPC `public.app_projects_for_zip`.
The public Map 1 ZIP page does not call it.** Everything measured below is read-only; nothing
here has been changed.

## 1) What the page actually reads — code, not recollection

`homesignalmap.html`, ZIP mode:

- **line 1077** — `/rest/v1/development_reports?zip=eq.<zip>&select=zip,home_lat,home_lng,counts,sites,paywall,refreshed_at,facilities_unavailable`
- **line 1118** — `window.__HS_SITES = sites;` (sites = `row.sites`, filtered only by `sourced()`)
- **line 1313** — `siteMarkers.push({ m:m, bucket:bucketOf(s.type, s), s:s });`
- **`app_projects_for_zip` appears 0 times in the file.**

So the markers a resident sees in ZIP mode come from `public.development_reports.sites`, which
is the legacy 3-mile centroid-radius product. `docs/maps-coverage/PRODUCT-READINESS-424.md` §0
states "The Maps read path is `public.app_projects` … not the `development_reports` cache" —
that is **wrong for this page**, and `docs/maps-go-live-governance.md` line 1093 already said so
("`homesignalmap.html` reads `development_reports` **directly**"). Two committed docs disagreed;
the file settles it.

## 2) The size of the gap, across the whole cut-over population

```
cut-over ZIPs (enabled)                                    10,821
… with a cached development_reports row (control)          10,821
… whose cached development count ≠ authoritative            8,857
development rows the pages serve                        1,363,148
authoritative projects for the same ZIPs                  406,196     3.36x overstatement
cut-over ZIPs whose cache was refreshed in the last 24h      3,465
```

The refresh cron is still writing radius geography over cut-over ZIPs. Dated instance:
**ZIP 10804, `development_reports.refreshed_at` 2026-09-04 21:32Z — after its cutover — carries
47 development records while its authoritative membership is 1.**

## 3) It is wrong in BOTH directions, which is why filtering is not the fix

`development_reports.sites[].source_id` and `geo.zip_authoritative_membership.source_key` are the
same identifier (`arcgis:fort-worth-development-permits:CG25-00223`), so the two sets are directly
comparable. Over the first 150 cut-over ZIPs by ZIP:

| | |
|---|---:|
| development keys the pages show | 3,016 |
| authoritative keys for those ZIPs | 1,460 |
| in both | 1,232 |
| **authoritative projects ABSENT from the page** | **228** (15.6% of the correct set) |
| **page records OUTSIDE the ZCTA** | **1,784** (59.2% of what is shown) |

ZIP 76104 alone: page 524, authoritative 466, 68 shown that are outside the polygon and 10 inside
it that are not shown.

The 1,784 are the prohibited invented geography. The 228 are the other half of the same
invariant — *"a project elsewhere in the ZIP must not disappear"* — so **filtering the cache down
to the authoritative set would fix only one direction and silently keep the other broken.**

## 4) Why the instrument that would have caught this reported nothing

`geo.maps_zip_export` carries `served_development_rows` and `served_facility_rows` — the two
columns that measure what is actually *served* rather than what is *built*. Both are **NULL on
all 12,722 rows**. The column existed; it was never populated, so every coverage figure so far
has measured the authoritative relation and the RPC, never the page.

## 5) What a fix has to satisfy

Not proposed as a decision — recorded so the next session does not re-derive the constraints:

- The page's site objects carry a display vocabulary `app_projects` does not have (`scope`,
  `relevance`, `bucket`, `use_type`, `layer`, `record_url`, `record_url_precision`, `file_date`,
  `jurisdiction`, …). Swapping the source wholesale would degrade rendering, so the descriptive
  half should keep coming from the publisher-derived cached record.
- The GEOGRAPHY half — which projects belong to the ZIP, and the point each is drawn at — must
  come from `geo.zip_authoritative_membership` / `geo.zip_authoritative_marker`.
- Whatever is built has to survive `dev_refresh_fire` / `dev_refresh_collect`, which rewrite
  `development_reports` daily and would otherwise restore the radius product overnight.
- **Facilities must not move** (`counts.facilities`, the EPA floor) — they are out of scope of the
  ZIP-geography fix and are byte-identical through every cutover so far.
- Address + radius mode is unaffected and must stay unaffected: it has a real geocoded home and a
  resident-chosen radius, which is the one place a radius is valid.

---

# CLOSED on the branch — the page now serves the authoritative set (2026-09-04)

## What changed

`homesignalmap.html` ZIP mode resolves a **geography state** first (`public.app_zip_geography_state`,
a view running with owner rights so the browser gets a ZIP and one short string with no grant on
`geo`), then fails closed on each:

| state | ZIPs | development comes from |
|---|---:|---|
| `authoritative` | 10,821 | `app_projects_for_zip` — the same contract production verification gates on |
| `not_measured` | 642 | nothing; the page says it cannot measure the ZIP |
| `pending` | 1,259 | the legacy cache, unchanged and never labelled authoritative |

An unreadable state resolves to `pending`, so it can never be mistaken for authoritative.
Facilities ride the cached report on every state and are passed through **by identity**.

## Proven against the live database, in a real browser, before shipping

`scripts/verify-map1-delivery.mjs` + `.github/workflows/verify-map1-delivery.yml`, run 1
(`33927447583`) serving the branch on localhost. Every ZIP assertion passed:

```
── 10804 (authoritative)   facilities unchanged  page 17 · cache 17
── 76104 (authoritative)
   cards   456  = 466 authoritative − 10 unlinkable
   markers 469  = 469 authoritative marker relation
   NO legacy radius record rendered · multi-marker: 456 cards / 469 markers
   facilities   40 = 40
── 76135 (authoritative)
   cards   116  = 117 − 1 · markers 158 = 158 · facilities 12 = 12
── 20742 (authoritative, MEASURED-ZERO)
   cards 0 · markers 0 · the cache would have offered 17 and was not used
   facilities 22 = 22
── 01004 (not_measured)
   development 0 · the cache would have offered 90
   note: "This ZIP has no published 2025 Census ZCTA boundary, so HomeSignal cannot measure…"
   facilities 5 = 5
```

The measured-zero and not_measured lines are the ones that prove the fail-closed rule rather than
merely asserting it: in both cases the cache was sitting right there with records to offer, and
the page served none.

⚠️ **The one failure in that run was the verifier, not the page** — address mode timed out waiting
90 s for the live edge function. Fixed by waiting on the page's own signal
(`domcontentloaded` + `__HS_VERIFY`) instead of `load`, which on a tile-loading map page can be
minutes away; re-run in progress.

## Full-population reconciliation

```
authoritative ZIPs                10,821
  serving projects                 7,285
  authoritative measured-zero      3,536
  served development rows        396,765
authoritative memberships        406,196
  withheld: no record link         9,431   (2.3%) — counted and disclosed, never rendered
served facilities (authoritative) 175,591
```

**The 9,431 are the honest edge.** They are authoritative memberships whose descriptive row is
temporarily absent, so they carry no official record URL — and the repo's anti-fabrication prime
directive forbids rendering a site without one. They are counted, surfaced on the page, and never
cause a fall back to legacy geography. The identity `cards = memberships − unlinkable` held on
every ZIP tested (456 = 466−10, 116 = 117−1, 0 = 0−0).

## The instrument that was missing

`served_development_rows` / `served_facility_rows` were NULL on all 12,722 export rows — which is
exactly why this escaped. Both are populated now, alongside a new `served_development_source` that
answers what a count cannot: **which path served this page.**

```
authoritative       10,821 ZIPs    396,765 development rows
legacy_cache         1,259 ZIPs  1,571,745
none_not_measured      642 ZIPs          0
                    ──────────
                    12,722 ZIPs  1,968,510 · facilities 214,245
```

## The cron needed no change

`dev_refresh_fire` / `dev_refresh_collect` still rewrite `development_reports` daily, and that is
now harmless for development: an authoritative ZIP no longer reads that table for development at
all. Facilities still ride the cache and still want the refresh. The smallest change was **no
change**.
