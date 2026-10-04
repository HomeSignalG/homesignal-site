// THE PAID-REPORT SOURCE LIST IS THE REGISTRY, ALL OF IT, GENERATED — founder ruling R7 (2026-10-04).
//
// supabase/functions/_shared/report-rights.json lists every source in supabase/functions/get-address-report/jurisdiction-registry.json, and
// docs/development-activity-founder-ruling-r7-2026-10-04.md §2 lists the same sources. Both are produced by scripts/build-report-rights.mjs,
// never typed (a list of 240 ids that somebody typed is a list that can silently lose one). This test pins:
//   1. the shipped file and the ruling's block are byte-for-byte what the generator yields from the registry today;
//   2. the list is the registry exactly (240 ids, no extra, none missing), with the fingerprint that was also computed IN THE DATABASE on
//      2026-10-04 against the same array;
//   3. a NEW registry source is NOT cleared by regenerating: the fingerprint below must be changed on purpose, in a new ruling (R8);
//   4. the ruling carries the founder's words and does not claim a publisher's grant;
//   5. the three publisher credit lines are the only ones, each backed by that publisher's own evidence file.
// And the checks are shown able to fail: a list that lost one id, gained one, or whose ruling block was edited by hand is refused by name.
//
// Run: node test/report-rights-r7.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, RIGHTS_PATH, RULING_PATH, RULING_SECTION, CLEARED_ON, VERSION, BEGIN, END, PUBLISHER_ATTRIBUTION, build, withBlock, registryIds, fingerprint } from '../scripts/build-report-rights.mjs';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400) + ']' : '')); } };
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Computed in the production database on 2026-10-04 over the same 240-id array (md5(string_agg(registry_id, ',' order by registry_id collate "C"))).
// A new registry source changes this. That is the point: clearing it is a decision, so this line is edited in the change that records it.
const FINGERPRINT_2026_10_04 = '32af7ab5a9f963a562e9af19eab246bf';

const shipped = JSON.parse(read(RIGHTS_PATH));
const ids = registryIds();
const gen = build();

// ---- 1. generated, not typed -----------------------------------------------------------------------------------------------------------------
ok(read(RIGHTS_PATH) === gen.jsonText, '1a report-rights.json is byte-for-byte what the generator yields from the registry');
ok(read(RULING_PATH) === withBlock(read(RULING_PATH), gen.block), '1b the ruling\'s source block is byte-for-byte what the generator yields');
{
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/build-report-rights.mjs')], { encoding: 'utf8' });
  ok(r.status === 0 && /^OK — /.test(r.stdout), '1c the generator\'s own --check run exits 0 and says OK (it ran, over what this test thinks it ran over)', [r.status, r.stdout, r.stderr]);
}

// ---- 2. the list IS the registry ---------------------------------------------------------------------------------------------------------------
const listed = shipped.cleared.map((e) => e.registry_id);
ok(ids.length === 240, '2a (control) the jurisdiction registry was read: ' + ids.length + ' sources', ids.length);
ok(listed.length === ids.length && JSON.stringify([...listed].sort()) === JSON.stringify(ids), '2b the list is the registry exactly: nothing missing, nothing extra, no repeats',
  { listed: listed.length, registry: ids.length, missing: ids.filter((i) => !listed.includes(i)).slice(0, 5), extra: listed.filter((i) => !ids.includes(i)).slice(0, 5) });
ok(fingerprint(ids) === FINGERPRINT_2026_10_04 && fingerprint([...listed].sort()) === FINGERPRINT_2026_10_04,
  '2c its fingerprint equals the one computed in the database on 2026-10-04 (a new registry source fails this until a new ruling changes it)', fingerprint(ids));
ok(shipped.version === VERSION && VERSION === 2 && shipped.cleared.every((e) => e.cleared_on === CLEARED_ON && e.audit_ref === RULING_PATH + ' §' + RULING_SECTION),
  '2d version 2, every entry dated the ruling\'s day and pointing at the ruling\'s section');

// ---- 3. the checks can fail ----------------------------------------------------------------------------------------------------------------------
{
  const lost = { ...shipped, cleared: shipped.cleared.slice(1) };
  const gained = { ...shipped, cleared: [...shipped.cleared, { registry_id: 'a-source-nobody-registered', cleared_on: CLEARED_ON, audit_ref: RULING_PATH + ' §2', attribution: '' }] };
  const same = (r) => JSON.stringify([...r.cleared.map((e) => e.registry_id)].sort()) === JSON.stringify(ids);
  ok(!same(lost) && !same(gained) && same(shipped), '3a (control) a list that lost one source, and one that gained a source nobody registered, are both told apart from the real one');
  const edited = read(RULING_PATH).replace('- `' + ids[0] + '`', '- `' + ids[0] + '-edited-by-hand`');
  ok(edited !== read(RULING_PATH) && edited !== withBlock(edited, gen.block), '3b (control) a ruling whose block was edited by hand no longer equals the generator\'s block');
  let threw = false; try { withBlock('no markers here', gen.block); } catch { threw = true; }
  ok(threw && read(RULING_PATH).split(BEGIN).length === 2 && read(RULING_PATH).split(END).length === 2, '3c the generated block has its markers exactly once, and a file without them is refused rather than appended to');
}

// ---- 4. the ruling says what it is -------------------------------------------------------------------------------------------------------------
{
  const md = read(RULING_PATH);
  ok(md.split('\n').some((l) => l === '> just make all 12,722 prodiuce report with records') && md.split('\n').some((l) => l === '> i do not undertsnd. every zip code she be producinga report with records'),
    '4a the founder\'s two sentences are quoted exactly as typed (spelling kept)');
  ok(/accepting a risk/.test(md) && /not a publisher's grant/.test(md) && /does not\s+reinterpret any HOLD as cleared/.test(md) && /\*\*NOT YET\*\*/.test(md),
    '4b it says this is a risk the founder accepted, not a publisher\'s grant, that no HOLD is reinterpreted, and that the audit verdict is NOT YET');
  ok(/does not make every ZIP show records/i.test(md) && /8,215/.test(md) && /4,507/.test(md) && /half a mile/.test(md),
    '4c it says plainly that not every ZIP can show records (8,215 of 12,722 have any; the report covers half a mile) so nobody reads "all 12,722" as a promise');
  ok(/does not clear the property-placement inputs/i.test(md) && /Terms of Use/.test(md) && /does not open billing/i.test(md) && /How to undo/.test(md),
    '4d it names what it leaves open: the geocoder and ZCTA terms, the Terms of Use, billing, and how to undo it');
}

// ---- 5. the credit lines --------------------------------------------------------------------------------------------------------------------------
{
  const withCredit = shipped.cleared.filter((e) => e.attribution !== '').map((e) => e.registry_id).sort();
  ok(JSON.stringify(withCredit) === JSON.stringify(Object.keys(PUBLISHER_ATTRIBUTION).sort()) && withCredit.length === 3, '5a exactly three sources carry a credit line, the three with a recorded publisher requirement', withCredit);
  for (const [id, a] of Object.entries(PUBLISHER_ATTRIBUTION)) {
    const ev = existsSync(join(ROOT, a.evidence)) ? read(a.evidence) : '';
    const e = shipped.cleared.find((x) => x.registry_id === id);
    ok(ev.includes(a.dataset) && /CLEARED WITH ATTRIBUTION/.test(ev) && ids.includes(id) && e && e.attribution === a.text,
      '5b ' + id + ': the publisher\'s own evidence file (' + a.evidence + ') names dataset ' + a.dataset + ' and says CLEARED WITH ATTRIBUTION, and the list carries the recorded credit line');
  }
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
