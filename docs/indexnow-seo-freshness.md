# IndexNow / event-driven SEO freshness

Status: implemented on branch `claude/modest-noether-qgdxu7` (site PR + ingest PR). **Nothing here has
run against production yet.** Every latency below is a derived estimate, not a measurement; the
first production runs are what measure it (see §9).

## 1. The rule

```
SOURCE INGEST
→ authoritative HomeSignal processing / materialization
→ the canonical public page MEANINGFULLY changes
→ the updated page is deployed AND proven live
→ IndexNow notification
```

No public page change = no IndexNow submission. A raw ingest run, a source-evidence acquisition
(Compute Atlas, Epoch AI), a refresh timestamp, a parser or classifier change, a rematerialization,
or a new build day is **not** a page change.

## 2. One page-semantics authority

`scripts/page_semantics.py` is the only place that decides "did this page change?". The renderer
(`scripts/gen_zip_pages.py`) is the only place that decides what a page says; it hands every
document it renders to `PageState`, which fingerprints the **same string** that is written to disk.
There is no second pass over the content and no second definition of applicability.

**Fingerprint** = `sha256` over a projection of the rendered HTML (first 32 hex):

| kept (crawler-visible) | dropped (plumbing) |
|---|---|
| `<title>`, every `<meta name\|property>` (robots, description, og:*, twitter:*) | CSP meta, `<base>`, viewport, charset |
| `<link rel="canonical">`, JSON-LD blocks | stylesheet links, every `<script src>` (so `?v=` cache keys cannot move it) |
| `<body>` with scripts and `<template>` removed | the build day |

Two bookkeeping values would otherwise move pages with no change in public facts, and are neutralized
**for the fingerprint only** (the written page keeps the real value):

* **the build day** ("Compiled from official public records on …", "Updated …"). The renderer is
  handed `BUILD_DAY_TOKEN`; the token is replaced with the day only when the file is written. A content
  date that merely equals the build day is therefore never masked (`test/indexnow-delta.test.mjs` X2).
* **a tracked project's `as_of`**. The plane producer sets it to today for every tracked project on
  every run and documents it as bookkeeping (`bluesky/lib/development-seo-plane.mjs`). Left alone it
  would re-announce ~14,000 project pages every morning. An *untracked* project's `as_of` is a frozen
  fact and still counts.

Also made deterministic: Local News / Government Notice cards now tie-break on URL. `app_changes` is
deleted and reinserted on every ZIP refresh, so two same-day same-title rows could swap places and
make a page "change" with no change.

**State document** `sitemaps/page-state.json` (published inside the artifact, under an already-permitted
generated prefix, so the artifact contract gains no new tree): per canonical URL `{h: fingerprint,
i: indexable, l: lastmod|null}`, plus `state_hash` (identity of `(path, h, i)`), `build_id`,
`source_commit`, `semantic_version`. Tracked families: `/community/<zip>/`, `/city/…`, `/project/…`,
`/guides/…`. Not tracked: `/community/<zip>/projects/` (noindex forever, in no sitemap).

## 3. Previous-live baseline

`pages.yml` job `build` runs `page_semantics.py fetch-baseline` **first**, before anything is built or
deployed, from `https://homesignal.net/sitemaps/page-state.json?cb=<ts>`.

* `?cb=` defeats the Pages CDN (10-minute max-age): a build started minutes after a deploy would
  otherwise read the state from two deploys ago and re-announce pages.
* The document is validated (schema, host, version, every path shape, and `state_hash` must equal the
  hash of its own pages, which catches a truncated file).
* **404 → no baseline → seed.** Anything else (5xx, network, corrupt file) is retried and then **fails
  the build**: an unreadable baseline must never be mistaken for a first run, because a first run
  notifies nothing. Recovery from a corrupt published file: dispatch `pages` with `reseed=true`.
* A baseline from another `semantic_version` is incomparable → reseed, notify nothing.

## 4. The delta (what IndexNow is told)

`compute_delta(previous_live, candidate)`:

| change | submitted? |
|---|---|
| new page | only if index-eligible |
| fingerprint changed | only if index-eligible before **and** after (a noindex page staying noindex has nothing to tell a crawler) |
| indexability flipped (either way) | **yes**: becoming noindex is the one thing a crawler must be told |
| page removed | only if it was index-eligible (so its 404 is discovered) |
| no baseline / other `semantic_version` | **nothing** (installing IndexNow does not announce ~28,000 URLs) |

