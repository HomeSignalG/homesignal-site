// Tab 17 data-center project check: open a project link the way a reader would and confirm it shows that project.
//
// Desktop (1280x900) and phone (390x844). A link is verified only when, at both sizes, the page loads, Map 1 focuses the
// project under the expected map key, the project panel is visible and names the project, and no "not on the map" /
// "could not be looked up" notice is shown. Anything else is reported with what was seen; nothing is retried here (the
// job's own retry rule decides).
//
// `launch` is injectable so the browser test can serve a local copy of the page.
export async function checkProjectPage(link, expect, opts = {}) {
  const { chromium } = await import('playwright');
  const browser = await (opts.launch ? opts.launch() : chromium.launch());
  const checks = [];
  try {
    for (const vp of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const c = { viewport: vp.name, ok: false };
      try {
        const resp = await page.goto(link, { waitUntil: 'domcontentloaded', timeout: opts.timeout || 45000 });
        c.http = resp ? resp.status() : null;
        if (!resp || resp.status() >= 400) { c.error = 'HTTP ' + c.http; checks.push(c); await ctx.close(); continue; }
        await page.waitForFunction(() => window.__HS_PROJECT_FOCUS || window.__HS_PROJECT_NOTICE,
          null, { timeout: opts.timeout || 45000 });
        const seen = await page.evaluate(() => {
          const p = document.getElementById('projPanel');
          return { focus: window.__HS_PROJECT_FOCUS || null, notice: window.__HS_PROJECT_NOTICE || null,
            panelVisible: !!(p && !p.hidden && p.offsetHeight > 0), panelText: p ? p.textContent.slice(0, 4000) : '' };
        });
        c.focus = seen.focus; c.notice = seen.notice; c.panel_visible = seen.panelVisible;
        if (seen.notice) c.error = 'The page showed the notice "' + seen.notice + '".';
        else if (!seen.focus || seen.focus.mapKey !== expect.mapKey) c.error = 'The page focused a different project.';
        else if (!seen.panelVisible) c.error = 'The project panel did not open.';
        else if (expect.name && !seen.panelText.includes(expect.name)) c.error = 'The project panel does not name the project.';
        else c.ok = true;
      } catch (e) {
        c.error = 'The page did not finish loading: ' + String(e && e.message || e).split('\n')[0].slice(0, 160);
        c.load_failed = true;
      }
      checks.push(c);
      await ctx.close();
    }
  } finally { await browser.close(); }
  const allOk = checks.every((c) => c.ok);
  const loadFailed = checks.some((c) => c.load_failed || (c.http && c.http >= 500));
  return { state: allOk ? 'verified' : loadFailed ? 'error' : 'mismatch', checks,
    error: allOk ? null : checks.filter((c) => !c.ok).map((c) => c.viewport + ': ' + c.error).join('; ') };
}
