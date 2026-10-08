// ZIP COVERAGE, for the live verifiers (founder, 2026-10-03). A ZIP in lib/zip-coverage.json has
// no Census-drawn area, so its page is a coverage panel, not a standard page. A live check must
// compare against the model the SITE SERVES (/lib/zip-coverage.json), not the checkout's copy:
// between a merge and its deploy the two differ, and a check must judge what residents are shown.
//
// A ZIP in the model passes only when its page shows the coverage panel for THAT mode and ZIP, and
// the (non-canonical) URL the verifier loads is noindex. Any OTHER ZIP showing a panel is a
// failure, so a panel can never stand in for a broken standard page.

// Reads the mode the build decided, exactly as shell.js HS.zipCoverageMode does (the build, in
// scripts/build_zip_coverage.py, is the only place a mode is decided; test/zip-coverage.test.mjs
// runs both readers over every entry and over values the build would refuse).
const PAGE_MODES = ['standard', 'specialized_zip', 'verification_pending', 'retired', 'unverified'];
export function coverageMode(entry) {
  if (!entry) return 'standard';
  return PAGE_MODES.indexOf(entry.page_mode) >= 0 ? entry.page_mode : 'verification_pending';
}

export async function loadDeployedCoverage(siteBase) {
  const url = `${siteBase.replace(/\/$/, '')}/lib/zip-coverage.json`;
  const res = await fetch(url);
  // Not deployed yet (the run started before the deploy that ships the model): no ZIP has a
  // coverage panel on the live site, so every page must still render as before.
  if (res.status === 404) return { modes: new Map(), note: `${url} → 404 (no ZIP has a coverage panel on this deploy)` };
  if (!res.ok) throw new Error(`could not read the deployed ZIP coverage model ${url}: HTTP ${res.status}`);
  const doc = await res.json();
  if (!doc || !doc.zips || typeof doc.zips !== 'object' || !Object.keys(doc.zips).every((z) => /^\d{5}$/.test(z))) {
    throw new Error(`${url} is not an object of 5-digit ZIP keys under "zips"`);
  }
  const modes = new Map();
  for (const [z, e] of Object.entries(doc.zips)) { const m = coverageMode(e); if (m !== 'standard') modes.set(z, m); }
  return { modes, note: `${url} → ${modes.size} ZIP page(s) with a coverage panel` };
}

// In-page read; pass to page.evaluate.
export function readCoverageInPage() {
  const p = document.getElementById('hs-zip-coverage');
  const m = document.querySelector('meta[name="robots"]');
  return {
    panel: p ? p.getAttribute('data-zip-coverage') : null,
    panelZip: p ? p.getAttribute('data-zip') : null,
    robots: m ? (m.getAttribute('content') || '') : '',
  };
}

// Pure verdict. `mode` = the deployed mode for `zip` (undefined for a standard page);
// `st` = readCoverageInPage() for the page loaded for `zip`.
export function judgeCoverage(zip, mode, st) {
  const fails = [];
  if (mode) {
    if (st.panel !== mode || st.panelZip !== zip) fails.push(`ZIP ${zip}: the live model says ${mode}, but its page showed panel ${JSON.stringify(st.panel)} for ${JSON.stringify(st.panelZip)}`);
    if (!/noindex/i.test(st.robots || '')) fails.push(`ZIP ${zip}: coverage panel on a non-canonical URL, but the page is not noindex (robots="${st.robots}")`);
  } else if (st.panel) {
    fails.push(`ZIP ${zip}: shows a ${st.panel} coverage panel but is not in the deployed coverage model`);
  }
  return fails;
}
