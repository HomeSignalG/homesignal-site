# Development Map indexing pilot (2026-11-11)

Built locally, NOT deployed. Audit that motivated it: `audit-2026-11-11.md` (this folder).

## What changes on a treated `/map/<zip>/` page

A static section, `#hs-map-zip-summary`, is written OUTSIDE the inert `<template>`
(`scripts/map_zip_summary.py`, called from `scripts/gen_zip_pages.py::MapTemplate.render`). It holds:

- a heading naming the ZIP and place;
- the Rule D plane count for the ZIP, in the plane's own scope ("the same count the ZIP's community page
  uses"), plus a sentence that the interactive map reads records live and shows more record types, so its
  totals can differ;
- up to 10 of the ZIP's project pages (tracked first, newest date), each linking to its canonical
  `/project/…/` page, with Type · lifecycle, the date on record and what kind of date it is, and the
  official record (nofollow);
- links to `/community/<zip>/` and `/community/<zip>/projects/`.

ZIP states, each with its own wording: `counted` (a plane count; zero is stated as "no qualifying projects
in JODY's records, not whether development is happening"), `held` (not measured: no count is stated) and
`absent` (below the Rule D bar, omitted by the plane: "fewer than three"). A ZIP with no Census-drawn area
never gets the section; it keeps its coverage panel.

After JavaScript runs, the runtime moves the section under the map results (`homesignalmap.html`, beside
the existing About block). It stays visible in the ZIP state and is hidden only in the embed. The hero
inside the template drops its own count sentence on treated pages, so the count appears once.

A data-read failure in the browser does not touch the section: it is build-time content.

The ZIP's project-list page (`/community/<zip>/projects/`) gains a "Development map for <zip>" link,
treated ZIPs only.

## Who gets it: `data/seo-map-pilot.json`

| mode | effect |
|---|---|
| `pilot` (committed) | the 100 `treatment` ZIPs only |
| `all` | every standard-area ZIP (the nationwide rollout; NOT enabled) |
| `off` | nobody (rollback with no code change) |

A missing, unreadable or malformed manifest, or a ZIP in both arms, reads as `off`.

Selection (`selection.sql`, read-only, deterministic): groups by the number of authoritative map members
per ZIP (`geo.n5_serving_membership`, 2026-11-11): none, 1–2, 3–20, over 20. For 25 states per group,
picked by hash, one treatment and one control ZIP from the same state and group. 100 + 100 across 47
states. The verbatim output is `selection-output-2026-11-11.json`; the manifest is generated from it by
`python3 scripts/map_zip_summary.py manifest <output>`. Fingerprint md5 of sorted `zip:arm`:
`52606b8aa27889f0a794cd08255ad33c`, equal to the same md5 computed in the database (collate "C").

Manual-request history: not available per URL. The only evidence is the Supabase API log of 2026-11-10:
Google-InspectionTool rendered about 15 map pages between 20:53 and 21:00 UTC. RPC calls are POSTs and the
log does not record the ZIP, so which maps they were is unknown, and either arm may include one. Ask the
founder to check Search Console URL Inspection history for the 200 URLs before the pilot starts and record any.

## Change detection

`scripts/page_semantics.py` already fingerprints everything outside `<template>`. On a treated page the
records are now outside it, so adding, removing or editing one of that ZIP's project pages changes the
fingerprint, the sitemap `<lastmod>` and the IndexNow submit list, for that map only. Same data = no change.
No change to `page_semantics.py` or `indexnow.py` was needed.

Not repaired, stated plainly: a CONTROL map (and every map outside the pilot) still carries no records in
its HTML, so its fingerprint and lastmod still do not move when its data changes. That is the point of
the control, and it is the defect the rollout (`mode: all`) would fix.

Shared changes that reach BOTH arms after deployment: the runtime edit in `homesignalmap.html` (moves the
summary; inert where there is none, but the runtime file name changes on every map page) and the two new
CSS rules. Neither changes any page's fingerprint (scripts and stylesheet links are not fingerprinted), so
no control lastmod moves and nothing is sent to IndexNow for it. The control documents are otherwise
byte-identical to a build with the pilot off (tested).

On the first deploy, expect about 100 map URLs in the IndexNow delta (the treated maps). That is under the
mass-change hold (1,000 URLs and 50%).

## Tests

- `node test/map-zip-summary.test.mjs` (offline, 57 checks; runs in the required unit job)
- `node test/map-zip-summary.browser.test.mjs` (Chromium, 11 checks; needs playwright + leaflet)
- unchanged and green: map-short-route, indexnow-delta, indexnow-rehash-after-overlay, project-pages,
  zip-pages-seo, index-all-audit, focus-sitemap, map-landing-seo (+ browser), zip-map-preview.browser,
  map1-national-plane-failure.browser, place-context-map, and every offline test reading the two workflows.

## Preview (local)

```bash
P=$(mktemp -d)
python3 scripts/stage_site.py --src . --out "$P"
node -e "import('./test/lib/map-zip-summary-fixture.mjs').then(m=>m.build(m.makeDocs(),m.manifest('pilot'),{out:process.argv[1]}))" "$P"
python3 scripts/brand_stage.py --dir "$P" --identity jody
python3 -m http.server -d "$P" 8000
```

Then open `http://127.0.0.1:8000/map/01002/` (treated, counted), `/map/01004/` (held), `/map/01009/`
(absent) and `/map/01003/` (control). This is fixture data; the real 100 ZIPs need the production plane,
which only a runner can read (the `pages` workflow's build job on the PR builds them).

## Deployment (after approval)

1. Open a PR from the branch; let `unit-tests` and the `pages` build job (its gates, including
   `audit_index_all.py`) finish green on the head.
2. Check the `pages` build log for `map summary : mode pilot; 100 /map/<zip>/ documents carry the static
   ZIP summary` and a semantic delta of about 100 changed map URLs.
3. Merge. `pages` deploys, then notifies IndexNow with that delta (the existing job).
4. Do not request indexing for any of the 200 URLs.

## Rollback

- Fastest: set `"mode": "off"` in `data/seo-map-pilot.json` and merge. The next build drops the section and
  the project-list links; the 100 maps change back and IndexNow is told once.
- Full: revert the PR. The runtime edit is inert without the section, so a partial revert is safe too.

## Monitoring handoff (updated 2026-11-12; supersedes the earlier list)

**Deployment.** Commit `f65a0f7` (#2808), merged 2026-11-11 13:18 CST. `pages` push run succeeded 19:18:37Z to 19:29:52Z,
so treatment pages are live from about 2026-11-11 19:30Z. "Post-deployment crawl" means a crawl dated after that.
**Manifests.** Treatment and control (100 each) are `data/seo-map-pilot.json`, selection in `selection-output-2026-11-11.json`.
98402 is in neither arm and is outside the experiment.

**Baselines (Search Console, observed 2026-11-12, map-filtered).** 12,732 discovered, not indexed; 6 crawled, not
indexed; 3 excluded by noindex; about 1 indexed. 98116 (treatment): URL unknown to Google at about 08:09 CST 2026-11-12.
98402 (not in the pilot): crawled, not indexed, last crawl 2026-11-10 14:57, before deployment. Discovery path for 98116
(map sitemap, `sitemap.xml`, `robots.txt`, anchors on `/community/98116/` and `/community/98116/projects/`) was intact.

**Exclusions.** One map URL was manually requested for indexing by the owner more than a week before 2026-11-12 and is the
one indexed map. Its identity is not recorded here; add it to the manifest with this reason when known. Keep it in the
manifest, exclude it from unassisted-success metrics. Search-engine submissions, kept apart:
(1) IndexNow (automatic, by the `pages` job, step 3 above): per the owner's baseline, the 100 treatment map URLs were
submitted on 2026-11-11 after the deploy, followed by five later updates. Those are the owner's recorded facts; the
exact timestamps and the five later updates' contents are in the owner's baseline and were not re-verified or
reproduced in this session. This is an automatic notification, not a manual indexing request, but it means Bing (and
other IndexNow engines) were told about the treatment URLs, so Bing results for them are not unprompted discovery.
Control URLs were not part of it unless a later update says so; check against the owner's baseline before using Bing data.
(2) The daily Bing reminder (routine "Daily 100 Bing URLs") only prints a list of `/community/<zip>/` URLs for the owner
to paste. It lists no `/map/` URLs, and whether the owner actually submitted any of them has not been verified.
Neither item affects the Google measurements, which depend on Search Console only.

**Review dates (reminders created 2026-11-12, 10:00 America/Chicago):** 2026-11-19, 2026-11-26, 2026-12-10, 2026-12-24.
They remind only. No indexing requests, resubmissions, repository work or production changes follow from them.

**Procedure at each review**
1. Authorized Search Console API access: inspect all 200 URLs. Otherwise a fixed, documented sample with its actual size.
   Neither: list the manual checks needed. Never invent results.
2. Record per URL, separately: unknown to Google; discovered, not indexed; crawled, not indexed; excluded by noindex;
   indexed. Keep any other returned status as returned.
3. Per arm, with the eligible denominator (manual-request URLs excluded): count in each status; pages with a first
   observed post-deployment crawl; pages with none (no group median from crawled pages only); indexed pages with date;
   pages indexed earlier and still indexed (retention). Record indexing even if no separate crawl was observed.
4. Compare with the baseline totals above. Keep 98116 in treatment if eligible; draw no group conclusion from one page.
5. Equal crawl rates, even at 14 days, are inconclusive and do not identify a cause or rule out content effects.
6. Also: Bing Webmaster for the same URLs; `sitemaps/map.xml` lastmods (treated move with their records, controls do not).
   Never request indexing or submit URLs for any of the 200.
