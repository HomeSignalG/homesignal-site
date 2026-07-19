# Government feed automation — migration to homesignal-ingest

Phase 1A automation **belongs in `homesignal-ingest`**, not `homesignal-site`.

## Evidence

| Concern | homesignal-ingest | homesignal-site |
|---------|-------------------|-----------------|
| `feeds.csv` authoring | ✅ canonical (`load_config`) | ❌ duplicate removed |
| `dryrun-feed.yml` / `golive-feed.yml` | ✅ ingest CI | ❌ not here |
| `load_config` / adapters | ✅ `ingest.py`, vendor parsers | ❌ |
| `public.feeds` writes | ✅ service-role ingest | read-only verify only |
| Community pages | ❌ | ✅ `community.html` |

The site repo should **not** own feed authoring or scheduled ingest sync. It may keep
**read-only verification** helpers (title check against `public.meetings`) that mirror
`verify-communities.mjs`.

## Migration map (when ingest repo is available)

| From (homesignal-site) | To (homesignal-ingest) |
|------------------------|------------------------|
| `scripts/gov-feeds/` | `scripts/gov_feeds/` |
| `.github/workflows/discover-gov-feed.yml` | `.github/workflows/discover-gov-feed.yml` |
| `.github/workflows/dryrun-gov-feed.yml` | `.github/workflows/dryrun-feed.yml` (extend existing) |
| `.github/workflows/sync-feeds-config.yml` | `.github/workflows/sync-feeds-config.yml` |
| `.github/workflows/insert-gov-feed-candidate.yml` | `.github/workflows/insert-feed-candidate.yml` |
| `.github/workflows/verify-gov-feed-candidate.yml` | `.github/workflows/verify-feed-titles.yml` |
| `fixtures/gov-feeds/` | `fixtures/gov_feeds/` |
| `docs/government-feed-onboarding.md` | `docs/government-feed-onboarding.md` (move; site keeps stub link) |

**Stay in homesignal-site after migration:**

- `docs/gov-feeds-schema.sql` — DDL reference (or link to ingest copy)
- This migration doc (historical)

## Interim (current PR)

Until the ingest move lands:

1. Scripts live in `homesignal-site/scripts/gov-feeds/` but read **`FEEDS_CSV`**
   pointing at `homesignal-ingest/feeds.csv` (checkout both repos in CI).
2. No `data/gov-feeds/feeds.csv` in the site repo.
3. Offline tests use `fixtures/gov-feeds/feeds-authoring-fixture.csv` only.

## CI checkout pattern (both repos)

```yaml
- uses: actions/checkout@v4
- uses: actions/checkout@v4
  with:
    repository: HomeSignalG/homesignal-ingest
    path: homesignal-ingest
    token: ${{ secrets.INGEST_REPO_TOKEN }}
- run: FEEDS_CSV=homesignal-ingest/feeds.csv node scripts/gov-feeds/sync-feeds-config.mjs --live
```

If the ingest repo token is unavailable, `sync-feeds-config` runs **manual-only**
(no schedule) until migration completes.
