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

## Ownership — who may change what (Fix 6)

Three concepts, kept separate:

| concept | question | store |
|---|---|---|
| **Saved places** | what places does this resident care about? | `app_properties` (Addresses) + `app_follows` / `myCommunities` (ZIP Codes) — **never merged** |
| **Viewed place** | what are they looking at right now? | `HS.state.zip` |
| **Current tool** | which HomeSignal tool are they using? | the four sidebar containers |

> A place-selection action may change place state. A tool-navigation action may change
> tool state. Neither may implicitly change the other. **Account hydration may update
> saved-place collections, but it must never silently change the place being viewed.**

**Account hydration is not a place-selection.** `syncFollowsFromAccount()` used to assign
`state.zip = _serverFollowZips[0]`, so `app_follows` ROW ORDER silently replaced the place
the resident had chosen — `alerts.html?zip=84301` hydrated and then rendered 75009. The
decision now lives in `myZipAfterFollowSync` (below) and has no viewed-ZIP return value at
all, so the boundary is structural rather than a convention. `hydrateAccountLocation()`
likewise no longer elects `properties[0]` as the active Address; any election is gated on
the property being in the viewed ZIP.

Only these may change the viewed place, and each is an **explicit** resident action:
`followCommunity` · `switchProperty` · `switchZip` · a `?zip=` navigation.

### The helpers

- **`HS.ensureViewedZip(pageZip)`** — THE ONE re-assertion, called by every ZIP-scoped page
  *before* it fetches. Resolution: explicit page ZIP → established viewed ZIP → `DEFAULT_ZIP`.
  `pageZip` is for a canonical document whose ZIP is in its **path** (`/community/<zip>/`
  declares it as `<body data-zip>`); it ranks WITH `?zip=`, because ranking it below `myZip`
  would render a visitor's saved area on a document about a different ZIP.
- **`HS.navTo(page)`** — click-time navigation for shell chrome that is not an `<a>` (the
  bell). Resolves through `navHref` at the click, so it can never carry a stale ZIP.
- **`myZipAfterFollowSync({myZip, serverFollowZips, localFollowZips})`** — may FILL an absent
  `myZip` (first-follow initialization, cross-device onboarding); may never REPLACE an
  established one; returns no viewed ZIP.
- **`HS.homeFor(zip, home)`** (`lib/data.js`) — the ONE distance/home anchor gate: a saved
  Address anchors a fetch only on its own ZIP. Every `HS.data.*` function routes through it,
  so a foreign Address can never become "near home".

A ZIP-only Place has no Address: `switchZip` clears a conflicting `activePropId` /
`hs:activeProp` (the **pointer** only — the saved row survives; removal is `HS.removeAddress`).

**Sidebar = which tool. Viewing = which place.** `community.html` is the public ZIP hub
(`data-nav="comm"`) and highlights no tool, so the Viewing control names the place from the
community's own metadata (`Bear River City · 84301`), falling back to the bare ZIP when
metadata is absent. That is an AREA label, so a real saved home in the viewed ZIP still
reads `Your home · <street>`.

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
| `community.html` | ZIP community hub (`app_*` data) | → `homesignalmap.html` (development tracker) |

Both map pages use `data-znav` on a single in-page cross-link (not a second sidebar item).
`community.html` adds **View Development Map →** in the page header action row (`HS.navHref` + `data-znav`).

**Address search on the tracker:** after a live address fetch, `render()` parses the ZIP
from the geocoded `data.address` (same regex as `get-address-report`) and sets
`HS.state.zip` so the App map link reflects the searched address, not a prior session ZIP.

## Regression tests

Run via `node scripts/run-unit-tests.mjs`.

- `test/navigation-zip.test.mjs` — resolution, `navHref`/`pageHref`, map cross-links
- `test/navigation-hydration.test.mjs` — hydration may not own the viewed place (Gate 1)
- `test/navigation-tool-preserves-place.test.mjs` — tool nav preserves place (Gate 2)
- `test/navigation-viewing-switch.test.mjs` — the Viewing control switches place (Gate 3)
- `test/navigation-place-identity.test.mjs` — tool vs place in the UI (Gate 4)
- `test/navigation-history.test.mjs` — Back/Forward restore a coherent place
- `test/nav-identity.test.mjs` — A-021 four-container sidebar (owns that pin)

## Related

- Phase 3 analysis: `docs/phase3-navigation-analysis.md` — **historical (pre-NAV-01);
  read it as a dated record, not as current architecture**
- NAV-01 implementation history: `docs/beta-backlog.md`
