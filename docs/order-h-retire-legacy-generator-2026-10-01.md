# Order H, first step: the legacy browser-direct report generator leaves the customer artifact (2026-10-01)

Plan: `docs/development-activity-plan-2026-09-30.md`, Order H ("Remove the customer quota bypass", lines 2398-2402), the
"One canonical generation path" rule (lines 1976-1987) and Hard Rule 24 (line 2548). Rulings: R6
(`docs/development-activity-founder-rulings-2026-09-30.md`). Status: `docs/development-activity-status-2026-09-30.md`.

## 0. What a person sees

**Anyone holding the URL of the old New York City report page gets a plain 404 after this deploys.** That includes every copied
share link (`?address=...`) and the founder's own `?audience=internal` views (Coverage, Listing, Portfolio, Usage), which the page's own
comment says are presentation and not access control. Nothing else a resident or customer sees changes: the navigation, the landing page,
`sitemap.xml`, Map 1 and the Enterprise page (`development-activity.html`) are untouched, and no page ever linked to the old one.

It is reversible by re-adding one line, `'future-surroundings-report.html',`, to `ROOT_FILES` in `scripts/stage_site.py`.

**This is the audit's founder decision 1 taken at its stated default, and it is awaiting confirmation.** The decision is: retire the
legacy page from production rather than keep it as an internal diagnostic surface. The plan allows either (lines 1980-1983) and R6 does
not choose. The default is retire, because a static host has no server-side way to gate a page and the page's own comment says
`?audience=internal` is presentation. Keeping it live needs an admin-gated surface, which is new DDL (an admin RPC) and is not part of this change.

## 1. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path** (read from the tree, not from memory; the audit's wording, re-checked here):
  customer address -> `geocode-address` (JWT; the anon key passes it) -> `public.canonical_zip_registry` (12,722) ->
  `public.n5_projects_within_radius` -> `public.app_projects` hydrate and `dev_change_project` / `dev_change_event_reportable` /
  `dev_change_source_health` -> `supabase/functions/_shared/national-report.ts` (composition), filtered by
  `supabase/functions/_shared/report-rights.json` (`"cleared": []`) -> `get-development-activity-report` ->
  (not wired yet) `report_snapshot_issue` + `report_private_context`.
- **Decision owners**, none of them touched by this change:

  | question | owner |
  |---|---|
  | who may generate a report | `supabase/functions/_shared/admin-gate.ts::authorizeAdmin` today; the entitlement check replaces `isAdmin` there at Orders K and L |
  | what may be shown | `supabase/functions/_shared/report-rights.json` |
  | which surfaces ship to production | `scripts/stage_site.py` `ROOT_FILES` and `TREES` (the Fix 19 allowlist) |

  The only owner this change edits is the third: it is the one decision about "which surfaces ship", and it edits it in the direction the
  allowlist fails closed (a path ships only if named).
- **Shortcut check.** This change adds no engine, no gate, no endpoint, no page and no caller. It removes a path from the artifact.
  Searches, run in this worktree at `ea0d1db` before editing:

  ```
  G1  grep -rnE "get-development-activity-report|get-future-surroundings-report|follow-development-report" \
        --include=*.html --include=*.js --include=*.json . | grep -vE "^\./(test|docs|supabase|scripts|node_modules|\.git|\.claude)/"
      -> 0 lines          (no browser-shipped file calls any of the three server functions)
  G1 control: the same pattern over --include=*.ts --include=*.mjs --include=*.toml --include=*.yml
      -> supabase/config.toml, supabase/functions/follow-development-report/{index,handler,data}.ts,
         supabase/functions/get-development-activity-report/{index,handler,data}.ts, supabase/functions/_shared/change-reads.ts, ...
         (the pattern matches real text, so the 0 above is not an empty search)
  G2  grep -rlE "data\.cityofnewyork\.us" --include=*.html --include=*.js --include=*.json . | grep -vE "^\./(test|docs|supabase|scripts|...)/"
      -> future-surroundings-report.html, lib/nyc-v1-report.js, lib/nyc-v1-soda.js, lib/fsr-scale.js
         (the legacy page and its three libraries: the only browser-side code that names the City's host)
  ```

  So today exactly one shipped page can generate a report, it does so in the browser against a third-party host, and no HomeSignal
  server sees the request. That is the bypass. After this change no shipped page generates a report and no shipped page calls a
  report-generating server function, and a test (section 4) fails if either comes back.
