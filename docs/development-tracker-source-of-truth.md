# Development Tracker — Source of Truth (SITE / front-end side)

> Sister document to `docs/community-build-source-of-truth.md` (the alerts build).
> Same philosophy, same autonomy contract, one new page type. Where the alerts doc
> says "a community is one `communities` row and content is decoupled," this doc says
> "a **ZIP development page** is one cached report and the *records* are decoupled."
> Read `community-build-source-of-truth.md` §0/§12/§15 first — this doc only states
> what is **different** for the development tracker.

---

## Claims discipline — verify the field, attach the evidence (read before asserting)

Identical rule to the alerts doc. A `grep`/count is a LEAD, not a fact. Evidence rides
WITH the claim or the claim is marked UNVERIFIED. Quote the source row/line; never
recall it. For this build specifically: **a marker on the map is a claim about a real
place.** If you cannot point to the `get-address-report` field + the `record_url` that
produced a site, that site does not exist — do not render it, do not seed it, do not
assert it in a build report.

---

## 0. THE PRIME DIRECTIVE: development records are DATA the engine returns — never fabricated

The alerts prime directive is "communities are DATA, not code." The development-tracker
prime directive is stricter, because this page makes **factual claims about named real
facilities** (owners, permit filings, EPA violation counts):

**The page renders ONLY what the `get-address-report` edge function returns. The build
never invents, infers, back-fills, or "example"s a development record. A source that has
no real feed yields an EMPTY result, never a plausible one.**

Consequences that are non-negotiable:

- **No hand-authored site data.** The Three.js prototype's inline `sites=[…]` /
  `INTEL=[…]` arrays (Atlas Data Partners LLC, etc.) were **illustrative mock data** and
  are **frozen/dead** — never copy them into a real page, a seed, or the engine. Every
  live marker traces to a `record_url` (EPA FRS/ECHO registry ID, county permit link,
  Utah PMN notice URL).
- **No per-ZIP HTML files.** One dynamic page serves any ZIP by `?zip=` (and the embedded
  address box serves any address). `homesignalmap.html` (the refined Leaflet page) is the
  one page. New ZIP pages are cached rows + a crawlable route, not new files.
- **Empty is valid; fabricated is a defect.** A ZIP with only EPA facilities and no
  planning notices is a complete, shippable page. A ZIP with an invented "proposed
  subdivision" to fill the map is a build failure and a legal exposure (see §10).

If a field isn't in the engine's response, it isn't on the page. Full stop.

---

## 1. The model: two layers + two page modes

Same two-repo/two-layer shape as alerts. The **page is a thin client**; the
**`get-address-report` edge function is the engine** (the development-tracker analog of
`homesignal-ingest`).

| Layer | Owns | Autonomy profile |
|---|---|---|
| **Page** (`homesignalmap.html` + per-ZIP route) | Rendering whatever the engine returns; the SEO landing surface; the address box | **Safe to build overnight** — pure data, one page/report per ZIP, empty-but-valid, mirrors the `communities` batch |
| **Engine** (`get-address-report` edge function + its source registry) | Geocoding, EPA FRS/ECHO pulls, county/PMN planning notices, radius query, the anti-fabrication guarantee | **NOT built blind overnight** — external, per-county, rate-limited; its own ingest-style runbook |

**This document governs the PAGE layer's overnight batch.** Engine coverage expansion
(new counties/states) is a separate, decoupled job (§7.6). The page batch **never blocks
on engine coverage** — that is the whole point (mirrors alerts §12.7).

### The two page modes (both stay — do not drop the address box)

- **ZIP mode = the indexed landing page.** Crawlable route `/development/<zip>` (or
  `homesignalmap.html?zip=<zip>`). Renders the ZIP-level aggregate: facility count,
  approved/proposed counts, open comment windows, and a map centered on the ZIP with its
  located facilities + jurisdiction notices. This is what the batch builds and caches, one
  per ZIP. It must stand alone as real content (an empty search box is thin content and
  will not rank).
- **Address mode = the precision upgrade, embedded on every ZIP page.** The resident lands
  from search on the ZIP page, then types their address for the exact **1-mile-around-my-home**
  view — the core value prop and the conversion moment. Same `get-address-report` call with
  `{address, radius_mi}`, unchanged. A ZIP centroid is nobody's home (Box Elder ZIPs are huge,
  mostly empty land), so the centroid is a page anchor, **not** a "your home" pin — no
  "this address" marker appears until the resident searches.