The set is computed in the build job, before the deploy, from the pre-deploy baseline, and uploaded as
artifact `indexnow-delta`. Nothing is recomputed after the deployment.

The index-eligible set read out of the documents' own robots meta is asserted equal to the sitemap's
Rule F ∪ Rule D set, so the notification set and the sitemap cannot disagree.

## 5. Truthful `lastmod`

Written to `sitemap.xml` and every family sitemap by `finalize()`:

1. project pages: the existing authority, `changed_on`;
2. unchanged fingerprint → the baseline's lastmod, **even when it is null** (never invented);
3. changed → the publication instant (`YYYY-MM-DDTHH:MM:SSZ`);
4. new page with a baseline → publication instant;
5. no baseline (seed) → the page's own source-derived hint, else **omitted**.

At the seed, ZIP / city / guide pages therefore carry **no** lastmod; each acquires one the first time
its content genuinely changes. This is deliberate: the only timestamps available at the seed
(`occurred_at` of the newest item) are lower bounds on a change, not modification times, and
"don't create fake precision" outranks populating the field.

## 6. Publication order, and what a failure can and cannot do

```
build job:   fetch live baseline → stage → fetch Rule D plane → generate (+ semantic state, delta)
             → carry-over of unsent notifications → DECIDE → write key file (main only)
             → all existing gates + crawler proof → artifact hygiene → upload Pages + delta artifact
deploy job:  actions/deploy-pages            (knows nothing about IndexNow)
indexnow job (needs: deploy, success only):
             verify live → submit → receipt
```

`indexnow` verifies, **polling up to 10 minutes**, that the live site serves: `indexnow.txt` equal to
the key; `page-state.json` whose `state_hash` equals the candidate's; the **exact bytes** of an evenly
spaced sample of changed pages (fetched without cache-busting, as a crawler would); and a 404 for a
sample of removed pages. Only then does it POST. If any check never passes, nothing is submitted and the
job is red; the deployed site is untouched.

**IndexNow client** (`scripts/indexnow.py`): endpoint `https://api.indexnow.org/indexnow`, body
`{host, key, keyLocation: https://homesignal.net/indexnow.txt, urlList}`, ≤ 10,000 URLs per POST;
200/202 accepted; 400/403/422 and any other 4xx → hard failure, not retried; 429, 5xx and network errors
→ up to 4 retries with exponential backoff (2,4,8,16 s, `Retry-After` honoured, capped at 60 s).
Only canonical `https://homesignal.net/…` page URLs of the four tracked families can be submitted;
query strings (`homesignalmap.html?zip=`, `community.html?zip=`, tracking), other hosts and previews are
refused in code.

