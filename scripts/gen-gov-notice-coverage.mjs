#!/usr/bin/env node
// Regenerates lib/generated/gov-notice-coverage.json — the list of canonical ZIP pages
// that have a Government Notices source wired.
//
// WHY THIS READS `alerts` AND NOT `feeds`. public.feeds is the configuration source of
// truth, but it has RLS enabled with ZERO policies, so the anon key (the only key this
// repo holds) cannot read it and neither can the browser. `alerts` IS anon-readable, and
// the two agree exactly: measured 2026-09-04 against the live project, the set of ZIPs
// whose chain reaches an ACTIVE government_notice feed and the set whose chain reaches a
// delivered government_notice alert have a symmetric difference of ZERO (6,231 each, of
// 12,722 canonical). Delivery is also the more conservative predicate for this file's
// purpose: it can only ever understate wiring, and understating moves a page to the copy
// that asserts the least.
//
// THE CHAIN WALK IS THE POINT. A ZIP inherits Government Notices from its routing root by
// walking communities.parent_id DOWN from the content-bearing community — never by
// matching on (state, county). Independent cities share their county's NAME while having
// a separate government: Baltimore city delivers and Baltimore County does not, and a
// (state, county) join would silently grant the county the city's coverage. Measured:
// that shortcut inflates coverage by 96 ZIP pages across MD Baltimore and VA Fairfax.
//
// Usage:  node scripts/gen-gov-notice-coverage.mjs [--check]
//   --check  regenerate in memory and diff against the committed file; exit 1 on drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'lib/generated/gov-notice-coverage.json');
const cfg = readFileSync(join(root, 'config.js'), 'utf8');
const url = (cfg.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)/) || [])[1];
const key = process.env.SUPABASE_ANON_KEY || (cfg.match(/SUPABASE_ANON_KEY\s*:\s*['"]([^'"]+)/) || [])[1];
if (!url || !key) { console.error('no Supabase url/key available'); process.exit(2); }

async function all(path, select) {
  const out = []; let from = 0; const page = 1000;
  for (;;) {
    const r = await fetch(`${url}/rest/v1/${path}&select=${select}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + page - 1}` }
    });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < page) return out;
    from += page;
  }
}

const communities = await all('communities?id=not.is.null', 'id,parent_id,level,zip_codes');

// SOURCE CURRENTNESS (founder ruling 2026-09-06). A community only anchors coverage when
// it has a CURRENT source: at least one qualifying dated government notice no more than
// 90 days in the PAST. Applied here so the committed artifact cannot claim coverage that
// is held up only by stale content — the guarantee is structural, not coincidental.
//
//   * `gte` and no upper bound (beyond the +730 the ingest guard already enforces before
//     a row is ever stored): on this corpus the normalized GN date is often the MEETING
//     date, not the posting date. A strictly-past window marks live agenda-publishing
//     counties stale. Control measured 2026-09-06: Dorchester SC's live feed returned 103
//     items whose newest POSTING date was two days old while its stored notice dates are
//     2026-09-08 and 2026-03-17.
//   * This is NOT the record-display window. Records 91–365 days old stay displayable on
//     a current source; nothing here filters what a page shows.
//   * The engine-side measurement (homesignal-ingest scripts/measure_gov_notices.sql)
//     additionally requires an ACTIVE government_notice/alerts feed. This generator
//     cannot: public.feeds has RLS with zero policies, so the anon key sees none of it.
//     Both give the same membership today; the engine measurement is the stricter of the
//     two and is the one to trust if they ever diverge.
const SOURCE_CURRENT_DAYS = 90;
const currentFloor = new Date(Date.now() - SOURCE_CURRENT_DAYS * 86400000)
  .toISOString()
  .slice(0, 10);
// ⚠️ THE +90 CEILING IS DELIBERATELY *NOT* APPLIED HERE, AND THAT IS A DECISION WITH A
// REASON, NOT AN OVERSIGHT. The founder refined the source-currentness window to a
// symmetric -90/+90 on 2026-09-06, and the engine measurement
// (homesignal-ingest scripts/measure_gov_notices.sql) enforces both ends. Applying the
// ceiling HERE would drop 322 canonical ZIP pages across 17 counties from the artifact.
//
// Those 17 fail the ceiling because of a HomeSignal CONFIGURATION DEFECT, not because
// their sources are stale. Every one is a CivicClerk feed configured
// `$top=5&$orderby=startDateTime desc`; the vendor caps a page at ~15 rows, so descending
// order returns only the far-future tail and the county's current meetings — which sit in
// the middle of the tenant's history — are unreachable. Proven live 2026-09-06: the Anne
// Arundel tenant holds 437 events and a date-bounded refetch returns 15, ALL inside
// -90/+90 with 6 past-dated; Delaware County PA holds 1,390 and likewise returns 15 all
// inside the window. The sources are current; our query cannot see them.
//
// Removing 322 pages of correct coverage to enforce a rule against our own defect would
// be trading correctness for nothing. The repair needs a RELATIVE date bound that a static
// feeds.csv URL cannot express, so it is architectural and is HELD, not attempted.
// Cohort frozen in public.gn_civicclerk_window_defect_20260906.
// Restore the ceiling here in the same change that repairs those endpoints.
const delivered = await all(
  `alerts?pipeline_type=eq.government_notice&published_at=gte.${currentFloor}`,
  'community_id',
);

const kids = new Map();
for (const c of communities) if (c.parent_id) (kids.get(c.parent_id) || kids.set(c.parent_id, []).get(c.parent_id)).push(c.id);
const byId = new Map(communities.map((c) => [c.id, c]));

// walk DOWN from every content-bearing community
const seen = new Set();
const stack = [...new Set(delivered.map((a) => a.community_id))].filter((id) => byId.has(id));
while (stack.length) {
  const id = stack.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const k of kids.get(id) || []) stack.push(k);
}
const configured = new Set();
for (const id of seen) {
  const c = byId.get(id);
  if (c && c.level === 'zip') for (const z of c.zip_codes || []) configured.add(String(z));
}
const canonical = new Set();
for (const c of communities) if (c.level === 'zip') for (const z of c.zip_codes || []) canonical.add(String(z));

const zips = [...configured].sort();
// The control: a generator that silently produced an empty or a total set would look
// exactly like a working one. Refuse both.
if (canonical.size !== 12722) throw new Error(`canonical ZIP count is ${canonical.size}, expected 12722`);
if (zips.length === 0 || zips.length === canonical.size) throw new Error(`implausible configured count ${zips.length}`);
for (const z of zips) if (!canonical.has(z)) throw new Error(`configured ZIP ${z} is not canonical`);

const prev = JSON.parse(readFileSync(OUT, 'utf8'));
const artifact = {
  _generated: prev._generated,
  _regenerate: prev._regenerate,
  _contract: prev._contract,
  _measured_at: new Date().toISOString().slice(0, 16) + 'Z',
  _counts: { canonical_zip_pages: canonical.size, configured: zips.length, unconfigured: canonical.size - zips.length },
  configured_zips: zips
};
if (process.argv.includes('--check')) {
  const same = JSON.stringify(prev.configured_zips) === JSON.stringify(zips);
  console.log(same ? `OK  ${zips.length} configured / ${canonical.size} canonical`
                   : `DRIFT committed=${prev.configured_zips.length} live=${zips.length}`);
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, JSON.stringify(artifact) + '\n');
console.log(`wrote ${zips.length} configured / ${canonical.size} canonical`);
