# Decision provenance rollout: findings, proposed change, pilot, rollback (2026-11-13)

Status: **PROPOSED. NOTHING IN THIS FILE HAS BEEN APPLIED.** Two separate production approvals are needed (gate 1 and gate 2 below).

## 1. Where the decision is lost (read-only, production, 2026-11-13)

Trace of ZIP 78754 (Austin, TX), the one ZIP examined:

| step | observed | evidence |
|---|---|---|
| cached source report (`development_reports.sites`, refreshed 12:36Z) | **carries the decision** | 1,069 sites; 93 `decided`; 93 with a `decision` object (17 denied, 76 withdrawn, 42 with `decided_on` null; `status_raw` values `CC Rejected`, `Denied`, `Withdrawn`) |
| writer `public.app_refresh_zip` | **drops it** | live body md5 `7718e5dbd2f4702048be9cba3b59ae13` (26,912 chars) has no `'decision'` key in either provenance object |
| `public.app_projects` | status `Decided` kept, decision gone | 93 Decided rows for the ZIP (equals the 93 in the report); sample provenance keys: `case_number, jurisdiction, source_class, geo_precision, url_precision` |
| ZIP response `app_zip_projects_markers('78754','development',true)` | `boundary_complete`, 560 projects, 576 markers, **50 Decided, 0 carry `provenance.decision`**, 12 Proposed | |
| site builder | fixed by #2880, **deployed** | `https://jodytracks.com/lib/zip-authoritative.js` md5 `ff560ba4…` equals `main` (`d1b9ab1`); contains the decision block |

So the only place information is lost is the **writer**. Until it carries `decision`, a denied or withdrawn project on this ZIP is correctly kept out of active counts (`decided`) but shows the honest "not verified" line, not the outcome.

Denied example with a source: case `2026-138770 C8` ("CC Rejected", decided 2026-11-10, `app_projects.submitted_at` 2026-10-21). Withdrawn examples: `2012-049121 C8` (2013-04-03), `2018-055363 C` (2019-06-26). Undated: 42 in the same ZIP.

No "Decided without valid decision evidence" row exists in 78754 (all 93 carry a decision). No live example was searched for elsewhere; that case is covered by `test/zip-mode-decision-propagation.test.mjs` only.

## 2. The parked migration was broken against the live body

`docs/decision-provenance-migration.sql` anchored on the single line `'source_vintage', _vintage`. The live body contains it **twice**: in the development provenance object and in the facility one (measured: anchor count 2). The file's own fail-closed count would have refused it; matching the first hit alone would also have put a development decision on facility rows.

Correction in this change: the anchor is the three lines starting at `'canonical_addr'`, a key only the development object has. Measured read-only against the live body: anchor count **1**; the splice adds 42 characters (plus the comment); excising it gives md5 `7718e5db…` again. It also now refuses unless the live md5 equals the reviewed `7718e5db…`, so a changed function stops it instead of splicing into unread text. Idempotent. `docs/decision-provenance-migration.rollback.sql` removes exactly the inserted text and refuses unless the result is md5 `7718e5db…`.

Tested on a disposable local Postgres 16 with a stand-in function (not production, not the live body): wrong md5 refused, apply carries the decision (null `decided_on` is stripped, nested), undecided and facility provenance unchanged, second apply is a no-op, rollback restores the exact pre-splice md5, second rollback is a no-op.

## 3. Gate 1: apply the migration (APPROVAL REQUIRED, not requested yet)

- **Action:** run `docs/decision-provenance-migration.sql` (one `create or replace` of `public.app_refresh_zip`, spliced from the live body) on production project `qwnnmljucajnexpxdgxr`.
- **Writes:** only the function definition. No row changes by itself.
- **Risk, stated plainly:** `pg_cron` job 13 (`app-content-refresh`, every 15 minutes, `call public.app_refresh_sweep()`) refreshes ZIPs on a rolling cycle. After the migration, **each ZIP the sweep revisits will start carrying decisions**, so the change reaches the whole country over about one sweep cycle (the repo records ~7-11 hours) unless that job is paused, which is a separate production change. A pilot can therefore only be ordered first (refresh 78754 right away and inspect it), not isolated. Effect on other ZIPs: rows with a `decision` get a provenance key added (about the Decided rows only; undecided rows are byte-identical because `jsonb_strip_nulls` drops the key), and their cards gain the outcome note. Guarded by the reviewed-md5 pin, the anchor count, and a post-apply read.
- **Recovery:** `docs/decision-provenance-migration.rollback.sql` (restores the writer; rows already refreshed keep an inert `provenance.decision` key). To strip it from a ZIP: archive, then `update public.app_projects set provenance = provenance - 'decision' where zip = '<zip>' and record_kind = 'development' and provenance ? 'decision'`.

## 4. Gate 2: refresh the pilot ZIP (APPROVAL REQUIRED, separate)

- **Action:** `select public.app_refresh_zip('78754')` on production, once, after gate 1 is verified.
- **Scope:** ZIP 78754 only. Expected effect: the 93 Decided rows gain `provenance.decision`; the 58 Proposed rows unchanged.
- **Before/after checks:**
  1. `select count(*) filter (where provenance ? 'decision'), count(*) filter (where status='Decided'), count(*) filter (where status='Proposed') from public.app_projects where zip='78754' and record_kind='development'` → before 0 / 93 / 58; after 93 / 93 / 58.
  2. For `2026-138770 C8`: `provenance->'decision'` has `outcome denied`, `decided_on 2026-11-10`, the Austin `source_url`, and `app_projects.submitted_at` still 2026-10-21 (no date substitution).
  3. For a row with null `decided_on` (42 in this ZIP): the key is absent after `jsonb_strip_nulls`; the card must read "date not stated by the source".
  4. `app_zip_projects_markers('78754','development',true)`: 93-vs-response consistency (decisions present on every returned Decided row).
  5. Zero `Decided` rows without a decision in the pilot (so the not-verified wording is only exercised by tests).
- **Browser (real, signed-out):** open `https://jodytracks.com/map/78754/`, Proposed filter, open the denied and withdrawn tiles: wording, date, source link opens; active-proposal tile excludes decided records; a Proposed (undecided) tile unchanged. Needs network access to the Supabase and CDN hosts, which this session's sandbox does not have (egress proxy refuses both).
- **Recovery:** scoped `provenance - 'decision'` update as above (archive first); the sweep would rewrite it if the migration is still applied, so roll back the writer first if reverting.

Wider refresh (the sweep, or a manual batch) only after the pilot passes and is separately approved.

## 5. Not verified

Browser behavior on the deployed site; any ZIP other than 78754; a live Decided-without-evidence record; whether `?v=20261029a` (the hand-kept script key for `zip-authoritative.js`, not bumped in #2880) leaves any returning browser on the old script beyond the Pages cache lifetime.