- **Review question** ("one canonical truth path, or a second way to decide the same fact?"): this change creates no second way. It
  removes the only browser-side generator from the artifact and pins that none returns outside the gated path.

## 2. What changes

| file | change |
|---|---|
| `scripts/stage_site.py` | the entry `'future-surroundings-report.html'` leaves `ROOT_FILES`; a dated comment records why and how to reverse it |
| `test/nyc-v1-report.test.mjs` | pin 5f flips from "page ships" to "page does not ship"; 5e, 5g, 5h unchanged |
| `test/single-customer-generation-path.test.mjs` (new) | scans the real staged artifact by content (section 4) |
| `test/single_customer_generation_path_mutants.py` (new) | 16 prohibited mutations (the audit's seven, M1-M7, plus nine that close gaps in the same pins), each measured on exit code and required to be killed by the pin it targets (manual, like the other mutation loops) |
| `docs/development-activity-status-2026-09-30.md` | Order H line: customer surface retired; the onto-the-canonical-path half waits on K and L; **H stays open** |
| `docs/future-surroundings-report-checkpoint-2026-09-27.md` | dated annotation on the "Deploy the page" and "Deploy the edge function" rows only |
| this file | the design, the decisions taken by default, the receipt |

## 3. What does NOT change (R6 and the audit's scope)

- `future-surroundings-report.html`, `lib/nyc-v1-report.js`, `lib/nyc-v1-soda.js` and `lib/fsr-scale.js` are not deleted, renamed or edited.
  The page and its libraries stay in the repository, still run locally, and the browser suite (`test/fsr-audience.browser.test.mjs`,
  which serves the repo tree and not the artifact) still exercises them.
- `lib/` still ships whole (`TREES['lib']`), so the three legacy libraries are still served as inert scripts. A static host cannot make a
  client script a security boundary and the City's data stays publicly queryable. **The control is that HomeSignal serves no customer
  surface that generates a report and promises no quota against one, not that the data is unreachable.**
- `robots.txt` keeps `Disallow: /future-surroundings-report.html` (pin 5e). It is harmless on a 404 and protects the URL if the line is re-added.
- `supabase/functions/get-future-surroundings-report/` and its `verify_jwt = true` entry are not touched. No workflow is edited and nothing is deployed.

## 4. The new pin suite, and why it reads content and not names

`test/single-customer-generation-path.test.mjs` runs the real producer (`scripts/stage_site.py --out <tmp>`, the command `pages.yml`
runs) and reads the files it actually wrote. A check on file names would pass a renamed copy of the legacy page; a check on content
does not.

- **P1, the instrument ran.** The staged tree holds at least 20 pages and more than 40 files, `development-activity.html` and `index.html`
  are among them, and every scanned page was read with a non-zero size. An empty or wrong source directory fails here, not silently.
- **P2, the page is retired and not deleted.** `future-surroundings-report.html` is not staged; the file and the three libraries still exist
  in the repository (R6); the staged `robots.txt` still Disallows the URL; and no staged file other than `robots.txt` names the page
  (positive control: the same detector finds the page's own self-links in the unstaged repo copy).
- **P3, no staged page loads or names the browser-direct engine.** In every staged file except the three legacy libraries themselves:
  no `data.cityofnewyork.us`, `nyc-v1-soda`, `nyc-v1-report`, `HSNycV1` or `HSNycV1Soda`. Positive control: the same patterns do match
  inside the three exempt libraries, so a regex that stops matching fails the suite instead of reading as clean.
- **P4, the customer-callable allowlist is empty.** No staged file names `get-future-surroundings-report`, `get-development-activity-report`
  or `follow-development-report`. Positive control: the same patterns match `supabase/config.toml`. When Orders K and L put a customer
  surface on the national path, that edit is deliberate and belongs beside the entitlement gate pin (`test/national-report-structure.test.mjs`
  and `_shared/admin-gate.ts`), not a quiet addition.
  **Stated limit:** P4 finds the ordinary spelling of a slug. A page that builds the name by concatenation is not caught; the authority is
  the gate in `admin-gate.ts` (an anon-key caller is refused 401), not this scan.

## 5. Decisions taken by default (the founder may change any of them)

1. **Retire the legacy page from production** rather than keep it as an internal surface (the audit's decision 1, default taken).
   The founder should also say whether the internal Coverage / Listing / Portfolio / Usage views must stay reachable in production. Whether anyone
   relies on them is **UNVERIFIED**: the page loads no analytics (`events.js` is absent), so visitor traffic is unmeasurable.
2. **Map 1 address mode (`get-address-report`, `verify_jwt = false`) and the property dossier are outside Hard Rule 24** (the audit's decision 2,
   default taken): they produce no stored, shareable, client-ready report. Nothing in this change enforces or relies on that; it only records
   that nothing was changed for them.
3. **The separate hardening of the legacy edge function is not authorized and not done** (the audit's decision 3). `get-future-surroundings-report`
   is not deployed (read by the audit from `list_edge_functions`, 2026-10-01; **not re-read here, the sandbox has no network tool**). Its
   source answers CORS `*` with no auth check, and the public anon key is a validly signed token that passes `verify_jwt = true`. The checkpoint
   tells the founder to dispatch it for this slug; the dated annotation added here says **do not**, until that function gets the admin gate or
   the slug is refused by the deploy workflow. Both would touch a function R6 says to leave alone and a workflow, so they are a separate decision.

## 6. What this does not do (so H is not struck)

- It does not make the quota server-authoritative. No customer identity, entitlement, credit ledger, idempotency or rate limit exists
  (Orders K, J, L, M). Nothing authorizes a customer on the canonical path, which today admits only a signed-in user in `dashboard_admins`.
- It does not move customers onto the national path: the rights registry is empty, so a customer report there is LIMITED COVERAGE with no records.
- It builds no customer report page (Order I) and answers no R5 question.

**Order H stays open.** The status file says what was done and what waits.

## 7. Rollback

Re-add `'future-surroundings-report.html',` to `ROOT_FILES` in `scripts/stage_site.py` and flip pins 5f and P2 back. `pages.yml` triggers on
`scripts/stage_site.py`, so the revert deploys on merge, the same as this change does.

## 8. Proof (each line is a command run in this worktree at base `ea0d1db`, with the decisive output)

**What the artifact contains, before and after** (`python3 scripts/stage_site.py --list-only`, captured before the edit and after it):

```
before: 76 paths   after: 75 paths
diff before after:   21d20 < future-surroundings-report.html        (the only difference)
still staged after:  lib/fsr-scale.js  lib/nyc-v1-report.js  lib/nyc-v1-soda.js  development-activity.html  robots.txt
```

**The new pin suite** (`node test/single-customer-generation-path.test.mjs`): exit 0, `ALL PASS`, 23 checks. The instrument lines it prints:
`P1b the artifact holds at least 20 pages ... (27 pages)` · `P1c ... at least 40 files (75 files)` ·
`P1e every text file was read with a non-zero size (72 read, 0 empty)` · `P1f the staged tree equals what --list-only reports`.
It scans the files `stage_site.py --out` actually wrote, and 27 pages is the 28 before minus the retired one.

**The flipped pin** (`node test/nyc-v1-report.test.mjs`): exit 0, 120 PASS, `ALL PASSED`; `5f page does not ship (retired from the artifact; order H)`
with `5e`, `5g`, `5h` unchanged and passing.

**The mutations** (`python3 test/single_customer_generation_path_mutants.py`, exit 0):

```
16 mutations run, 16 killed by the pin they target, 0 survived, 0 harness faults
```

Each line names the pin it was written to hit and the run requires that pin among the failing checks, so a mutation killed only by an unrelated
failure is a harness fault and not a kill. Every mutation's anchor must match exactly once, or the file it creates or deletes must be as stated,
or the run stops: a mutation that did not apply cannot be told from a survivor. The tree is restored after every mutation and after the run
(`git status --short` listed the same five paths before and after the run: the two edited files and the three new ones). The audit's seven:

| mutation | killed by |
|---|---|
| M1 re-add the page to `ROOT_FILES` | P2a, P3 and `nyc-v1-report` 5f |
| M2 add `https://data.cityofnewyork.us` to a shipped page's CSP | P3 |
| M3 add `<script src="lib/nyc-v1-soda.js">` to a shipped page | P3 |
| M4 add `functions.invoke('get-development-activity-report')` to a shipped page | P4 |
| M5 stage a renamed copy of the legacy page that names the legacy page nowhere | P3 (by content) |
| M6 delete the legacy page file | P2b (the R6 control) and `nyc-v1-report` 5h |
| M7 point the scanner at an empty directory | P1a |

M8-M16: the other two server slugs, a new lib that loads the engine global, the robots line dropped (P2d, 5e), a shipped page linking to the retired page
(P2e), a legacy library deleted (P2c), the host detector neutered (P3d, P3e), the slug detector neutered (P4d), the page-count floor removed (P1b).

**The offline suite, the required CI check** (`node scripts/run-unit-tests.mjs --offline`), exit 0, final line:

```
All 289 unit test file(s) passed (mode=offline).
```

It includes `test/site-artifact-contract.test.mjs` (`ALL CHECKS PASSED  (artifact: 75 files)`, so no shipped page references an asset the artifact lacks) and the new suite.

**The full suite** (`node scripts/run-unit-tests.mjs`, no flag) did **not** reach an "All N unit test file(s) passed" line in this sandbox: `15 test file(s) failed`,
14 `*.browser.test.mjs` files plus `acquisition-video-producer-workflow.test.mjs`, all browser-backed. The same 15 fail with the same number of FAIL lines on a
pristine `git archive` of `origin/main` at `ea0d1db` (run from outside the repository, `node_modules` linked), so they are environmental and not caused by this
change: `map1-all-types-off` 9 · `map1-dc-type-lifecycle` 18 · `map1-dual-identity` 14 · `map1-national-plane-failure` 21 · `map1-regulatory-toggle` 3 ·
`map1-stage-filter-chips` 11 · `map1-type-filter-chips` 8 · `maps-datacenter-capture-state` 16 · `place-context-map-fits-frame` 3 · `user-journey` 6 on both trees;
`map1-datacenter-significance`, `map1-residential-draw-parity`, `project-follow-my-places` and `property-reports-premium` exit non-zero on both trees with an
uncaught Playwright error and no FAIL line (read on `main`: three `TimeoutError`, one `Error`); `acquisition-video-producer-workflow` fails on both (one FAIL line in two runs, a closed-page crash in the third). The map suites render 0
records here, which is what a sandbox with no route to the map library's CDN would produce; that cause is **UNVERIFIED** (not diagnosed, since it is identical on
`main`). The other 320 files passed, including `fsr-audience.browser.test.mjs` (`all passed`), which serves the repository tree and so still exercises the
retired page locally.

## 9. Not exercised, and unverified (stated, not hidden)

- **Whether the page is live now, and what a visitor gets after the deploy.** The sandbox has no route to homesignal.net, and a `pg_net` request would write to
  the production request queue, so it was not used. That removal yields a plain 404 is inferred from the allowlist artifact contract (a path ships only if named)
  and from `404.html:12-22`, which forwards only `/development/<zip>` and `/community/<zip>`; it is not observed. `pages.yml` was not run.
- **Who uses the page, its copied share links or the `?audience=internal` views.** The page loads no analytics, so this cannot be measured. The founder's
  loss of the production internal views is a stated cost (section 5).
- **That nothing outside this repository expects the legacy function to be deployed.** The ingest repository was not searched; `.github` here has no reference.
- **That a merge deploys at once.** `pages.yml`'s push filter (lines 43-68) is `'**'` minus `.github/**`, `docs/**` and `test/**`, then re-including a list of named gate-input
  test files, and `scripts/stage_site.py` is under none of those exclusions, so this merge triggers a Pages build. The workflow's own gates and the deploy were not run here.
- **Concurrency check (CLAUDE.md), 2026-10-01, `origin/main` at `ea0d1db`: GENUINE GAP.** The audit searched open and recent pull requests for the legacy page and the quota
  bypass and found none; this worktree fetched `origin/main` and read it, and did not repeat the pull-request search (no GitHub tool was used, by instruction).
  A founder-reverted outcome is not involved: the page was built in #1424 and never reverted.
