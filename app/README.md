# HomeSignal Phase 1 app (`/app`)

The production Phase-1 HomeSignal web app — **vanilla HTML/CSS/JS, no build step**, reading
the existing Supabase project with the anon key + RLS. Built to the approved mockup
(`../homesignalphase1_13.html`) and populated with **real Del Valle, TX 78617 (Travis County)**
data as the single-community case study. The ingestion/scoring backbone lives in the
`homesignal-ingest` repo (Python).

> **Staging:** the whole app lives under `/app` so the **live homesignal.net root pages are
> byte-for-byte unchanged** until you review Del Valle and explicitly promote. Preview URLs are
> `https://homesignal.net/app/index.html`, `.../app/community.html?zip=78617`, etc. Promotion
> (moving `/app/*` to root, or adding a `?preview=1` guard on the canonical pages) is a separate,
> sign-off-gated step. See `../DECISIONS.md`.

## Run locally (no build, no paid keys)
```bash
# 1. static server (any will do)
python3 -m http.server 8099
# 2. open the app
open http://localhost:8099/app/index.html
```
The app runs in **seed mode** by default (`config.js` → `DATA_SOURCE:'seed'`), so it renders the
full Del Valle prototype with **zero database**. A demo session is stubbed so authed screens
render. To point at the live database instead: `.../app/index.html?data=supabase` (reads via the
anon key + RLS), and set `DEMO_SESSION:false` to consume the real homesignal.net Supabase session.

Optional local Supabase (Docker prerequisite):
```bash
supabase start
psql "$LOCAL_DB_URL" -f ../docs/phase1-app-schema.sql   # additive schema + RLS
```

## Architecture
- `partials/shell.html` — the one shared shell (sidebar + top bar + all 5 modals), injected
  identically into every page by `shell.js` (byte-identical menu is a hard rule).
- `app.css` — the mockup's tokens/components **verbatim** + a small marked app-only block.
- `config.js` — the single place URLs/keys/flags live (`?data=`, `?demo=` overrides).
- `lib/data.js` — one data interface, two backends (**seed** ↔ **supabase**); distances are
  **computed** (haversine now; a PostGIS `items_with_distance` RPC is in the schema).
- `lib/templates.js` — component templates (story/mini/dev cards, chips, ring, bars, thread…).
- `lib/map.js` — the schematic map behind a swappable **`MapProvider`** seam (drop in Mapbox/
  Google later without touching callers).
- `seed/delvalle.js` — the real Del Valle 78617 seed (sourced; approximated specifics flagged).
- Pages: `index, today, dashboard, alerts, development(+?id=), maps, properties, property(+?id=),
  community(?zip=), reports, contact, privacy` — each a thin `<template id="hs-content">` + loaders.

## Run the pipeline for another ZIP (zero code change)
In `homesignal-ingest`:
```bash
python run_community.py --zip 78617                    # dry run: fetch → score → summary
python run_community.py --zip 78719 --emit-seed ./out  # a 2nd ZIP, identical code path
```
`--emit-seed` writes a `window.HS_SEED`-shaped seed (the same contract this app consumes), proving
a new community is pure data. In production the pipeline writes Supabase and the app reads it in
`?data=supabase` mode. `community.html?zip=<zip>` is the page generated 12,000+ times.

## Auth
No login UI is built here — the app consumes the **existing homesignal.net Supabase session**.
Browsing is public; a persisting action (follow/watch, save topics, add property) by a signed-out
user routes to the existing sign-in (`HS.requireAuth`) and then completes. Locally, `DEMO_SESSION`
stubs a signed-in user.

## Swapping providers
- **Map:** implement a new object with `render(el, opts)` and assign it to `HS.MapProvider`
  (see `lib/map.js`); the schematic default needs no key.
- **LLM plain-language:** the Python `Scorer._plain()` is templated with a clean seam — swap in an
  open/self-hostable model there. No paid LLM key is required to run.

## Verify
- Per-page smoke + shell presence + 0 JS errors: `node /tmp/hs-all.cjs` (Playwright/Chromium).
- E2E flows (consent-unchecked, coverage request, switcher, waitlist, topics-persist, mobile
  drawer, modal a11y): `node /tmp/hs-e2e.cjs`.
- Scorer + pipeline unit tests: `python homesignal-ingest/tests/test_scorer.py`.
