// WHAT ADDING source_dates DOES DOWNSTREAM (report-accuracy-universal, 2026-11-20): content_hash, record identity, event fingerprints, idempotency keys, follow and watch comparisons,
// and billing/storage arguments. Local fixtures and fakes only: no database, no report, no follow, watch, credit or email.
// content_hash is sha256(body) (docs/report-snapshot.sql CHECK): an INTEGRITY value. A new report that carries source dates has a different body and so a different hash, by definition.
// Run: node --experimental-strip-types test/report-content-hash-downstream.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const M = await import('../supabase/functions/_shared/national-report.ts');
const CS = await import('../supabase/functions/_shared/changes-since-report.ts');
const PW = await import('../supabase/functions/_shared/property-watch.ts');
const SS = await import('../supabase/functions/_shared/report-snapshot.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
const WL = await import('./lib/da-report-' + 'view-world.mjs');
let n = 0, fails = 0;
const ok = (c, name, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 500)); } };

// ── A. where content_hash is read, and what it is never used for ──
const files = [];
const walk = (d) => { for (const e of readdirSync(join(root, d), { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name)) files.push(p); } };
walk('supabase/functions');
const users = files.filter((f) => /content_hash|contentHash/.test(read(f))).sort();
ok(JSON.stringify(users) === JSON.stringify(['supabase/functions/_shared/changes-since-report.ts', 'supabase/functions/_shared/report-snapshot.ts', 'supabase/functions/follow-development-report/data.ts']),
  'content_hash is read in exactly three edge-function files (the snapshot module, the changes-since echo, the follow reader)', users);
const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const cmp = users.filter((f) => /(content_hash|contentHash)\s*[!=]==?|[!=]==?\s*[\w.]*(content_hash|contentHash)/.test(stripC(read(f))));
ok(JSON.stringify(cmp) === JSON.stringify(['supabase/functions/_shared/report-snapshot.ts']), 'the only comparison of a content hash is the envelope self-check (hash of its own report), never a comparison between two reports', cmp);
const ss = stripC(read('supabase/functions/_shared/report-snapshot.ts'));
ok(/async function envelopeMatchesItsHash[\s\S]{0,400}sha256Hex\(JSON\.stringify\(envelope\.report\)\)\) === envelope\.content_hash/.test(ss), 'that comparison hashes the envelope\'s OWN report against its OWN hash');
const sqlUsing = readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.sql')).filter((f) => /content_hash/.test(read('docs/' + f)));
const keyed = sqlUsing.filter((f) => /(unique|on conflict)[^;\n]{0,120}content_hash|content_hash[^;\n]{0,60}(unique)/i.test(read('docs/' + f).replace(/--.*$/gm, '')));
ok(sqlUsing.length >= 3 && keyed.length === 0, 'no table or conflict clause in the SQL of record is keyed on content_hash (no dedupe by hash)', { sqlUsing, keyed });
const ent = read('docs/evaluation-entitlement.sql');
ok(/idempotency key is a caller-chosen random UUID bound to the EVALUATION only, never to the request content/.test(ent), 'the idempotency key is, by the SQL of record\'s own rule D-L6, never bound to request content');
ok(/unique \(evaluation_id, idempotency_key\)|credit_key_unique\s+unique \(evaluation_id, idempotency_key\)/.test(ent), 'the credit uniqueness is (evaluation, idempotency key), not a hash');

// ── B. the world: one project, with and without source dates, a stored report from BEFORE ──
const FAM = 'fam', att = { version: 1, attribution: {} };
const PUB = { fam: { agency: 'Agency', dataset: 'Data', date_basis: 'record_created' } };
const NOW0 = new Date('2026-10-20T12:00:00Z'), NOW1 = new Date('2026-11-19T18:00:00Z');
const proj = (prov) => ({ source_key: 'k1', registry_id: FAM, record_kind: 'development', name: 'New 40-unit apartment building', type: 'Development', type_raw: 'New Construction', status: 'Approved', stage: 'Approved',
  developer: null, size: null, investment: null, submitted_at: '2024-08-26', date_kind: 'filed', address: null, source_ref: 'https://example.gov/k1', provenance: prov });
const rowk = { source_key: 'k1', feature_id: 'f:1', registry_id: FAM, provenance: 'recovered_authoritative', distance_mi: 0.2, geometry_type: 'ST_Point', has_more: false, marker_lat: 40.02, marker_lng: -105.28 };
const SUBJ = { address: '1 Test St', matched_address: null, lat: 40.0177, lng: -105.28, zip: '80302' };
const led = [{ ...WL.led('k1', FAM), first_observed_at: '2026-09-01T00:00:00Z', last_observed_at: '2026-11-18T00:00:00Z' }];
const asm = (now, prov, events) => M.assemble({ now, subject: SUBJ, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution: att, rows: [rowk], projects: [proj(prov)], ledger: led, events, health: [], publishers: PUB });
const DATES = { source_dates: { created: '2024-08-26', updated: '2026-11-10' } };
const NEWER = { source_dates: { created: '2024-08-26', updated: '2026-11-10', status_updated: '2026-11-05' } };
// the report issued BEFORE the change (no source dates anywhere), stored as the permanent body
const before = asm(NOW0, {}, []);
const asStored = (r, at) => ({ report_id: 'r1', content_hash: 'h', report_version: r.intelligence.report_version ?? 'v', generated_at: at, body: JSON.stringify({ product: r.intelligence.product, ...r.intelligence }) });
const stored = asStored(before, '2026-10-20T12:00:00Z');
ok(before.intelligence.projects.length === 1 && !('record_dates' in before.intelligence.projects[0]), 'control: the stored report is a report from before this change (one project, no record_dates)');

