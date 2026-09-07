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
// The window is SYMMETRIC, so the ceiling is the SAME constant mirrored — never a second
// one. Two numbers can drift apart; one cannot drift from itself. Same UTC date-slice as
// the floor, so both ends are built identically and a timezone change moves them together.
const currentCeiling = new Date(Date.now() + SOURCE_CURRENT_DAYS * 86400000)
  .toISOString()
  .slice(0, 10);
// ✅ THE +90 CEILING IS RESTORED — 2026-09-07. It was withheld on purpose, and the reason
// it was withheld is gone, so this is the change that was promised rather than a loosening.
//
// WHAT WAS WRONG: 322 canonical ZIP pages across 17 counties failed the ceiling because of
// a HomeSignal CONFIGURATION DEFECT, not because their sources were stale. Every one is a
// CivicClerk feed; the vendor caps a page at ~15 rows regardless of $top, so
// `$orderby=startDateTime desc` returned only the tenant's far-future tail and the county's
// current meetings — sitting in the middle of the tenant's history — were unreachable.
// Applying the ceiling then would have deleted 322 pages of correct coverage to enforce a
// rule against our own query.
//
// WHAT REPAIRED IT: homesignal-ingest PR #480, squash-merged to main 2026-09-07T17:19:32Z as
// f67959ff7ef78b281fa2e350d92aebaf2b4496ba. adapters/civicclerk.py now bounds the fetch with
// `$filter=startDateTime le {today+90}`, reading the 90 from
// ingest.GOV_NOTICE_SOURCE_CURRENT_FUTURE_DAYS so the fetch bound cannot drift from the
// window it serves.
//
// PROOF THE REPAIR REACHED STORED ROWS — ingest.yml run #597 (databaseId 34154189876,
// workflow_dispatch, dry_run false, head_sha f67959f). Measured on the JOB, never the run:
// job 101842478462 started 2026-09-07T19:04:59Z, completed 2026-09-07T20:25:11Z, conclusion
// success, and the three write steps ("Classify news subtopics", "Sync feed inventory",
// "Refresh & publish acquisition dashboard snapshot") all COMPLETED SUCCESS rather than
// being skipped — which is what proves dry_run did not take. It wrote 15 in-window notices
// to each of the 17 counties (10 to Benton WA).
//
// GATE 5, measured 2026-09-07 21:11Z: 17 of 17 cohort counties now hold at least one
// government_notice alert dated inside -90/+90, and 0 of the cohort's 322 ZIP rows remain
// stale. Cohort frozen in public.gn_civicclerk_window_defect_20260906.
//
// MEMBERSHIP IS UNCHANGED BY THIS CEILING, and that was measured BEFORE the edit rather
// than hoped for afterwards: simulating this generator's own predicate with and without the
// ceiling returns 7,121 ZIPs both ways, md5 3fa1825f8d5ddde0f3dd230c43e27407 both ways,
// 0 dropped and 0 added.
//
// THE ENGINE SQL ALREADY ENFORCED BOTH ENDS and is NOT edited by this change — quoted here
// so the two halves can be compared without opening the other repo
// (homesignal-ingest scripts/measure_gov_notices.sql, current_notice_roots):
//
//     and a.published_at::date between current_date - 90 and current_date + 90
//     and a.published_at::date between current_date - 365 and current_date + 730
//
// ⚠️ The second line is the RECORD-ELIGIBILITY window (-365/+730) and is a DIFFERENT
// contract. Do not merge the two: a CURRENT source legitimately displays qualifying records
// 91-365 days old, and nothing here filters what a page shows.
const delivered = await all(
  `alerts?pipeline_type=eq.government_notice&published_at=gte.${currentFloor}&published_at=lte.${currentCeiling}`,
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
