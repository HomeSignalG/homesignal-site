// The source accountability ledger is generated, reconciles to the audit snapshot, and never claims more than the evidence shows.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 400)); } };
const L = JSON.parse(readFileSync(join(root, 'docs/source-ledger/source-integration-ledger.json'), 'utf8'));
const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const FZ = JSON.parse(readFileSync(join(root, 'docs/source-ledger/audit-membership-2026-11-19.json'), 'utf8'));
const { registryIds, currentView } = await import('./lib/source-ledger-current.mjs');
const liveIds = registryIds(reg);
const gen = spawnSync('python3', ['scripts/build-source-ledger.py', '--check'], { cwd: root, encoding: 'utf8' });
ok(gen.status === 0, 'the ledger on disk is exactly what the generator produces from the frozen audit', gen.stderr);
// the audit is HISTORICAL evidence: its counts are those of 2026-11-19 and are asserted against the frozen audit, never against the live registry
const frozenRegistered = Object.entries(FZ.audited).filter(([, v]) => v.registered).map(([k]) => k);
ok(frozenRegistered.length === 257 && L.snapshot.registry_families === 257, 'the 2026-11-19 audit covered 257 registered families');
ok(L.sources.filter((s) => s.registered).length === 257 && frozenRegistered.every((id) => L.sources.some((s) => s.registry_id === id)), 'every audited family has a ledger row');
ok(L.sources.length === 259 && L.snapshot.unregistered_with_data.length === 2, 'two unregistered sources with data were separately identified in the audit');
// the LIVE registry is read dynamically: a source registered after the audit is UNVERIFIED until audited, and never breaks this test
const cv = currentView(L, liveIds);
ok(cv.rows.length === liveIds.length && cv.rows.every((r) => r.classification && r.hydration_verification === 'UNVERIFIED'), 'every live registry family is in the current view and none is claimed verified');
ok(cv.newlyRegistered.every((id) => !frozenRegistered.includes(id)) && cv.newlyRegistered.every((id) => cv.rows.find((r) => r.registry_id === id).classification === 'UNVERIFIED'), 'a source registered after the audit is classified UNVERIFIED', cv.newlyRegistered);
const future = currentView(L, [...liveIds, 'boulder-county-planning-test', 'longmont-development-test']);
ok(future.newlyRegistered.length === cv.newlyRegistered.length + 2 && future.rows.filter((r) => /-test$/.test(r.registry_id)).every((r) => r.classification === 'UNVERIFIED' && r.audited === false), 'adding Boulder County, Longmont or any future source yields UNVERIFIED rows and no failure');
ok(Object.values(L.counts).reduce((a, b) => a + b, 0) === L.sources.length, 'class counts sum to the ledger size', L.counts);
ok(L.snapshot.stored_development_records === 2925395 && L.sources.reduce((a, s) => a + s.stored_development_records, 0) === 2925395, 'stored records reconcile to the audit snapshot total');
const dis = L.sources.filter((s) => s.classification === 'disconnected');
ok(dis.length === 8 && dis.reduce((a, s) => a + s.stored_development_records, 0) === 73580, 'eight disconnected families hold 73,580 stored records');
ok(L.counts.fully_verified === undefined && L.sources.every((s) => s.hydration_verification === 'UNVERIFIED' && s.report_eligibility_verification === 'UNVERIFIED'), 'no source is marked verified end to end; hydration and eligibility are UNVERIFIED everywhere');
ok(L.sources.filter((s) => s.classification === 'retired').every((s) => s.retirement_or_exclusion_evidence), 'a retired source always carries its retirement evidence');
ok(L.sources.every((s) => s.verification_date === '2026-11-19' && Array.isArray(s.outstanding_defects)), 'every row is dated and lists its defects');
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
