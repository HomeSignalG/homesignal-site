// WITHHELD ZIP PAGES, for the live verifiers (founder, 2026-10-01: the 47 retired ZIPs are off
// the live site until reviewed). The list a live check compares against is the one the SITE
// SERVES (/lib/withheld-zip-pages.json), not the checkout's copy: between a merge and its
// deploy the two differ, and a check must judge what residents are actually shown.
//
// A withheld ZIP passes only when its page shows the shell's "not available" notice for that
// ZIP and is noindex. Any OTHER ZIP showing the notice is a failure, so the notice can never
// stand in for a broken page.

export async function loadDeployedWithheld(siteBase) {
  const url = `${siteBase.replace(/\/$/, '')}/lib/withheld-zip-pages.json`;
  const res = await fetch(url);
  // Not deployed yet (the run started before the deploy that ships the list): nothing is
  // withheld on the live site, so every page must still render normally.
  if (res.status === 404) return { zips: new Set(), note: `${url} → 404 (no ZIP page is withheld on this deploy)` };
  if (!res.ok) throw new Error(`could not read the deployed withheld-ZIP list ${url}: HTTP ${res.status}`);
  const doc = await res.json();
  if (!doc || !Array.isArray(doc.zips) || !doc.zips.every((z) => /^\d{5}$/.test(String(z)))) {
    throw new Error(`${url} is not a list of 5-digit ZIPs under "zips"`);
  }
  const zips = new Set(doc.zips.map(String));
  return { zips, note: `${url} → ${zips.size} withheld ZIP page(s)` };
}

// In-page read; pass to page.evaluate.
export function readWithheldInPage() {
  const w = document.getElementById('hs-withheld');
  const m = document.querySelector('meta[name="robots"]');
  return { withheld: w ? w.getAttribute('data-zip-withheld') : null, robots: m ? (m.getAttribute('content') || '') : '' };
}

// Pure verdict. `st` = readWithheldInPage() for the page loaded for `zip`.
export function judgeWithheld(zip, isWithheld, st) {
  const fails = [];
  if (isWithheld) {
    if (st.withheld !== zip) fails.push(`ZIP ${zip}: withheld on the live site, but its page did not show the "not available" notice (got ${JSON.stringify(st.withheld)})`);
    if (!/noindex/i.test(st.robots || '')) fails.push(`ZIP ${zip}: withheld, but its page is not noindex (robots="${st.robots}")`);
  } else if (st.withheld) {
    fails.push(`ZIP ${zip}: shows the withheld notice (for ${st.withheld}) but is not on the deployed withheld list`);
  }
  return fails;
}
