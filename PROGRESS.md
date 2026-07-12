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
