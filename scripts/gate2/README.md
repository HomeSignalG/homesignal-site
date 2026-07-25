# Gate 2 — Street / Satellite / Focus parity harness (INCOMPLETE)

Real-Chromium harness for `maps.html` at Del Valle 78617. Drives the page through its
own `?data=seed` + `window.HS_SEED` path so `lib/data.js`, `lib/map.js`, the marker
resolver, the mode switch, the legend, the popups and the filters all run unmodified —
nothing internal is monkey-patched.

* `rows.tsv`      — 39 PRODUCTION rows exported verbatim from `app_projects` (zip 78617):
                    record_kind | registry_id | type | status | lat | lng | url-token | name.
                    Spans every category, both Austin sources, all 5 TABS filings and
                    EPA facilities. Evidence URLs are reconstructed from the real
                    per-record token using each source's real URL pattern.
* `seed78617.mjs` — builds `window.HS_SEED` from `rows.tsv`.
* `gate2.mjs`     — launches Chromium, switches Street → Satellite → Focus, and collects
                    marker/category/lifecycle/symbol/legend/filter/console metrics per
                    mode plus the mode-independent resolver truth table.

## KNOWN BLOCKER (why this gate is still FAIL)

`ctx.addInitScript()` sets `window.HS_SEED` before navigation, but the page loads its
OWN bundled demo seed afterwards and overwrites it — the run measures 6 demo records,
not the 39 Del Valle rows (`truth_summary.records: 6`, `facilities: 0`, `tabs: []`).

Fix: stop injecting via addInitScript and instead intercept the page's seed script
request in the existing `ctx.route()` handler, serving `seed78617.mjs`'s payload in its
place — the same technique the ZIP-page harness already uses for the Supabase REST read.
Then re-run and assert the parity table.

Run: `node scripts/gate2/gate2.mjs` (needs playwright + leaflet + @supabase/supabase-js
installed in the working directory; browser at /opt/pw-browsers/chromium-1194).