// content_hash: integrity only
const nowNoDates = asm(NOW1, {}, []), nowDates = asm(NOW1, DATES, []);
const h0 = await SS.contentHashOf(nowNoDates.intelligence), h1 = await SS.contentHashOf(nowDates.intelligence);
ok(h0 !== h1, 'a NEW report that carries source dates has a different content_hash (its body is different content)');
ok(h0 === await SS.contentHashOf(asm(NOW1, {}, []).intelligence), 'the hash is deterministic: unchanged data gives the same hash');
ok(await SS.sha256Hex(SS.snapshotBodyOf(nowDates.intelligence)) === h1, 'and the hash is sha256 of the stored body, which is what the database CHECK enforces');

// record identity and event fingerprints do not move
ok(nowNoDates.intelligence.projects[0].project_id === nowDates.intelligence.projects[0].project_id, 'record identity (project_id) is the same with and without source dates');
const ev = [WL.evt('k1', { observed_at: '2026-11-10T10:00:00Z', created_at: '2026-11-10T10:00:00Z' })];
const fp = (r) => JSON.stringify(r.intelligence.projects[0].homesignal_detected_changes);
ok(fp(asm(NOW1, {}, ev)) === fp(asm(NOW1, DATES, ev)) && fp(asm(NOW1, {}, ev)) !== '[]', 'the detected change (event) is the same with and without source dates, and non-empty (control)', fp(asm(NOW1, {}, ev)));

// ── C. follow (changes since report) and watch against the OLD stored report ──
const ledger = led.map((l) => ({ ...l }));
const sinceNone = (prov, events) => CS.changesSinceReport({ now: NOW1, view: 'customer', attribution: att, report: stored, ledger, events, health: [] });
const quiet = sinceNone({}, []);
ok(Array.isArray(quiet.changed) && quiet.changed.length === 0, 'follow: with no ledger event after the report, the old stored report reports NO change (source dates cannot create one)', quiet.changed);
const wcheck = (prov, events) => PW.checkWatch({ now: NOW1, attribution: att, original: { generated_at: stored.generated_at, body: stored.body }, nearby: asm(NOW1, prov, events).intelligence.projects, ledger, events, health: [], seen: [] });
const wq0 = wcheck({}, []), wq1 = wcheck(DATES, []);
ok(wq0.changes.length === 0 && wq1.changes.length === 0 && wq0.nearby === wq1.nearby && wq1.nearby === 1, 'watch: no ledger event means no notification, with or without source dates (and the project is nearby: control)', { wq0: wq0.changes.length, wq1: wq1.changes.length });
// with a REAL ledger event the same single change is reported either way
const evAfter = [WL.evt('k1', { observed_at: '2026-11-10T10:00:00Z', created_at: '2026-11-10T10:00:00Z' })];
const wc0 = wcheck({}, evAfter), wc1 = wcheck(NEWER, evAfter);
ok(wc0.changes.length === 1 && JSON.stringify(wc0.changes) === JSON.stringify(wc1.changes), 'watch: a real ledger event is notified exactly once, identically with and without source dates', { a: wc0.changes.length, b: wc1.changes.length });
const sc0 = CS.changesSinceReport({ now: NOW1, view: 'customer', attribution: att, report: stored, ledger, events: evAfter, health: [] });
ok(sc0.changed.length === 1, 'follow: the same real event is one change since the report (control)', sc0.changed.length);
// notification de-duplication is by (project, event, observed_at), not by anything in the report body
const key0 = PW.selectForEmail(wc0.changes), key1 = PW.selectForEmail(wc1.changes);
ok(JSON.stringify(key0) === JSON.stringify(key1), 'the email selection (what is recorded as told) is identical with and without source dates');
ok(JSON.stringify(wc0.changes).includes('source_dates') === false && JSON.stringify(wc1.changes).includes('record_dates') === false, 'a watch change carries neither the stored key nor the report key: no email text can come from them');

// ── D. billing and storage arguments: only the body and its hash differ ──
const calls = [];
const rpc = async (fn, args) => { calls.push({ fn, args }); return { data: null, error: { message: 'stop' } }; };
const who = { userId: '11111111-1111-4111-8111-111111111111', idempotencyKey: '22222222-2222-4222-8222-222222222222' };
const opts = { reportVersion: 'v-test', engineInputs: { radius_mi: 0.5 } };
for (const r of [nowNoDates, nowDates]) { try { await SS.issueBrokerageReport(rpc, who, r.intelligence, null, opts); } catch { /* the fake store refuses on purpose: only the arguments matter */ } }
const [c0, c1] = calls.map((c) => c.args);
ok(calls.length === 2 && calls.every((c) => c.fn === 'brokerage_report_issue'), 'issue: the same single database function is called in both cases');
const same = ['p_user_id', 'p_idempotency_key', 'p_report_version', 'p_engine_inputs', 'p_private'].every((k) => JSON.stringify(c0[k]) === JSON.stringify(c1[k]));
ok(same, 'issue: user, idempotency key, version, engine inputs and private context are identical; nothing about billing or the retry key follows the hash', { c0: Object.keys(c0) });
ok(c0.p_body !== c1.p_body && c0.p_content_hash !== c1.p_content_hash && (await SS.sha256Hex(c0.p_body)) === c0.p_content_hash && (await SS.sha256Hex(c1.p_body)) === c1.p_content_hash, 'issue: only body and its own hash differ, and each hash is the sha256 of its own body');
ok(c1.p_body.length - c0.p_body.length < 400 && c1.p_body.length > c0.p_body.length, 'storage: the added bytes for one project are small (' + (c1.p_body.length - c0.p_body.length) + ' bytes)');
console.log(`\n${n - fails}/${n} passed`); process.exit(fails ? 1 : 0);