Funnel: ZIP page (SEO, cached aggregate, real on its own) → address box (personal,
live, 1-mile) → signup.

---

## 2. Sources of truth & precedence (development view)

Highest first; when two disagree the higher wins and the lower is the bug.

| # | Source | Owns | Notes |
|---|---|---|---|
| 1 | **`get-address-report` edge function** (Supabase project `qwnnmljucajnexpxdgxr`) | The live truth of what exists near a point/ZIP. The page displays this verbatim. | The anti-fabrication guarantee lives HERE. A missing source → empty array, never invented rows. |
| 2 | **The engine's public-record sources** | EPA FRS/ECHO/TRI (national, free — the baseline floor); county permit portals + Utah PMN planning notices (per-jurisdiction enrichment) | EPA scales for free to every ZIP; planning feeds are wired per county (§6). |
| 3 | **`development_reports` cache table** | Per-ZIP cached engine output the pages read | Refreshed on a schedule; pages read cache, not live pulls (§8). Address mode stays live (one user call). |
| 4 | **`docs/*.sql`** | Cache-table DDL + any ZIP-page seed | Parked, applied manually in the Supabase SQL editor (same as alerts). |
| 5 | **`homesignalmap.html`** | The one dynamic page (2D Leaflet + 3D views) | The refined `__20_` version is canonical; the Three.js `development-map-desktop` mock is FROZEN/dead (§0). |
| 6 | **`docs/*.md`** | Intent, specs, standing answers | This doc + the alerts source-of-truth. |

---

## 3. The data contract (what the engine returns; what the page reads)

Verified from `homesignalmap.html` (the refined `__20_` page). **Do not assert fields
beyond these without re-reading the live edge function.**

**Address mode (LIVE today):** `POST get-address-report` with
`{ address, radius_mi }` → 
```
{ address, home:{lat,lng}, paywall:bool,
  counts:{ facilities, development, locked },
  sites:[ { label, scope:"point"|"area", type:"built"|"approved"|"proposed",
            layer, lat, lng, url|record_url, violUrl, viol:<count>, src,
            meeting_date, owner, e, n } ] }
```
- `scope:"point"` = a real geolocated facility → pinned on the map.
- `scope:"area"` = a jurisdiction-level notice (county/city-wide, no address) → listed,
  **not** pinned.
- `type` lifecycle buckets: `built` (operating) → `approved` → `proposed`.
- `viol` is a factual count linked to `violUrl` (EPA ECHO) — see §10.

**ZIP mode (BUILT — get-address-report v9, additive branch):**
`POST get-address-report` with `{ zip }` (or `{ zip, lat, lng }` when the batch supplies
the pinned centroid) → same shape plus `mode:"zip"`, where `home` = the ZIP centroid and
`sites` = every point whose location falls in the ZIP **plus** that ZIP's jurisdiction
notices, with `counts` computed ZIP-wide. This result is what §8 caches per ZIP. The
branch is **additive** — address mode (`{address, radius_mi}`) is byte-for-byte unchanged.
ZIP mode **filters to sourced sites only** (a site with no `url`/`record_url` is neither
counted nor returned), so the cache is anti-fabrication-clean at the engine.

---

## 4. RUNBOOK — build the per-ZIP development pages (standing authority, no questions)

Analog of alerts §3/§7. For each ZIP in scope:

1. **Get/refresh the ZIP report** — call `get-address-report` in ZIP mode; upsert the
   result into `development_reports` keyed by `zip` (idempotent, §8). Empty `sites` is a
   valid, shippable report.
2. **Verify it resolves** — the crawlable route `/development/<zip>` (or `?zip=<zip>`)
   loads, centers on the ZIP centroid, renders the aggregate counts, and every rendered
   site carries a `record_url`. No facilities is expected for some ZIPs; that is done, not
   broken.
3. **Confirm the address box works on that page** — typing a covered address returns the
   live 1-mile view (address mode, unchanged).
4. **Commit the cache seed** — `docs/<place>-development-reports-seed.sql` (idempotent,
   mirrors the alerts seeds), so any run is reproducible.

**Do NOT** create a `<zip>.html`, and **do NOT** resurrect the Three.js mock's inline
data. **Do NOT** hand-edit a report row to add a record the engine didn't return (§0).

**Definition of DONE — run to a GREEN DEPLOY, do not stop early** (identical contract to
alerts §15): reports applied + resolution probe passes → seed committed → standing answers
updated if a new question arose → PR opened and squash-merged to `main` → Pages deploy
green → `verify-development` CI green (fix + re-run until green). Only then report done,
with numbers.

