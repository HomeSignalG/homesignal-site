// Tab 20 Stage 2 proof slice (test-only phase): offline checks on the screens module and the prepared migration.
// The migration's behaviour is proven on a disposable Postgres by test/weekly_stage2_pg (weekly-stage2-suite.yml).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('lib/acq-weekly-slice.js');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// the full configuration, in application order (docs/weekly-release-order.md)
const SQL_FILES = ['weekly-1-base.sql', 'weekly-2-topic-queue.sql', 'weekly-2a-publication-lock.sql', 'weekly-3-workbench.sql', 'weekly-4-source-copy.sql', 'weekly-5-titles.sql', 'weekly-6-doc-cues.sql', 'weekly-7-topic-queue-gate.sql'];
const sql = SQL_FILES.map((f) => read('docs/' + f)).join('\n');

// 1. the editorial workbench is not on any page: acquisition.html loads this file as a LIBRARY (the research answer format
//    the queue puts in a prepared request) and never mounts it
const pages = readdirSync(new URL('..', import.meta.url)).filter((f) => f.endsWith('.html'));
const loaders = pages.filter((p) => read(p).includes('acq-weekly-slice'));
ok(pages.length > 5 && loaders.length === 1 && loaders[0] === 'acquisition.html' && pages.every((p) => !/acqWeeklySlice\s*\.\s*mount|acqWeeklySlice\.load/.test(read(p))),
  '1a only acquisition.html loads the slice module, and no page mounts it (' + pages.length + ' pages checked)');
// 2. the module only talks to the admin functions
const rpcs = [...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]);
ok(rpcs.length >= 12 && rpcs.every((n) => /^hs_weekly_/.test(n)), '2a every call is an hs_weekly_* admin function (' + rpcs.length + ')');
ok(rpcs.every((n) => new RegExp('function public\\.' + n + '\\(').test(sql)), '2b every function it calls is defined in the migration');
// the only storage call: a read of a page image from the private weekly-visuals bucket
const storageCalls = code.match(/storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*\w+/g) || [];
ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\.from\s*\(\s*['"]|perplexity\.ai|anthropic\.com/i.test(code) &&
  storageCalls.length === 1 && /from\(PREVIEW_BUCKET\)\s*\.\s*download$/.test(storageCalls[0]) && /var PREVIEW_BUCKET = 'weekly-visuals';/.test(code) &&
  /bucket !== PREVIEW_BUCKET\) return Promise\.resolve\(null\)/.test(code) && !/\.upload\s*\(/.test(code), '2c no network, table or provider calls; one storage read, of a page image');
ok(/var CUE_HL = 'rgba\(255,200,40,\.45\)'/.test(code) && /status === 'resolved'/.test(code) && /Nothing is shown in its place/.test(code) &&
  /function cueBlock/.test(code), '2e cues: DocScene’s yellow, the engine’s status, and nothing drawn for an unresolved cue');
ok(!/\bverified\b/i.test(code.replace(/not a certification/g, '')), '2d the screens never label anything "verified"');
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx); vm.runInContext(js, ctx);
const W = ctx.window.HS.acqWeeklySlice;
ok(W.TOPIC === 'Air Quality', '3a the proof topic is Air Quality');
const t = W.requestText();
for (const r of ['cash payment', 'Super Emitter Program', 'company emissions detected by third parties', 'proposed changes from final rules'])
  ok(W.RULES.join(' ').includes(r), '3b editorial rule present: ' + r);
ok(t.startsWith('Research for the Quality-of-Life Weekly Report: Air report') && t.includes('WEEKLY-ANSWER v1') && /\$45 billion estimate include/.test(t), '3c the request carries the title, the format and the questions');
// 4. the migration is prepared, not applied: no migrations folder entry, no production address, guarded grants
ok(!existsSync(new URL('../supabase/migrations', import.meta.url)) || !readdirSync(new URL('../supabase/migrations', import.meta.url)).some((f) => /weekly/.test(f)), '4a no weekly file is in a migrations folder');
ok(SQL_FILES.every((f) => /PREPARED, NOT APPLIED TO PRODUCTION/.test(read('docs/' + f).split('\n')[0])) && !/supabase\.co/.test(sql), '4b every file says it is not applied, and none names a production address');
ok(!/grant\s+(select|insert|update|delete|all)[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i.test(sql.replace(/grant execute on function[^;]*;/gi, '')), '4c no table grant to anon or authenticated');
ok(/'ref', 'main'/.test(sql) && /p_workflow not in \('weekly-research-ingest\.yml', 'weekly-script-run\.yml'\)/.test(sql), '4d dispatch is main-only and limited to the two slice workflows');
// 5. the Stage 1 prototype is not touched on this branch
let base = null;
try { base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { /* none */ }
if (!base) console.log('SKIP — 5 origin/main is not in this checkout');
else {
  const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }).split('\n').filter(Boolean);
  ok(!changed.some((f) => /acq-weekly-report|^topics\.js$|^test\/weekly-report/.test(f)), '5 no Stage 1 file differs from origin/main (' + changed.length + ' tracked files changed)');
}
// 6. workbench wording and vocabulary agree with the prepared SQL
const acts = [...js.matchAll(/\['([a-z_]+)', '(Put the conflict first|Make the public stake concrete|Replace bureaucratic wording|Tighten the explanation|Strengthen the contrast|Cut repetition|Strengthen the closing)'\]/g)];
ok(acts.length === 7 && acts.every((m) => sql.includes("'" + m[1] + "'")), '6a the seven rewrite actions match the database vocabulary');
ok(/Provisional internal criteria, not validated performance benchmarks/.test(js) && /Provisional internal criteria, not validated performance benchmarks/.test(sql), '6b the rubric is labelled provisional in the screen and the database');
ok(/automated assessments, not factual findings/.test(js), '6c rhythm warnings are labelled automated assessments');
ok(/Not in this packet/.test(js) && /Quote: not found in the sources reviewed/.test(js) && /Quote: contradicted by evidence/.test(js), '6d the three quote distinctions are worded separately');
ok(!/\bviral/i.test(js.replace(/No virality or improvement is claimed[^.]*\./g, '')), '6e no virality claim (the only mention is the statement that none is made)');
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
