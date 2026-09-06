// FORENSIC: where do 28456's 12 authoritative markers become 6?
//
// Gate 1 of the record-loss unit. This does not assert a contract - it accounts for the SAME
// identities stage by stage and names the exact records that disappear and the boundary they
// disappear at. 28456 is the control precisely because it is tiny: 12 records, so no payload,
// timeout or transport explanation is available.
import { chromium } from 'playwright';

const BASE = process.env.SITE_BASE || 'https://homesignal.net';
const ZIPS = (process.env.PROBE_ZIPS || '28456,19103').split(',').map(s => s.trim()).filter(Boolean);

const browser = await chromium.launch();
console.log('MAP 1 RECORD-LOSS FORENSICS — ' + BASE + '\n');

for (const zip of ZIPS) {
  const page = await browser.newPage();
  let rpcRaw = null, rpcStatus = null, rpcBytes = 0;
  page.on('response', async (res) => {
    if (res.url().includes('/rpc/app_zip_projects_markers')) {
      rpcStatus = res.status();
      try { const t = await res.text(); rpcBytes = t.length; rpcRaw = JSON.parse(t); }
      catch (e) { rpcRaw = { _parse_error: String(e) }; }
    }
  });

  await page.goto(`${BASE}/homesignalmap.html?zip=${zip}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__HS_SITES !== undefined, { timeout: 60000 }).catch(() => {});
  let prev = -1, stable = 0;
  for (let i = 0; i < 45 && stable < 3; i++) {
    await page.waitForTimeout(1000);
    const n = await page.evaluate(() => (window.__HS_SITES || []).length);
    stable = (n === prev) ? stable + 1 : 0; prev = n;
  }

  // Re-run the SHIPPED conversion inside the live page, on the SAME payload the page received,
  // so each stage is the page's own code rather than a re-implementation of it.
  const stages = await page.evaluate((raw) => {
    const H = window.HS;
    const out = { hasHS: !!H };
    if (!H) return out;
    out.rpcMarkers  = raw && Array.isArray(raw.markers)  ? raw.markers.length  : -1;
    out.rpcProjects = raw && Array.isArray(raw.projects) ? raw.projects.length : -1;
    out.declared    = raw ? { membership: raw.membership_count, marker: raw.marker_count, project: raw.project_count } : null;
    out.isComplete  = H.zipAuthIsComplete ? !!H.zipAuthIsComplete(raw) : null;

    const authSites = H.zipAuthSitesFrom(raw) || [];
    out.zipAuthSitesFrom = authSites.length;
    out.authRefs = authSites.map(s => s.zip_project_ref);

    // per-marker outcome, using the page's OWN converter, to find which markers yield null
    const byRef = Object.create(null);
    (raw && raw.projects || []).forEach(p => { if (p && p.project_ref && !byRef[p.project_ref]) byRef[p.project_ref] = p; });
    const perMarker = (raw && raw.markers || []).map(m => {
      const site = H.zipAuthSiteFromMarker(m, byRef[m.project_ref]);
      return { ref: m.project_ref, seq: m.marker_seq, hasProject: !!byRef[m.project_ref],
               lat: m.lat, lng: m.lng, site: !!site,
               record_url: site ? site.record_url : null };
    });
    out.markersYieldingNull = perMarker.filter(x => !x.site).length;
    // WHY each one is null. zipAuthSiteFromMarker has exactly two null exits:
    //   (a) !project  (b) lat/lng not a finite NUMBER
    out.nullReasons = perMarker.filter(x => !x.site).slice(0, 8).map(x => ({
      ref: x.ref, hasProject: x.hasProject,
      latType: typeof x.lat, lngType: typeof x.lng, lat: x.lat, lng: x.lng
    }));
    // and a survivor for contrast
    out.survivorSample = perMarker.filter(x => x.site).slice(0, 2).map(x => ({
      ref: x.ref, hasProject: x.hasProject, latType: typeof x.lat, lat: x.lat
    }));
    // do the project refs actually cover the marker refs?
    out.projectRefCount = Object.keys(byRef).length;
    out.markerRefsMissingFromProjects = (raw && raw.markers || [])
      .map(m => m.project_ref).filter(r => !byRef[r]).slice(0, 8);

    // what actually reached the rendered set
    const live = window.__HS_SITES || [];
    const liveAuth = live.filter(s => s && s.zip_authoritative === true);
    out.liveTotal = live.length;
    out.liveAuthoritative = liveAuth.length;
    out.liveAuthRefs = liveAuth.map(s => s.zip_project_ref);

    // the anti-fabrication predicate, applied to the converted sites
    const sourced = (s) => !!(s && ((s.url && String(s.url).trim()) || (s.record_url && String(s.record_url).trim())));
    out.authSitesFailingSourced = authSites.filter(s => !sourced(s)).length;

    // WHICH refs were converted but never reached __HS_SITES
    const liveSet = new Set(liveAuth.map(s => s.zip_project_ref));
    out.convertedButNotRendered = authSites.map(s => s.zip_project_ref).filter(r => !liveSet.has(r));
    return out;
  }, rpcRaw);

  console.log(`── ${zip} · rpc HTTP ${rpcStatus} · ${rpcBytes} bytes`);
  console.log(`   declared            ${JSON.stringify(stages.declared)}`);
  console.log(`   rpc markers/projects ${stages.rpcMarkers} / ${stages.rpcProjects}   complete=${stages.isComplete}`);
  console.log(`   zipAuthSitesFrom     ${stages.zipAuthSitesFrom}`);
  console.log(`   markers yielding null ${stages.markersYieldingNull}`);
  console.log(`   distinct project refs in byRef ${stages.projectRefCount}`);
  console.log(`   marker refs MISSING from projects ${JSON.stringify(stages.markerRefsMissingFromProjects)}`);
  console.log(`   NULL REASONS ${JSON.stringify(stages.nullReasons, null, 1)}`);
  console.log(`   survivor sample ${JSON.stringify(stages.survivorSample)}`);
  console.log(`   authSites failing sourced() ${stages.authSitesFailingSourced}`);
  console.log(`   __HS_SITES total / authoritative  ${stages.liveTotal} / ${stages.liveAuthoritative}`);
  console.log(`   CONVERTED BUT NOT RENDERED (${(stages.convertedButNotRendered||[]).length}): ${JSON.stringify((stages.convertedButNotRendered||[]).slice(0,10))}`);
  console.log('');
  await page.close();
}
await browser.close();
