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
const sql = read('docs/weekly-stage2-slice.sql');

// 1. not wired into any page in this phase
const pages = readdirSync(new URL('..', import.meta.url)).filter((f) => f.endsWith('.html'));
ok(pages.length > 5 && pages.every((p) => !read(p).includes('acq-weekly-slice')), '1a no page loads the slice module yet (' + pages.length + ' pages checked)');
// 2. the module only talks to the admin functions
const rpcs = [...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]);
ok(rpcs.length >= 12 && rpcs.every((n) => /^hs_weekly_/.test(n)), '2a every call is an hs_weekly_* admin function (' + rpcs.length + ')');
ok(rpcs.every((n) => new RegExp('function public\\.' + n + '\\(').test(sql)), '2b every function it calls is defined in the migration');
ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\.from\s*\(\s*['"]|storage\s*\.\s*from|perplexity\.ai|anthropic\.com/i.test(code), '2c no network, table or provider calls');
ok(!/\bverified\b/i.test(code.replace(/not a certification/g, '')), '2d the screens never label anything "verified"');
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx); vm.runInContext(js, ctx);
const W = ctx.window.HS.acqWeeklySlice;
ok(W.TOPIC === 'Air Quality', '3a the proof topic is Air Quality');
const t = W.requestText();
for (const r of ['cash payment', 'Super Emitter Program', 'company emissions detected by third parties', 'proposed changes from final rules'])
  ok(W.RULES.join(' ').includes(r), '3b editorial rule present: ' + r);
ok(t.startsWith('Research for the Quality-of-Life Weekly Report: Air report') && t.includes('WEEKLY-ANSWER v1') && /\$45 billion estimate include/.test(t), '3c the request carries the title, the format and the questions');
// 4. the migration is prepared, not applied: no migrations folder entry, no production address, guarded grants
ok(!existsSync(new URL('../supabase/migrations/weekly-stage2-slice.sql', import.meta.url)), '4a it is not in a migrations folder');
ok(/PREPARED, NOT APPLIED TO PRODUCTION/.test(sql) && !/supabase\.co/.test(sql), '4b it says it is not applied and names no production address');
ok(!/grant\s+(select|insert|update|delete|all)[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i.test(sql.replace(/grant execute on function[^;]*;/gi, '')), '4c no table grant to anon or authenticated');
ok(/'ref', 'main'/.test(sql) && /p_workflow not in \('weekly-research-ingest\.yml', 'weekly-script-run\.yml'\)/.test(sql), '4d dispatch is main-only and limited to the two slice workflows');
// 5. the Stage 1 prototype is not touched on this branch
let base = null;
try { base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { /* none */ }
if (!base) console.log('SKIP — 5 origin/main is not in this checkout');
else {
  const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }).split('\n').filter(Boolean);
  ok(!changed.some((f) => /acq-weekly-report|acquisition\.html|topics\.js|^test\/weekly-report/.test(f)), '5 no Stage 1 file differs from origin/main (' + changed.length + ' tracked files changed)');
}
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