**Key handling.** `INDEXNOW_KEY` (Actions secret, 8–128 of `A-Z a-z 0-9 -`, validated with
`fullmatch`; Python's `$` accepts a trailing newline). It is written to `indexnow.txt` only on main
builds and never on a `pull_request`; the artifact is scanned and the key may appear in exactly one
file. It is never printed or put in a receipt or error. **No key = the build and deploy are unaffected
and IndexNow skips with the reason.** A malformed key never blocks a deploy and turns only the notify
job red.

**Mass-change hold.** If more than half of all pages (and ≥ 1,000) would be notified, that is a
template change or a fingerprint defect, not fresh content: nothing is sent and the job is red. If
intended, dispatch `indexnow-resubmit` with `allow_mass_change=true`.

**Self-healing.** `deploy` precedes `indexnow`, so a failed notification leaves its pages live and
inside the *next* baseline: they would never differ again. The next build therefore reads the previous
pages runs' `indexnow` job results (`actions: read`) and carries over every URL from runs whose
notification did not succeed, stopping at the first run whose notification did (it covered everything
older). Window: 20 runs / 7 days. A backlog forces the next run to publish. `indexnow-resubmit`
(dispatch, main only) re-sends one earlier run's stored delta manually.

## 7. Triggers: when does a public page change get built?

The generator reads the **same read model** a resident-facing page does, so it is the only reliable
"did it land yet?" check. Triggers are therefore *hints*; the detector decides.

| trigger | role |
|---|---|
| `pages.yml` push / daily 06:40 / dispatch | unchanged: always deploys, now with a delta |
| `pages.yml` cron `12,42 * * * *` (**freshness**) | floor. Publishes only if the semantic state differs or the live build is from another commit. GitHub drops scheduled runs on this repo, so this is not the trigger of record |
| ingest `ingest.yml` (every 4 h) | end of run: targeted `app_refresh_zip` for the ZIPs its new notice/news rows land on → dispatch site freshness |
| ingest `ingest-local-news-registry.yml` (every 6 h, 4 shards) | one `freshness` job after **all** shards: same two steps |
| ingest `refresh-development-seo-plane.yml` (daily 05:30, **founder cadence, unchanged**) | after the plane is published → dispatch site freshness |
| site `n5-generation.yml` | when a generation is activated or rolled back → ask ingest to refresh the Rule D plane (its existing authority) |

**Meetings** are read live from `public.meetings` (no materializer): visible to the next freshness build.
**Notices and news** are in `app_changes`, built per ZIP by `app_refresh_zip`; there is no dirty queue
and the background sweep needs ~4 h (measured worst case ~7 h) to come round. So the ingest workflows
call the **existing** `app_refresh_zip` RPC for the affected ZIPs only
(`homesignal-ingest/scripts/refresh_affected_zips.py`):

* affected set = communities that received rows the materializer would render
  (`alerts.created_at >= <run start>`, with the materializer's own predicates), fanned out by the
  chain-**root** walk `app_refresh_zip` itself uses (≤ 6 hops). No point, radius, centroid or ZIP list.
* it uses the root, not the Local News resolver's ZIP set: with `page_target_zip=false` a Local News row
  renders on every ZIP beneath its root, so the resolver set would under-refresh.
* capped (600 ZIPs, 900 s, 2 workers); over the cap it takes the stalest ZIPs first (the sweep's own
  ordering key). The sweep remains the guarantee for the rest, and the 30-minute freshness tick picks
  each up as it lands.
* it never fails an ingest that already succeeded.

**Atlas and Epoch** acquisitions dispatch nothing (pinned in `tests/test_seo_freshness_wiring.py`): they
write source evidence; only the authoritative downstream pipeline may change a public page.

**Development path.** source → `development_reports` (rolling refresh) → `app_projects` → Rule D plane
(daily 05:30) → pages. The plane's cadence is a founder-set value and is **not** changed here; the plane
publish now triggers a site freshness build, and a Map 1 generation activation triggers an early plane
refresh. Development changes between plane refreshes still wait for the next plane refresh.

### Secrets / founder actions (all optional except the first)

| secret | repo | purpose | without it |
|---|---|---|---|
| `INDEXNOW_KEY` | homesignal-site | the key (`openssl rand -hex 16` is valid) | build/deploy fine, IndexNow skips |
| `SITE_DISPATCH_TOKEN` | homesignal-ingest | fine-grained PAT, Actions: write on homesignal-site | latency falls back to the 30-min site tick |
| `INGEST_DISPATCH_TOKEN` | homesignal-site | fine-grained PAT, Actions: write on homesignal-ingest | Rule D plane refreshes at its daily run |

## 8. Cost

* **homesignal-site is public: Actions minutes are free.** A full `pages` run measured 3.3–4.9 min
  (runs 37584663291, 37583392172). A freshness run with nothing to publish stops after the semantic
  comparison and skips Playwright, the upload and the deploy (≈ the fetch + generate share of that).
  Up to 48 ticks + a handful of dispatches per day.
* **Database load**: each freshness run repeats the generator's paginated read (the same one the daily
  build does). ~50–60 reads/day instead of 1. If the DB shows pressure, lengthen the cron; the event
  dispatches do not depend on it.
* **homesignal-ingest is private and its Actions budget was exhausted twice in one 36 h window.** Added
  per fire: one targeted-refresh step (derived: sweep throughput ≈ 380 ZIPs / 100 s, so 600 ZIPs ≈ 2–3 min
  sequential, hard-capped at 15 min) and one tiny dispatch step; the local-news workflow gains two small
  jobs. Order of magnitude ≈ +20–40 runner-minutes/day, hard ceiling ≈ +150. Levers:
  `--limit`, `--budget-seconds` on `refresh_affected_zips.py`.

## 9. Expected latency (derived, to be measured)

| source family | ingest → page live | + IndexNow |
|---|---|---|
| Upcoming Meetings | at the end of the ingest run (≤ ~90 min after its fire) then ~5–8 min build + deploy; with no dispatch token, ≤ 30 min more | + verify (≤ ~2 min typical) |
| Government Notices / Local News (ingest.yml, registry) | same, plus the targeted refresh (≈ 1–3 min) | same |
| Local News beyond the 600-ZIP cap | each ZIP as the sweep reaches it (≤ ~7 h), seen by the next 30-min tick | same |
| Development / Map 1 | plane daily 05:30 → site build ≈ 05:45; or ≈ 20–30 min after a generation activation (with the dispatch tokens) | same |

First production runs should record: freshness-run duration (no-op and publishing), refresh step
duration and ZIP counts, delta sizes, live-verify wait, and IndexNow HTTP statuses (all in the run
summary / receipt artifacts).

## 10. Audits

### Competitor-CTO attack, and what was done

| attack | finding | resolution |
|---|---|---|
| "every project page changes every morning" | tracked `as_of` advances daily (read from the plane producer) | neutralized for the fingerprint; pinned (S, S1) |
| "pages flip when rows reorder" | `app_changes` is rewritten per ZIP; ties had no total order | URL tie-break; pinned (S2) |
| "a failed notify is lost forever" | `deploy` precedes `indexnow`, baseline then already contains the pages | carry-over from earlier runs' stored deltas; pinned (B1–B9) |
| "freshness run swallows a real deploy" | only the newest *pending* run per concurrency group survives, so a freshness run can replace a pending push build; "no semantic change" would then skip the code deploy | `decide()` also requires the live build's commit to equal this one; pinned (R3) |
| "notify before the page is live" | CDN lag | polls for exact bytes of a sample, 404 for removals; nothing posts until proven (W, W4) |
| "stale baseline" | CDN cache | cache-busted read; corrupt file fails closed; reseed escape hatch |
| "template/fingerprint bug blasts 28k URLs" | | mass-change hold, loud, with a manual override |
| "key leaks" | PR runs, logs, artifact | main-only write, never printed, artifact scan, redaction; pinned (V, F, X) |
| "regex `$` accepts `key\n`" | real bug found by test V3 | `fullmatch` everywhere |
| "ingest wrote alerts but the page can't show them" | no dirty queue; sweep 4–7 h | targeted `app_refresh_zip`, then dispatch; detector reads the real read model so a premature dispatch is harmless |
| "Atlas/Epoch raw acquisition treated as public change" | | nothing dispatches from them; pinned |
| "Map 1 activation changes public state without Rule D refresh" | plane is daily | activation → plane refresh (needs token) |
| "a workflow bypasses the system" | | only `pages.yml` deploys; `sitemap.yml` commits go through the same push path |
| "unbounded retries / one failed API takes the site down" | | bounded; separate job after `deploy` |
| "false lastmod" | | moves only with the fingerprint; omitted when unknown |
| "removals / noindex flips not notified" | | notified; pinned (I, J) |

**Not fixed, named:** Development changes between plane refreshes wait for the plane (daily 05:30 is a
founder value). The per-run cap defers Local News beyond 600 ZIPs to the sweep. `INDEXNOW_KEY` and the two
dispatch tokens are founder actions. IndexNow reaches participating engines (Bing, Yandex, Naver,
Seznam, …); **Google does not use IndexNow**, so correct sitemaps, canonicals, internal links and the
truthful lastmod remain the Google path.

### SEO / growth audit

* **Canonical discipline**: unchanged and enforced (self-canonical documents, query-string map URLs out of
  the sitemap, only canonical URLs can be submitted).
* **Sitemap accuracy**: index-eligible set == sitemap set == notification eligibility, asserted in the build.
  The sitemap's `lastmod` is now real instead of absent; this is the signal Google and Bing both rely on
  and previously had nothing true to read.
* **Initial HTML**: notices, meetings, news and Development entities are already server-rendered in the
  initial document; the fingerprint is computed from exactly that, so what is announced is what a crawler
  reads without JavaScript.
* **Titles/meta on change**: ZIP descriptions embed live counts and project titles embed type/year, so a
  material change updates the snippet source, and the fingerprint includes them.
* **Crawl budget**: noindex pages are never announced; a no-op ingest is a zero-URL run; template-wide
  changes are held.
* **Competitive advantage**: bounded by the Development plane's daily cadence and the sweep. Notices,
  meetings and news can reach a search engine within roughly an ingest cycle plus minutes; Development
  within roughly a day, or ~30 minutes after a Map 1 generation switch.
* **Follow-ups (not in this change, not required for correctness)**: a visible truthful "last changed"
  line derived from the state's lastmod; dropping `changefreq`/`priority` from the sitemap now that
  lastmod is truthful; Search Console API submission for Google.
