# Spec — Auto-refresh the acquisition dashboard snapshot (ingest side)

**Problem.** `acquisition.html` renders 10 tabs. Two-plus panels are already
**live** (Acquisition & retention, Coverage demand, Bluesky followers, Feed
inventory — each reads Supabase directly on load). The other 8 tabs render a
**static snapshot** stored in one Supabase row. That row is only written when
someone runs the dashboard build by hand, so it goes stale — as of this writing
it was 3 days old (dashboard showed 347 alerts / 75 meetings / 1 user while live
was 359 / 93 / 2). The website now shows a ⚠ staleness banner, but the real fix
is to **regenerate and publish the snapshot on a schedule.**

This is an **ingest-repo** task (that repo owns `dashboard/build_dashboard.py`,
`feeds.csv`, and the Supabase **service-role** key). The website side needs no
change — it already reads whatever is in the row.

---

## The contract (already live in Supabase — do not change shape)

- **Table:** `public.dashboard_snapshots (slug text primary key, payload jsonb, updated_at timestamptz)`.
  RLS on, no anon/authenticated grants. Only the service role writes it.
- **Website read:** the page calls the gated RPC `public.hs_acquisition_dashboard()`
  (SECURITY DEFINER, allowlist-checked) which returns `payload` for `slug='acquisition'`.
- **Payload shape** (exactly what the page consumes):

```jsonc
{
  "meta": {
    "snapshot":  "2026-07-04T18:00:00Z",   // build time (UTC). DRIVES the staleness banner — must be the real run time.
    "rendered":  "2026-07-04 18:00 UTC",
    "project":   "qwnnmljucajnexpxdgxr",
    "generated_at": "2026-07-04T18:00:00Z"
  },
  "S": [ ["2026-06-02", 4, 0, 0], ... ],    // daily [date, dailyAlerts, dailyMeetings, dailyDeliveries]; drives the Growth slider
  "tabs": {                                  // 10 keys, each = script-free inner HTML for that tab
    "exec": "<html>", "feed": "...", "projects": "...", "outreach": "...",
    "engagement": "...", "website": "...", "tags": "...", "alertperf": "...",
    "homeowners": "...", "acquisition": "..."
  }
}
```

**Rules that must hold** (the page relies on them):
1. `tabs.*` HTML must be **script-free** and free of inline `on*=` handlers — the
   page injects it via `innerHTML`. Keep all JS (the slider, tab logic) out of the payload.
2. `meta.snapshot` must be the **actual build timestamp** (UTC). The banner is
   `floor((now - meta.snapshot)/1 day)`; if you don't update it, the banner never clears.
3. `S` is the 4-column daily array; the page appends cumulative columns at runtime.
4. Don't put anything in the payload that's already a **live** panel — followers,
   feed inventory, acquisition/retention, and coverage demand come from their own
   RPCs/views, not the snapshot. (If the artifact's Engagement/Exec tabs still
   contain baked "Social followers = pending" tiles etc., that's fine — the live
   overlays sit above/override them.)

---

## What to build

### 1. Publish step in `dashboard/build_dashboard.py`
After the script assembles the `{meta, S, tabs}` payload it already renders,
**upsert it** into `dashboard_snapshots` with the service role. Sketch (REST /
PostgREST; `psycopg`/`supabase-py` are equivalent):

```python
import os, json, datetime, requests

def publish_snapshot(payload: dict) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload["meta"]["snapshot"]     = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    payload["meta"]["rendered"]     = now.strftime("%Y-%m-%d %H:%M UTC")
    payload["meta"]["generated_at"] = payload["meta"]["snapshot"]

    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/dashboard_snapshots?on_conflict=slug"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]          # server-only secret; never in the browser
    r = requests.post(url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        data=json.dumps({"slug": "acquisition", "payload": payload}),
        timeout=30)
    r.raise_for_status()
```

Gate it behind a `--publish` flag so local dry-runs don't write prod. Keep the
`--refresh` behavior (re-pull the Supabase export) so the numbers are current
before publishing.

### 2. Schedule it (GitHub Actions, ingest repo)
`.github/workflows/refresh-dashboard.yml`:

```yaml
name: refresh-acquisition-dashboard
on:
  schedule:
    - cron: "0 */6 * * *"        # every 6h; tighten/loosen to taste (daily is fine too)
  workflow_dispatch: {}           # manual "refresh now" button
concurrency: refresh-dashboard    # never overlap runs
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r requirements.txt
      - run: python dashboard/build_dashboard.py --refresh --publish
        env:
          SUPABASE_URL:              ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

Run it **after** the ingest run so the snapshot reflects the latest fetch (either
chain it as a final step of the existing `ingest.yml`, or keep it separate on its
own cron — separate is simpler and idempotent).

---

## Security
- The **service-role key stays a GitHub Actions secret** — never printed, committed,
  or shipped to the browser. The website only ever uses the public anon key.
- The write path is server-side only; RLS keeps `dashboard_snapshots` unreadable/
  unwritable by anon/authenticated. Don't add anon grants to it.

## Verify
1. Run `python dashboard/build_dashboard.py --refresh --publish` once by hand.
2. `select slug, updated_at, payload->'meta'->>'snapshot' from public.dashboard_snapshots where slug='acquisition';`
   — `updated_at` and `meta.snapshot` should be "now".
3. Load `acquisition.html` (allowlisted login) → the ⚠ staleness banner is **gone**
   and the tab numbers match live (e.g. alerts/meetings counts).

---

## Related follow-ups (same repo, not blocking)
- **Keep `feed_inventory` config in sync.** The live Feed Inventory panel reads
  `public.feed_inventory_live`, whose config half (`public.feed_inventory`:
  tile/topic/sources/url/grade_policy) was seeded once from
  `boxelderfeedinventory.csv`. Have the build **upsert `feed_inventory` from
  `feeds.csv`** (service role) so it tracks feed changes; the live-stats half
  (counts/dates/grades) already updates itself.
- **Fix the email metric definition.** The snapshot's "Alert emails sent 81/88"
  (`email_deliveries`, per-item rows) vs "sends attempted 49/52" (`email_events`,
  send-attempt rows) read as contradictory. Pick one definition per label
  (e.g. "emails sent = distinct send events", "items delivered = per-alert rows")
  and render both with those exact words.
