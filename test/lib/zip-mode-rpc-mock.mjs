// Browser-suite mock for public.zip_mode_report_sites (docs/zip-membership-canonical.sql §3).
//
// Since 2026-09-22 Map 1 ZIP mode reads the report's facility/notice plane ONLY through that
// RPC, never as raw development_reports.sites. A browser test cannot run PostGIS, so this
// mock reproduces the RPC's SHAPE and its non-geometric rules from the same fixture row the
// test already serves for the REST read:
//   - development points are not served (they arrive via app_zip_projects_markers);
//   - area-scope notices pass through untouched;
//   - every remaining point is stamped zip_membership:'member' — the fixtures are verbatim
//     in-ZIP production objects, and the geometric verdict itself is proven where it can be,
//     in test/zip_membership_pg (PostGIS) and the national proof, not here.
// A test that wants an OUTSIDE or unmeasured facility passes `verdictOf`.

/** The p_zip argument of a POSTed RPC call, or null. */
export function rpcZip(route) {
  try { return JSON.parse(route.request().postData() || '{}').p_zip || null; } catch { return null; }
}

/** Build the RPC payload from the REST-shaped rows (an array of development_reports rows). */
export function zipModeReportPayload(rows, zip, { verdictOf } = {}) {
  const row = Array.isArray(rows) ? rows[0] : rows;
  const counts = { member: 0, outside: 0, not_measured: 0, no_coordinates: 0 };
  if (!row || !Array.isArray(row.sites)) {
    return { zip, status: 'no_report', sites: [], facility_counts: counts };
  }
  const sites = [];
  for (const s of row.sites) {
    const isPoint = s && s.scope === 'point';
    if (!isPoint) { sites.push(s); continue; }
    if ((s.relevance || '') === 'development') continue;
    const v = verdictOf ? verdictOf(s) : 'member';
    counts[v] = (counts[v] || 0) + 1;
    if (v === 'member') sites.push({ ...s, zip_membership: 'member' });
  }
  return { zip, status: 'complete', sites, facility_counts: counts };
}

/** Fulfil a /rpc/zip_mode_report_sites route from a rows-for-zip lookup. */
export function fulfillZipModeReport(route, rowsForZip, opts) {
  const zip = rpcZip(route);
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(zipModeReportPayload(rowsForZip(zip), zip, opts)) });
}
