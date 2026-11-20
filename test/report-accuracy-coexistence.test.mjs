// COEXISTENCE during rollout (report-accuracy-universal, 2026-11-20): the PRIOR report view (the module as it is on main before this change, read from git at a pinned commit)
// against a NEW engine response, and the new view against an OLD response. Local fixtures only. If the pinned commit is not in this checkout the prior-view half prints SKIP (never a pass).
// Run: node --experimental-strip-types test/report-accuracy-coexistence.test.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRIOR = '10cb195161701ca49d20f8c1c72e0e51b583d8f1'; // origin/main when this was written: the view before this change
globalThis.window = globalThis;
await import('../lib/project-type.js');
const W = await import('./lib/da-report-' + 'view-world.mjs');
let n = 0, fails = 0, skipped = 0;
const ok = (c, name, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 500)); } };
const load = (src) => { const sb = { window: {} }; runInNewContext(src, sb); return sb.window.HS.daReportView; };
const NEW = load(readFileSync(join(root, 'lib', 'da-report-' + 'view.js'), 'utf8'));
let OLD = null;
try { OLD = load(execFileSync('git', ['show', PRIOR + ':lib/da-report-view.js'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 })); } catch { OLD = null; }
const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const FAM = reg.arcgis.find((e) => e.file_date_basis === 'record_created').registry_id; // a family whose date basis is declared, so the new response carries basis and creation-only
const att = { version: 1, attribution: {} };
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const world = (prov) => ({ rows: [W.row('v1', 0.2, FAM)], projects: [W.proj('v1', FAM, { submitted_at: '2024-08-26', status: 'Approved', stage: 'Approved', provenance: prov })], ledger: [], events: [], health: [] });
const newResp = await W.wire(world({ source_dates: { created: '2024-08-26', updated: '2026-09-20' } }), { attribution: att });
const statusResp = await W.wire(world({ source_dates: { created: '2024-08-26', updated: '2026-09-20', status_updated: '2026-09-15' } }), { attribution: att });
const oldResp = await W.wire(world({}), { attribution: att });
const p = newResp.report.projects[0];
ok(p.record_dates?.updated === '2026-09-20' && p.record_date?.verify?.reason === 'creation_only' && statusResp.report.projects[0].status_attribution?.status_date?.date === '2026-09-15' && statusResp.report.projects[0].record_date?.verify === null && newResp.report.coverage?.categories?.rule, 'control: the new response carries record_dates, creation_only, category coverage; a status-update date clears the freshness warning');

// new view + old response: renders, and says nothing the old response cannot support
let t = '', threw = false; try { t = txt(NEW.html(oldResp, { subject: W.ADDRESS })); } catch { threw = true; }
ok(!threw && t.length > 500, 'new view + a response without the new fields renders');
// (a response from BEFORE the change has no categories and no status_attribution: strip them from today's engine output to build one)
const stripped = JSON.parse(JSON.stringify(oldResp)); for (const q of stripped.report.projects) { delete q.record_dates; delete q.status_attribution; } delete stripped.report.coverage.categories;
let ts = ''; threw = false; try { ts = txt(NEW.html(stripped, { subject: W.ADDRESS })); } catch { threw = true; }
ok(!threw && !/last modified|Agency status updated|Source coverage|Connected sources hold/.test(ts), 'new view + a pre-change response: no modification, no status date, no category line (nothing guessed)');

// old view + new response
if (!OLD) { skipped++; console.log('SKIP — the prior view is not in this checkout (' + PRIOR.slice(0, 8) + '): old view + new response NOT TESTED here'); }
else {
  let to = ''; threw = false; try { to = txt(OLD.html(newResp, { subject: W.ADDRESS })); } catch { threw = true; }
  ok(!threw && to.length > 500, 'prior view + the new response renders (unknown keys ignored)');
  ok(!/record_dates|status_attribution|source_dates|coverage-categories|not_connected|not_established/.test(to), 'prior view shows no raw field names from the new response');
  ok(/Record created Aug 26, 2024/.test(to), 'prior view prints the NEW label as given ("Record created"), so a creation date is not called Filed even by the old view');
  ok(/more than a year old; confirm it is still active|over a year old\. Confirm it is still active/.test(to), 'prior view treats creation_only as an old date: it still warns to confirm (the reason is unknown to it, the warning is kept)', to.match(/Verify:.{0,200}/)?.[0]);
  ok(!/last modified|Agency status updated|Connected sources hold/.test(to), 'prior view omits the new notes (they appear only with the new view)');
}
console.log(`\n${n - fails}/${n} passed${skipped ? ', ' + skipped + ' SKIPPED (not tested)' : ''}`); process.exit(fails ? 1 : 0);