---

## 5. STEP 0 — front-load permissions & environment (do once, then no prompts)

Identical to alerts Step 0. Self-check `cat .claude/settings.json`. Requirements:

1. **Bypass permissions** mode (repo ships `.claude/settings.json` with
   `defaultMode: bypassPermissions` + allow-list). Fresh session boots clean.
2. **Supabase MCP** in scope (for the cache upserts + reading the edge function).
3. **Network egress** matters here more than for alerts: the ZIP-mode refresh calls the
   edge function, which calls Census/EPA. For the **page batch** reading cache, egress is
   not needed; for a **cache refresh** run, the runner needs to reach the edge function
   (it runs in CI where egress works — same pattern as `verify-communities`). If the build
   sandbox has no egress, invoke the engine server-side via `pg_net` from SQL (see §6).
4. **Pin the ZIP dataset** (§7.1) — the authoritative ZIP list + centroid crosswalk, with
   vintage. A guessed ZIP or centroid is the one error this build exists to prevent.

If any environment setting is unset, do the part you can and note precisely what is
deferred. Never silently skip.

---

## 6. No-stop standing answers (development side)

These convert every foreseeable "should I ask?" into "no — do this." Add to this list
(and `CLAUDE.md`) in the same build whenever a new one surfaces.

- **A ZIP with EPA facilities but no planning feed → SHIP IT (facilities-only page).**
  EPA FRS/ECHO is national and free, so every ZIP gets at least a facilities view. Planning
  notices are per-jurisdiction enrichment. A county with no verified planning feed still
  ships — it does not block, does not fabricate, does not stop. (This is alerts' "empty gov
  tile is valid," transplanted.)
- **A ZIP with NO records at all → still ship a valid page.** It shows the ZIP centroid map,
  zeroed counts, the honest empty-state copy already in the page ("No EPA-registered facility
  within a mile"), and the address box. Empty is valid.
- **ZIP centroid vs a resident's home → the centroid is a page anchor, not a home pin.**
  No "this address" marker until the resident searches. Never treat the centroid as an
  address-mode result.
- **A cross-county / multi-place ZIP → one ZIP page.** Label it with every place; center on
  the ZIP centroid; include all points that fall in it. Don't split it or pick one city.
  (Mirrors the alerts multi-city-ZIP rule.)
- **A facility that geocodes outside the ZIP boundary → exclude from ZIP mode, keep for
  address mode.** ZIP mode contains only points inside the ZIP; address mode is radius-based
  and legitimately crosses ZIP lines. Not a stop.
- **A source returns an error / times out for one ZIP → quarantine that ZIP + log, continue.**
  Never fabricate to cover a gap; never hard-stop the batch for one bad ZIP (§7.2).
- **`counts.locked` / `paywall` present → render as the page already does.** The paywall is
  a product decision already built into the page; the batch does not change it.
- **No ZIP polygon available → approximate the ZIP as centroid + radius. Not a stop.**
  ZIP mode has no shapefile, so it scopes facilities to a radius around the pinned centroid
  (`ZIP_RADIUS_MI`, default 3 mi). Polygon-precise boundary clipping is a decoupled engine
  enrichment (§7.6), not a page-batch blocker. The centroid is always the PINNED value
  (§7.1), never guessed.
- **ZIP-mode centroid delivery → the batch passes the pinned centroid as `{zip,lat,lng}`.**
  The engine also carries a small built-in centroid map for pilot ZIPs so a bare `{zip}`
  resolves; either way the value is the pinned dataset's, and an unknown ZIP returns 422
  (never a guessed point) — that is quarantine, not a stop.
- **`homesignalmap.html` (the canonical page) absent from the repo → build it from the §3
  contract; not a stop.** The page is a thin client over the verified data contract; a
  missing bootstrap file is a build task, not a schema/legal question. Never resurrect the
  Three.js mock to fill it (§0).
- **Sandbox has no egress to Supabase/EPA → populate the cache server-side via `pg_net`.**
  Invoke `get-address-report` from SQL (`net.http_post(...)`, then upsert
  `net._http_response.content`). Postgres has egress even when the sandbox does not — this
  is the caching analog of "verify runs in CI where egress works." Not a stop.
- **The engine's planning notices are currently Box Elder-County-only → only Box Elder ZIPs
  are cacheable today.** `devSites` in `get-address-report` is hardcoded to
  `BOX_ELDER_COMMUNITY_ID`; EPA facilities are national but the planning notices always come
  from Box Elder. Caching a non-Box-Elder ZIP would attach Box Elder's hearings to it — a
  fabrication-class defect (§0). This is a real **engine-coverage boundary**, not a stop: cache
  the county whose feed is wired, and un-hardcode + wire the next county's notice feed (ingest
  side, §7.6) before caching it. The page batch never fabricates to cross that line.
- **At batch/county scale the seed is a reproducible pg_net REFRESH SCRIPT, not a literal
  snapshot.** A one-ZIP literal is fine, but a whole county (18 ZIPs × ~40-64 sites, mostly the
  same county notices repeated per ZIP) is ~220 KB of engine output; embedding it as hand-copied
  JSON is the "hand-authored site data" §0 warns against and no more reproducible. The seed pins
  the ZIP centroids (§7.1) and re-invokes the engine (fire via `pg_net` → upsert the 200s), so
  re-applying rebuilds from the source of truth. This is the shape §7's national batch uses.
- **Development ZIP pages are in the sitemap zero-touch.** `scripts/gen_sitemap.py` emits one
  `homesignalmap.html?zip=<zip>` per `development_reports` row, so newly-cached ZIPs become
  indexable with no per-ZIP edit; the daily `sitemap.yml` workflow republishes.

---

## 7. Batch runbook (100 → national) — the unattended page build

Mirrors alerts §12. Nothing about the model changes — a ZIP page is one cached report; a
batch is many, refreshed idempotently, validated, verified programmatically.

### 7.1 The one thing never guessed: the ZIP master dataset
Pin at Step 0 and freeze in-repo with source + vintage: the authoritative **ZIP list +
centroid** (Census ZCTA gazetteer/centroids or a maintained crosswalk — confirm the exact
file + vintage; **ZCTA ≠ USPS ZIP**, pick one and pin it). A guessed ZIP or centroid is the
one integrity error this build prevents. If it can't be pinned, that's a Step-0 STOP.
**Pinned for this build:** the `zipcodes` PyPI package **v3.0.0** (bundled offline USPS
dataset — the same source the alerts builds pin, community-build §12.0). 84302 →
(41.5079, -112.0152).

### 7.2 Validation gates — quarantine, don't stop
Before caching each ZIP report: `zip` matches `^\d{5}$`; centroid present and within the
state bbox; engine response parsed (not an error body); every `site` has `scope`, `type`,
and — for anything rendered — a `record_url`. A failing ZIP is written to a quarantine log
and SKIPPED; the batch continues. **A run with quarantined ZIPs is still a success** — the
quarantine set is the only human follow-up.

### 7.3 Idempotent, resumable load
Upsert `development_reports` keyed on `zip` with `on conflict (zip) do update` **only when
the refresh is newer** (never blind-clobber). Log per chunk: refreshed / skipped-fresh /
quarantined + running totals. The log is the resume state — safe to resume after any timeout.

### 7.4 Verify at scale — programmatic, not tens of thousands of page loads
- **Count reconciliation:** cached ZIPs == valid seed ZIPs − skipped.
- **Resolution probe:** random sample + every county boundary — `/development/<zip>` centers
  on the right centroid and its count matches the cached `counts.facilities`.
- **Anti-fabrication probe (the important one):** for the sample, assert **every rendered
  `site` has a non-empty `record_url`.** No source → fail that ZIP (§9).

### 7.5 The overnight operating contract
Validate → refresh/cache idempotently → verify → log. Deliverable = the cache rows + a run
log (refreshed / skipped / quarantined / verified). **NEVER pauses for:** empty reports,
ZIPs with no planning feed, one bad ZIP (quarantine), or an ordinary cross-county ZIP.
**STOPS only for** (extends alerts §10, kept tiny): the ZIP dataset unavailable/unverified;
a schema need beyond the known cache columns; anything touching secrets/PII/subscriber data;
a systematic legal/framing question (§10). Everything else logs and continues.

### 7.6 Engine coverage is decoupled — never block the page batch on it
A ZIP page is live the moment its report row exists (empty is valid). Wiring **new**
county/state planning feeds into the engine is an engine-side scale problem with its own
ingest-style runbook (pinned sources, quarantine, cache). Do not hold the page batch
waiting on feed coverage.

---

## 8. The cache layer + a pre-existing security flag

The pages read cached per-ZIP reports so views don't hit Census/EPA live. DDL:
`docs/development-reports-cache.sql` (shipped alongside this doc). Address mode stays live
(one user-driven call).

⚠️ **Pre-existing flag (carried from the alerts CLAUDE.md):** `public.page_cache` has **RLS
disabled** — anyone with the anon key can read/write it. **Do not model the new
`development_reports` table on it.** Ship `development_reports` with **RLS enabled**: a
public `select` policy (the reports are public data the page reads with the anon key) and
**no anon `insert`/`update`** (only the service-role refresh job writes). Resolve this at
Step 0 — a batch that writes to an anon-writable cache is a Step-0 security stop.

---

## 9. Verification (CI, where egress works) — the anti-fabrication invariant

Analog of `verify-communities`. `scripts/verify-development.mjs` +
`.github/workflows/verify-development.yml` run on a GitHub runner (egress works there),
read the live ZIP list, and per sampled ZIP assert:

1. `/development/<zip>` loads and the map inits (centers on the ZIP centroid).
2. The engine (or cache) returns a parseable report; rendered facility count ==
   `counts.facilities`.
3. **Every rendered `site` carries a non-empty `record_url`** — the machine-enforced
   version of "never fabricate." A rendered site with no source URL **fails the run**.

`gov=0`/empty is valid (report, don't fail), exactly as the alerts verifier treats an empty
government tile. Runs daily + on `main` pushes touching the page/seed/script + on demand.
(The live route is `homesignalmap.html?zip={zip}`; set `ZIP_PATH` accordingly — the workflow
does.)

---

## 10. Legal framing — founder signs off ONCE, then it's a standing answer

The page already carries the right posture: violations are a **factual count linked to the
official EPA ECHO record — not a verdict on any operator**, and every item links to its
public source. Naming private facilities + violation counts at national scale is exactly the
category the alerts doc reserves as a real STOP (legal/consent). Resolve it **once, up
front**, so it never becomes a nightly judgment call:

- Render the public fact + the authoritative link. **Do not** editorialize a named operator
  into wrongdoing beyond what the record states.
- Keep the existing disclaimer copy on every page (sources line + "not a verdict").
- The interpretive/"INTEL" prose from the mock is **not** auto-generated at scale — it is
  templated from verified engine fields only, or omitted. No generated editorial claims per
  ZIP.

Once the founder signs off on this framing, it is a standing answer; the batch does not
re-litigate it.

---

## 11. Definition of DONE (all true before reporting done)

1. **Reports cached** — one `development_reports` row per in-scope ZIP; resolution +
   anti-fabrication probes pass (§7.4).
2. **Seed committed** — `docs/<place>-development-reports-seed.sql` on the assigned branch.
3. **Standing answers current** — any new question added to §6 + `CLAUDE.md` this build.
4. **Deployed** — PR opened and squash-merged to `main` (pre-authorized).
5. **Pages deploy green** for the merge commit.
6. **`verify-development` green** — fix + re-run until green.

Only after box 6: report done, with numbers (ZIPs cached, facility/proposed totals,
quarantined ZIPs) and any deferred engine-coverage item **noted, not blocking**.

---

## 12. Still stop and ask (the only real exceptions — kept tiny)

A build pauses **only** for: the ZIP master dataset unavailable or its vintage unverified;
a schema/DDL need beyond the known cache columns (including anything ZIP-mode needs beyond a
query change, §3); anything touching secrets/PII/subscriber data or the RLS posture (§8); a
destructive change; or a legal/framing change not covered by §10's one-time sign-off.
**Everything else — "should I deploy?", "is it done?", "this ZIP has no records", "a county
has no planning feed", "one ZIP errored" — is answered above: do not stop.**

---

### Provenance
Data contract in §3 verified against `homesignalmap.html` (the refined `__20_` page):
`ENDPOINT`/`APIKEY` config; `run()`/`render()` request+response handling; the `sites[]`
field set (`scope`, `type`, `layer`, `viol`, `record_url`, `meeting_date`, `e`/`n`);
`counts:{facilities,development,locked}`; `paywall`; the sources + "not a verdict" footer
copy. ZIP mode (§3) is BUILT as an additive branch in `get-address-report` v9 (address mode
unchanged) and verified live for 84302 (facilities 23 · development 41, 0 unsourced). The
Three.js `development-map-desktop` page is confirmed **illustrative mock data** and is
frozen/dead. Re-verify before relying on any line/field — the code and the live DB are the truth.
