# occurred_at full-set measurement — HALTED at the fingerprint gate

**2026-09-04 01:51:27 UTC.** Read-only. No function was changed, no production write was
made. The scheduled check-in that requested this measurement carried its own stop
condition, and that condition fired.

## Step 1 — propagation: COMPLETE

```
has_all_three          12722      -- updated_at >= 2026-09-03 18:37:07+00
control_zips_supplied  12722
oldest_page            2026-09-03 19:00:15.143250+00
newest_page            2026-09-04 01:46:38.282889+00
```

Every canonical ZIP page has been re-materialised since the last of the three function
changes, so the **full set** would have been measurable. Propagation is not the blocker.

## Step 4 — fingerprint: MISMATCH → STOP

The check-in specified: *"Live body md5 should still be
`69493ddba6c642fc5a244929dd3312a0` — verify, don't trust. If it differs, something else
changed the function; stop and report."*

| function | md5(`pg_get_functiondef`) | md5(`prosrc`) |
|---|---|---|
| `app_refresh_zip` | **`4a18ca4e20e906bbc7230b7383f4dd87`** | `664325d381d4fb3949e1708696b56fb7` |
| `app_refresh_sweep` | `1de03d95b6d6dfae60eb321652f0dcf4` | `ba967450bb2f38323e08f7a454148093` |
| `app_refresh_batch` | `2138a7ca068bae77ec62470e555f1626` | `b4177b4d8904f902cbe1afd746b76343` |
| `app_refresh_all` | `5866e471befdde283b9f3e9bb33d8654` | `0f0d19bf9515d4595bd18726742f5dfb` |

**No candidate function matches the expected md5 under either hashing method**, so this is
not "I hashed the wrong object" — the body genuinely differs. Measurement stopped as
instructed; steps 2 and 3 were not run.

## What changed, and why this is Rule #0a rather than a defect

The mismatch is **explained, not absorbed**. The three occurred_at migrations all landed at
or before 18:37:07:

| version | name |
|---|---|
| `20260903175028` | `govnotice_display_record_date` (W3) |
| `20260903183635` | `govnotice_meeting_window_gate_public_hearing` (W2) |
| `20260903183707` | `govnotice_meeting_occurred_at_meeting_date` (W2) |

**Seven further migrations landed afterwards**, from the other session's projects/markers
cutover work — `meetings_category_canonical_285` (19:45), `a4_projects_markers_delivery_contract`
(20:20), `b_freeze_cutover_set_346_disabled`, `b_authoritative_projects_producer_failclosed`,
`b_read_path_branch_on_cutover_switch` (20:34–20:35), `b_mark_production_geography_verified_346`
(20:38) and `local_news_geo_retractions` (20:46). Several of those touch `app_refresh_zip`'s
projects/markers half, which is what moved the body hash.

## The three changes under measurement are still present — verified in the live body

Read out of `pg_get_functiondef(app_refresh_zip)` rather than assumed:

**W2 — meetings writer** (lines 232–240):
```sql
m.meeting_date::date, m.source_url, 'High',
  case when m.is_public_hearing then m.meeting_date::date end, 'safety'
```
`occurred_at` is the meeting date, and `window_closes_at` is gated to public hearings only.
Both changes intact.

**W3 — alerts writer** (lines 242–250):
```sql
coalesce(
  case when a.published_at >= date '2000-01-01'
        and a.published_at <  now() + interval '2 years'
       then a.published_at::date end,
  a.created_at::date)
```
The notice's own `published_at`, bounded to a sane range, falling back to `created_at::date`.
Intact.

## Why the stop still stands

All three changes surviving makes it **likely** the measurement would be valid — but
"likely" is exactly what a fingerprint gate exists to refuse. The gate's purpose is that
nobody re-derives numbers against a body they have not pinned, and seven unreviewed
migrations sit between the expected hash and the live one. Confirming that the projects
cutover cannot perturb the app_changes date columns is a separate piece of work, not an
assumption to make while producing a headline measurement.

**To re-authorize:** re-issue the check-in with the expected md5 updated to
`4a18ca4e20e906bbc7230b7383f4dd87`, or with a fingerprint scoped to the W2/W3 statements
rather than the whole function body — the latter would survive unrelated edits to the
projects half and is the more durable gate.

**Not done:** steps 2 and 3 (date-shift distributions, age distributions, future-dated rows,
window_closes_at before/after, ZIP 18042 positive control). No partial was presented as a
full-set result.
