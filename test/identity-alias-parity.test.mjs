// IDENTITY ALIASES, END TO END (offline): the shipped connector, the shared case table, fail-closed behaviour, and the Python twin.
// Run: node test/identity-alias-parity.test.mjs
//
// REAL: sources/arcgis.ts (arcgisForZip, recordIdentity) and sources/identity-aliases.ts are IMPORTED and run; the registry entry
// is the COMMITTED denton-county-dev-permits entry. Since 2026-10-14 the committed registry opts Denton in (the reviewed generated file
// was committed with its index.ts import); the "no opt-in" controls below run on BASE, the same entry with the option removed in memory.
// SYNTHETIC: the layer rows (test/fixtures/identity-aliases/denton-shaped-scan.json) - shaped like Denton's, not publisher data.
// TWO IMPLEMENTATIONS, ONE TABLE: test/fixtures/identity-aliases/parity-cases.json is asserted here against the TypeScript rule
// and by scripts/test_identity_aliases.py against the Python rule (spawned at the end, so a green run here means both).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.IA_SOURCES_DIR || join(root, 'supabase/functions/get-address-report/sources');
let n = 0, fails = 0;
const ok = (c, name, detail) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (!c && detail !== undefined ? '\n     ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); if (!c) fails++; };

const { arcgisForZip, recordIdentity } = await import(pathToFileURL(join(SRC, 'arcgis.ts')).href);
const { aliasFileFor, applyIdentityAlias } = await import(pathToFileURL(join(SRC, 'identity-aliases.ts')).href);
const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8')).arcgis;
const DENTON = REG.find((e) => e.registry_id === 'denton-county-dev-permits');
const BASE = (() => { const b = { ...DENTON }; delete b.identity_aliases_file; return b; })();   // the entry WITHOUT the opt-in (controls)
const PARITY = JSON.parse(readFileSync(join(root, 'test/fixtures/identity-aliases/parity-cases.json'), 'utf8'));
const SCAN = JSON.parse(readFileSync(join(root, 'test/fixtures/identity-aliases/denton-shaped-scan.json'), 'utf8')).features;
const FILE_NAME = 'denton-county-dev-permits.json';
const OPT = { ...BASE, identity_aliases_file: FILE_NAME };
const FILES = { [FILE_NAME]: PARITY.file };

ok(!!DENTON && DENTON.column_map.case_number === 'PermitID' && !DENTON.identity_fields, 'the committed Denton entry identifies by PermitID, no identity_fields');
ok(DENTON.identity_aliases_file === FILE_NAME, 'the committed registry opts Denton in with the reviewed generated file (activated 2026-10-14)');
ok(!('identity_aliases_file' in BASE), 'control: BASE (the entry without the opt-in) has no opt-in');

// ── 1. the shared case table through the TypeScript rule ──────────────────────────────────────────────────────────────────────
{
  const v = aliasFileFor(OPT, FILES);
  ok(v && v.ok === true, 'aliasFileFor accepts the Denton file for the Denton entry', v);
  for (const c of PARITY.cases) {
    ok(applyIdentityAlias(c.row, c.base, v) === c.expected, 'TS: ' + c.name, applyIdentityAlias(c.row, c.base, v));
  }
}

// ── 2. fail closed: every way the file can be unusable gives the LEGACY identity and says why ───────────────────────────────
{
  const row = { OBJECTID: 4001, PermitID: '20062248' };
  const legacy = (v) => applyIdentityAlias(row, '20062248', v) === '20062248';
  ok(aliasFileFor(BASE, FILES) === null && legacy(null), 'no opt-in: no verdict, legacy identity');
  const notLoaded = aliasFileFor(OPT, {});
  ok(notLoaded && notLoaded.ok === false && /not loaded/.test(notLoaded.reason) && legacy(notLoaded), 'declared but not loaded: reported, legacy identity', notLoaded);
  const other = aliasFileFor(OPT, { [FILE_NAME]: { ...PARITY.file, registry_id: 'someone-else' } });
  ok(other && !other.ok && /belongs to/.test(other.reason) && legacy(other), 'a file for another registry_id is refused', other);
  const wrongCol = aliasFileFor(OPT, { [FILE_NAME]: { ...PARITY.file, id_field: 'OtherCol' } });
  ok(wrongCol && !wrongCol.ok && /column/.test(wrongCol.reason) && legacy(wrongCol), 'a file for another identifier column is refused', wrongCol);
  const both = aliasFileFor({ ...OPT, identity_fields: ['PermitID', 'OBJECTID'] }, FILES);
  ok(both && !both.ok && /mutually exclusive/.test(both.reason), 'identity_fields + identity_aliases_file is refused (a compound identity already exists)', both);
  const shape = aliasFileFor(OPT, { [FILE_NAME]: { version: 2, aliases: null } });
  ok(shape && !shape.ok && legacy(shape), 'an unknown file shape is refused', shape);
}

// ── 3. the connector, end to end ───────────────────────────────────────────────────────────────────────────────────────────
const asFeature = (f) => ({ attributes: { ...f.attrs }, geometry: f.x == null ? undefined : { x: f.x, y: f.y } });
async function run(entry, files, features = SCAN) {
  const feats = features.filter((f) => f.attrs.PermitID != null && String(f.attrs.PermitID).trim() !== '').map(asFeature);
  const fx = async (u) => new Response(JSON.stringify(new URL(String(u)).searchParams.get('resultOffset') === '0' ? { features: feats, exceededTransferLimit: false } : { features: [] }), { status: 200 });
  const out = await arcgisForZip('76210', [{ state: 'TX', county: 'Denton' }], [entry], { fetch: fx, zipCentroid: { lat: 33.2, lng: -97.1 }, identityAliases: files });
  return { out, ids: out.sites.map((s) => s.source_id), report: out.reports[0] };
}
{
  // expected identity per OBJECTID, written WITHOUT the rule under test: listed in the file -> alias, else the bare id
  const expectFor = (f) => (PARITY.file.aliases[String(f.attrs.OBJECTID)] ?? String(f.attrs.PermitID).trim());
  const usable = SCAN.filter((f) => f.attrs.PermitID != null && String(f.attrs.PermitID).trim() !== '');
  const want = usable.map((f) => `arcgis:denton-county-dev-permits:${expectFor(f)}`);

  const off = await run(BASE, FILES);
  ok(off.ids.length === usable.length, 'control: every usable fixture feature is emitted by the connector', [off.ids.length, usable.length]);
  ok(off.ids.every((id, i) => id === `arcgis:denton-county-dev-permits:${String(usable[i].attrs.PermitID).trim()}`),
    'WITHOUT the opt-in every record keeps the bare PermitID (today\'s behaviour, even with a file loaded)');
  const dupBare = off.ids.length - new Set(off.ids).size;
  ok(dupBare >= 8, 'control: without aliases the fixture\'s reused ids DO collapse onto shared keys (' + dupBare + ' shared) - the defect', dupBare);

  const on = await run(OPT, FILES);
  ok(JSON.stringify(on.ids) === JSON.stringify(want), 'WITH the opt-in each record gets exactly the file\'s identity (alias or bare id)', { got: on.ids, want });
  const distinctOn = new Set(on.ids).size;
  ok(distinctOn > new Set(off.ids).size, `reused ids now produce distinct keys (${new Set(off.ids).size} -> ${distinctOn})`);
  ok(on.report.identity_alias_applied === Object.keys(PARITY.file.aliases).filter((o) => usable.some((f) => String(f.attrs.OBJECTID) === o)).length,
    'run report counts the aliased records', on.report.identity_alias_applied);
  ok(on.ids.includes('arcgis:denton-county-dev-permits:20062248') && on.ids.includes('arcgis:denton-county-dev-permits:20062248#4001'),
    'the legacy key of a reused id survives for the lowest OBJECTID and a new key exists for the other');
  ok(on.ids.filter((i) => i === 'arcgis:denton-county-dev-permits:20110001').length === 2,
    'a true publisher duplicate keeps the SAME key (exact-identity dedup still collapses it)');

  // declared but not loaded: legacy keys + a visible quarantine note
  const miss = await run(OPT, {});
  ok(JSON.stringify(miss.ids) === JSON.stringify(off.ids), 'declared but not loaded: legacy keys', miss.ids);
  ok(miss.report.quarantined.some((q) => /identity alias file unavailable/.test(q.reason)), 'and the run report says the file was unavailable', miss.report.quarantined);

  // out_fields that drop OBJECTID: aliases cannot apply, nothing breaks
  const noOid = await run(OPT, FILES, SCAN.map((f) => ({ ...f, attrs: Object.fromEntries(Object.entries(f.attrs).filter(([k]) => k !== 'OBJECTID')) })));
  ok(noOid.ids.every((id) => !id.includes('#')), 'rows without OBJECTID keep the legacy key (no alias minted from nothing)');
}

// ── 4. the renumbering limitation, pinned (the guard is the daily live fingerprint, not this function) ───────────────────────
{
  const swapped = SCAN.map((f) => (f.attrs.OBJECTID === 101 ? { ...f, attrs: { ...f.attrs, OBJECTID: 4001 } } : f.attrs.OBJECTID === 4001 ? { ...f, attrs: { ...f.attrs, OBJECTID: 101 } } : f));
  const r = await run(OPT, FILES, swapped);
  const pre = await run(OPT, FILES);
  const key = (res, addr) => res.out.sites.find((s) => (s.address || '').includes(addr))?.source_id;
  // if OBJECTIDs 101 and 4001 trade owners, the FAR RD permit inherits the legacy key and the OAK LN permit the alias
  ok(key(pre, 'FAR RD') === 'arcgis:denton-county-dev-permits:20062248#4001' && key(r, 'FAR RD') === 'arcgis:denton-county-dev-permits:20062248',
    'KNOWN LIMIT: if the publisher renumbers OBJECTIDs the legacy/alias keys swap owners at fetch time', [key(pre, 'FAR RD'), key(r, 'FAR RD')]);
}

// ── 5. recordIdentity is the ONE place a source_id segment is made ───────────────────────────────────────────────────────────
{
  const v = aliasFileFor(OPT, FILES);
  ok(recordIdentity({ OBJECTID: 4001, PermitID: '20062248' }, OPT, '20062248', 'title', v) === '20062248#4001', 'recordIdentity applies the alias');
  ok(recordIdentity({ OBJECTID: 4001 }, OPT, null, 'T', v) === '4001', 'no case number: the row-id fallback (4001) is NOT aliased - the alias must extend the current id');
  ok(recordIdentity({ A: 'x', B: 'y' }, { identity_fields: ['A', 'B'] }, 'c', 't', null) === 'x|y', 'identity_fields ladder unchanged');
}

// ── 6. the Python twin, same table ───────────────────────────────────────────────────────────────────────────────────────────
{
  const p = spawnSync('python3', ['-I', join(root, 'scripts/test_identity_aliases.py')], { cwd: root, encoding: 'utf8' });
  const tail = (p.stdout || '').trim().split('\n').slice(-3).join(' | ');
  ok(p.status === 0, 'scripts/test_identity_aliases.py passes (rule, fingerprints, shard fetch routing, CI checker)', tail + ' ' + (p.stderr || '').slice(-300));
}

console.log(`\n${fails ? 'FAILED' : 'ALL PASSED'} (${n} checks)`);
process.exit(fails ? 1 : 0);
