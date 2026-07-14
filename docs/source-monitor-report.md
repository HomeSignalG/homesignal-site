# Source-monitor report (append-only)

Written by `scripts/source-monitor.mjs` — the nightly automated source monitor
(`.github/workflows/source-monitor.yml`, 07:00 UTC, before the 09:00 UTC engine refresh).

Each run appends a dated section below:

- **Sources re-probed** — every source `docs/source-registry.md` rejected as
  dead / stale / frozen / blocked / broken (`scripts/source-monitor-targets.json` `reprobe[]`),
  probed again with the exact endpoint that failed last time.
- **Auto-wired** — candidates that came back to life (or were newly discovered on an official
  first-party catalog) AND passed the fail-closed gate: point geometry, native ZIP column,
  fresh data, live statuses/types mapped ONLY through the human-approved
  `scripts/source-lexicon.json`. Wired = one appended `jurisdiction-registry.json` entry with
  `_wired_by` + `_receipts`; revert = delete that entry (or `git revert` the run's commit)
  and redeploy.
- **Flagged shapes** — live sources the generic connectors (ArcGIS FeatureServer, Socrata)
  do NOT handle: CKAN catalogs, vendor portals (Accela, eTRAKiT, CitizenServe, OpenGov,
  Tyler EnerGov, CivicPlus), polygon-only layers, layers without a native ZIP or with
  statuses/types unknown to the lexicon. These are DESCRIBED, never guessed — each flag says
  what connector or lexicon work it needs.
- **Dev-backed ZIPs snapshot** — distinct ZIPs with ≥1 `app_projects` development record
  (public anon read), so the next run shows the delta a wire produced after the nightly
  deploy + refresh picked it up.

v18 anti-fabrication is absolute throughout: nothing is classified without a real structured
status/type, every emitted row keeps a real source reference, and EPA facilities stay
`record_kind='facility'` — the monitor only ever appends registry entries; it never touches
facility sources or existing entries.
