# HomeSignal Phase 1 — Progress

Staged under `app/` (live root pages byte-for-byte untouched until promotion). Runs in
**seed mode** with zero DB (real Del Valle 78617 data). Verified by Playwright + Chromium.

## Done
- Foundation: `app.css` (mockup CSS verbatim + minimal app-only additions), `partials/shell.html`
  (sidebar + topbar + 5 modals, one injected frame), `shell.js` (inject, nav, mobile drawer,
  modals w/ focus-trap+Escape+aria-modal, session/property state, search, share, topics,
  follows, waitlist, community-request, bell), `config.js`, `lib/data.js` (seed+supabase seam,
  computed haversine distances), `lib/templates.js` (story/mini/dev cards, chips, ring, bars,
  thread, meetings), `seed/delvalle.js` (real Travis County data, approx flags).
- `index.html` — homepage, renders a real Del Valle card. Verified desktop + 390px.

## Next
- today, dashboard, alerts, development(+detail), maps, properties(+detail), community,
  reports, contact, privacy — same shell/template pattern.
- Then: Supabase migrations (additive) + RLS; Python pipeline in homesignal-ingest; README;
  E2E flows; screenshot pass vs mockup.

## Verify
`python3 -m http.server 8099` then open `/app/index.html`. Playwright check: `/tmp/hs-verify.cjs`.

## Update — all 12 pages built & verified (seed mode)
Built: today, dashboard, alerts, development(+detail), maps, properties, property(+detail),
community(?zip=), reports, contact, privacy — plus lib/map.js (schematic MapProvider seam).
Playwright pass: all 13 routes render with the shared shell, 0 JS errors, real Del Valle data,
computed distances. Screenshots in /tmp/hs-shots match the mockup (alerts, maps, dev-detail
eyeballed). Interactive: topic picker (consent default unchecked), property switcher, coverage
modal, premium/community-request/contact persistence seam, follows, share intents, .ics calendar,
search, sort segments, dev lenses + data view, map layer toggles + radius.

## Still to do
- Supabase migrations (additive) + RLS policies (docs/*.sql) + apply.
- Python pipeline in homesignal-ingest (Connector/SourceAdapter/Scorer, run_community.py).
- README (setup, Del Valle, run pipeline for another ZIP, auth, provider swaps).
- E2E assertions; 390px screenshot pass for all pages.

## COMPLETE (this session) — verified
- 12 pages + shared shell, real Del Valle 78617 seed, all interactions wired. Playwright: 13
  routes 0 JS errors; 10/10 E2E flows pass (consent-unchecked, coverage request, switcher,
  waitlist, topics-persist-across-reload, mobile drawer, aria-modal, Escape). Desktop + 390px OK.
- `docs/phase1-app-schema.sql` — additive schema + RLS (parked, not applied to prod).
- `homesignal-ingest`: `homesignal_pipeline` (Connector/SourceAdapter/Scorer + writers) +
  `run_community.py --zip`; 5/5 unit tests; proved scale on 78617 & 78719 (zero code change).
- `app/README.md` — setup, pipeline, auth, provider swaps.
- Live root pages byte-for-byte unchanged (0-line diff vs pre-build commit).

## Remaining for the founder / promotion step
- Review the Del Valle prototype at `/app/index.html` (seed mode) and sign off.
- On sign-off: apply `docs/phase1-app-schema.sql`; wire real Travis County feeds in the engine
  adapters (Granicus/Legistar/CivicClerk/TCEQ/FEMA/TxDOT) replacing the seed; switch the app to
  `?data=supabase`; promote `/app/*` to the live path (or add the `?preview=1` guard).
