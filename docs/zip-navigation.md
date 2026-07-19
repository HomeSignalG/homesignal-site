# ZIP navigation — developer note

Short reference for preserving geography context across full-page navigation in the
HomeSignal shell.

## Canonical state

**`HS.state.zip` is the viewed ZIP** for the current tab. It is set at shell boot
(`resolveViewedZip` in `lib/view-zip.js` / `shell.js`) and may be updated when a page
learns a more specific context (e.g. `community.html?zip=`, `homesignalmap.html` address
search).

Precedence at boot:

1. `?zip=` on the current URL (also persisted to `sessionStorage` as `hs:viewZip`)
2. Saved `myZip` (localStorage — the resident's chosen area; never overwritten by browsing)
3. Session `viewZip`
4. `CFG.DEFAULT_ZIP` (`78617` — sample geography only)

Assigning `HS.state.zip = '…'` re-paints the top bar and re-stamps ZIP-aware links.

## How to link

**Use `HS.navHref(page, HS.state.zip)` or `data-znav` on an anchor** — never hand-build
`?zip=` query strings.

```html
<a href="maps.html" data-znav="maps.html">Open map →</a>
```

```javascript
location.href = HS.navHref('maps.html', HS.state.zip);
```

`paintNavHrefs()` (called from `paintTopbar`) stamps:

- Sidebar links listed in `ZIP_NAV_PAGES`
- Any `#hs-slot a[data-znav]` in-page link

`ZIP_NAV_PAGES` and helpers live in **`lib/view-zip.js`** (canonical); `shell.js` mirrors
them when the module is not loaded directly.

## Do not

- **Manually construct ZIP URLs** (`'maps.html?zip=' + zip`) — use `HS.navHref`.
- **Add a second ZIP store** (globals, duplicate session keys, page-local `viewZip`
  variables). Reuse `HS.state.zip` and the existing session/localStorage contract.
- **Hardcode sample ZIPs** in navigation (`78617`, etc.) — always read from `HS.state.zip`
  or parse from an authoritative source (`parseZipFromAddress` for geocoded strings).

## Map cross-links

| Page | Role | Cross-link |
|------|------|------------|
| `maps.html` | App map (`app_*` data) | → `homesignalmap.html` (development tracker) |
| `homesignalmap.html` | SEO / EPA tracker (`development_reports`) | → `maps.html` |

Both use `data-znav` on a single in-page link (not a second sidebar item).

**Address search on the tracker:** after a live address fetch, `render()` parses the ZIP
from the geocoded `data.address` (same regex as `get-address-report`) and sets
`HS.state.zip` so the App map link reflects the searched address, not a prior session ZIP.

## Regression tests

`test/navigation-zip.test.mjs` — run via `node scripts/run-unit-tests.mjs`.

## Related

- Phase 3 analysis: `docs/phase3-navigation-analysis.md`
- NAV-01 implementation history: `docs/beta-backlog.md`
