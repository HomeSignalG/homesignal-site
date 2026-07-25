# Gate 2 — Street / Satellite / Focus parity harness (INCOMPLETE)

Real-Chromium harness for `maps.html` at Del Valle 78617. Drives the page through its
own `?data=seed` + `window.HS_SEED` path so `lib/data.js`, `lib/map.js`, the marker
resolver, the mode switch, the legend, the popups and the filters all run unmodified —
nothing internal is monkey-patched.

* `rows.tsv`      — 39 PRODUCTION rows exported verbatim from `app_projects` (zip 78617):
                    record_kind | registry_id | type | status | lat | lng | url-token | name.
                    Spans every category, both Austin sources, all 5 TABS filings and
                    EPA facilities. Evidence URLs are reconstructed from the real
                    per-record token using each source's real URL pattern.
* `seed78617.mjs` — builds `window.HS_SEED` from `rows.tsv`.
* `gate2.mjs`     — launches Chromium, switches Street → Satellite → Focus, and collects
                    marker/category/lifecycle/symbol/legend/filter/console metrics per
                    mode plus the mode-independent resolver truth table.

## BLOCKER 1 — seed injection — FIXED ✅

`ctx.addInitScript()` was overwritten by the page's own `<script src="seed/delvalle.js">`.
The harness now intercepts that exact request in `ctx.route()` and serves the Del Valle
payload through the page's REAL seed-loading path. maps.html / lib/data.js / lib/map.js
are unmodified; no rendering internal is patched.

Proven by the harness's own pre-parity seed gate, which refuses to measure anything
unless all of these hold (last run: all PASS):

    seedIntercepted   true
    __HS_SEED_SOURCE  "gate2-delvalle-78617"   (not the bundled demo seed)
    projects          33      facilities 6      tabs 5
    registry_ids      (none), austin-site-plan-cases, austin-subdivision-cases
    kinds             development, facility
    demo_leak         0       DATA_SOURCE 'seed'
    seed sha256       7a5ff33d723746dc606fc0905c0eca7ab2ec0421059f7ac8070e847851ff0606

## BLOCKER 2 — page plots 0 records from the injected seed — OPEN ❌

With the correct seed loaded and validated, `window.__HS_MAP.items` is **0 in all three
modes**, and the visible container stays `#mapSch` even after clicking
`#mapMode button[data-mode=satellite|impact]`. The legend and lifecycle chips render
correctly (7 categories + facility; proposed/approved/operating/unknown), so lib/map.js
is fine — the seed rows are being dropped upstream of plotting.

Next step: the seed rows are shaped from `app_projects` columns, but the seed path in
`lib/data.js` returns them through `withDistance(rows, home)` WITHOUT `normProject()`,
so any field the render path expects to have been normalized (distance/home resolution,
`id` type, or a field `maps.html` filters on before plotting) is absent. Instrument
`lib/data.js::projects()`/`facilities()` return values in the browser, diff one seed row
against one row the bundled demo seed produces, and add the missing field(s) to
`seed78617.mjs` — the fix belongs in the HARNESS SEED SHAPE, not in production code.

Until then Gate 2 remains FAIL: the dataset is right, the plot is empty, so no parity
claim can be made.

Run: `node scripts/gate2/gate2.mjs` (needs playwright + leaflet + @supabase/supabase-js
installed in the working directory; browser at /opt/pw-browsers/chromium-1194).

## STEP 1 RESULT — the working seed contract, captured live (probe-seed-contract.mjs)

Run against the page's OWN bundled `seed/delvalle.js`, nothing injected, 0 page errors.

`window.HS_SEED` top-level keys (9):
    community, demoUser, properties, projects, changes, meetings,
    environmental_risk, coverage, topicCategories

`HS_SEED.community` (the home/origin object):
    zip slug name city county state covered lat lng community_score
    growth_pressure value_trend component_scores civic_activity blurb
    -> lat 30.1745 / lng -97.6134  (this is the origin `withDistance(rows, home)` uses)

`HS_SEED.projects[0]` contract — 19 keys, all present on the working record:
    id(string) name(string) type(string) status(string) stage(string) lens(string)
    developer(string) size(string) investment(string) jobs(string)
    submitted_at(string) lat(number) lng(number) impact_score(number)
    impact_dimensions(array) source_ref(string) sowhat(string) approx(boolean)
    note(string)

NOTE: the working demo project row has NO `record_kind`, NO `registry_id`, NO `zip`.
`HS_SEED.facilities` does not exist in the bundled seed (facilities_n = 0), so the
facilities key is optional and facility-ness is carried by `_facility`.

### Field delta vs the harness rows that plotted zero

Missing from `scripts/gate2/seed78617.mjs` output:
  * HS_SEED top level : demoUser, properties, topicCategories
  * HS_SEED.community : covered, lat, lng, slug, city (harness supplied only
                        zip/name/county/state)
  * HS_SEED.coverage  : name
  * project rows      : lens, impact_dimensions, sowhat, approx, note

## STEP 2 — NOT DONE

The drop point has NOT been instrumented, so no causal claim is made here. The field
delta above is an observation, not a proven cause. Step 2 must trace the 39 rows through
HS_SEED -> lib/data.js seed branch -> withDistance(rows, home) -> pre-plot collection ->
__HS_MAP.items and report count-in/count-out and the first rejected record at each stage.
