// Tab 20 · Weekly Report topic queue (test-only phase): offline checks on the queue module, the prepared SQL and the lead
// fixture. The SQL's behaviour is proven on a disposable Postgres by test/weekly_stage2_pg/run_topic_queue.sh.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const js = read('lib/acq-weekly-topics.js'), code = strip(js);
const slice = strip(read('lib/acq-weekly-slice.js'));
const sql = read('docs/weekly-topic-queue.sql'), stage2 = read('docs/weekly-stage2-slice.sql');
const sqlCode = sql.replace(/--.*$/gm, '');

// 1 not wired into any page in this phase
const pages = readdirSync(new URL('..', import.meta.url)).filter((f) => f.endsWith('.html'));
ok(pages.length > 5 && pages.every((p) => !read(p).includes('acq-weekly-topics')), '1a no page loads the topic queue yet (' + pages.length + ' pages checked)');
ok(/HS\.acqWeeklyTopics/.test(slice) && /ws-topics-host/.test(slice) && /ws-slice-host/.test(slice), '1b the weekly screen mounts the queue in its own box, only when the module is loaded');

// 2 the module only talks to weekly admin functions
const rpcs = [...new Set([...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))];
ok(rpcs.length >= 9 && rpcs.every((n) => /^hs_weekly_/.test(n)), '2a every call is an hs_weekly_* admin function (' + rpcs.length + ')');
ok(rpcs.every((n) => new RegExp('function public\\.' + n + '\\(').test(sql) || new RegExp('function public\\.' + n + '\\(').test(stage2)), '2b every function it calls is defined in the prepared SQL');
ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\.from\s*\(|\.storage\b|\.upload\s*\(|localStorage|sessionStorage|perplexity\.ai|anthropic\.com|bsky|youtube/i.test(code), '2c no network, table, storage, browser-storage, provider or posting call');
ok(!/\b(confirm|alert|prompt)\s*\(/.test(code), '2d no browser dialogs');
ok(!/\bverified\b/i.test(code.replace(/unverified/gi, '')), '2e nothing is labelled "verified"');
ok(/This records the promise\. It is not evidence for the story\./.test(js) && /A topic is a lead, not evidence\./.test(js) && /not evidence/.test(js.match(/Where the lead came from[^']*/)[0]), '2f promise, lead and source wording stay apart from evidence');
ok(/Nothing here posts, publishes or starts a job\./.test(js), '2g the screen says it posts nothing');

// 3 vocabulary agrees with the database
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx); vm.runInContext(js, ctx);
const W = ctx.window.HS.acqWeeklyTopics;
const want = ['captured', 'queued_for_research', 'researching', 'ready_for_editorial_review', 'included', 'published', 'deferred', 'dropped'];
ok(JSON.stringify(Object.keys(W.STATUS)) === JSON.stringify(want) && want.every((s) => sql.includes("'" + s + "'")), '3a the eight statuses match the database');
ok(JSON.stringify(Object.values(W.STATUS)) === JSON.stringify(['Captured', 'Queued for research', 'Researching', 'Ready for editorial review', 'Included in report', 'Published', 'Deferred', 'Dropped']), '3b the status labels are the brief’s');
ok(JSON.stringify(W.VIEWS.map((v) => v[1]).slice(0, 6)) === JSON.stringify(['Inbox / unassigned', 'Promised publicly', 'Assigned to this edition', 'Research in progress', 'Deferred / carry forward', 'Published']), '3c the six views are the brief’s');
ok(W.FIELDS.every((f) => new RegExp('\\b' + f + '\\b').test(sql)), '3d every captured field exists in the SQL');
ok(!/promised_publicly\s*[:=]\s*(true|!)/.test(code) && /generated always as \(commitment_post_url is not null\) stored/.test(sql), '3e "promised publicly" is derived by the database from the published-post address, never set by the screen');

// 4 the SQL is prepared, not applied, admin-only, and reaches nothing outside
ok(!existsSync(new URL('../supabase/migrations', import.meta.url)) || !readdirSync(new URL('../supabase/migrations', import.meta.url)).some((f) => /topic/.test(f)), '4a it is not in a migrations folder');
ok(/PREPARED, NOT APPLIED TO PRODUCTION/.test(sql) && !/supabase\.co/.test(sql), '4b it says it is not applied and names no production address');
ok(!/grant\s+(select|insert|update|delete|all)[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i.test(sqlCode), '4c no table grant to anon or authenticated');
ok(/revoke all on public\.%I from public, anon, authenticated/.test(sql) && /enable row level security/.test(sql), '4d tables: row security on, visitor access revoked');
ok(!/\bnet\.http|pg_net|cron\.schedule|_hs_.*dispatch|vault\./i.test(sqlCode), '4e nothing dispatches, schedules or reads a secret');
ok(!/impact_|video_bluesky|bsky_|youtube_video|social_posts/i.test(sqlCode), '4f no Tab 17, Bluesky or YouTube object is named');
ok(/weekly_append_only/.test(sql) && /weekly_topic_lead_events/.test(sql), '4g lead events are append-only');

// 5 the two leads are fixtures: unverified, with nothing invented
const leads = JSON.parse(read('test/fixtures/weekly-topic-leads.json'));
ok(leads.leads.length === 2 && /UNVERIFIED/.test(leads.note) && /NOT a durable live queue/.test(leads.note), '5a two fixture leads, marked unverified and not a live queue');
ok(leads.leads.every((l) => !('source_urls' in l) && !('social_post_url' in l) && !('commitment_wording' in l) && !('commitment_post_url' in l) && /UNVERIFIED LEAD/.test(l.notes))
  && !/https?:\/\//.test(JSON.stringify(leads.leads)), '5b no address and no commitment was invented for them');
const q = JSON.parse(read('test/fixtures/weekly-topic-queue.json'));
const founder = q.leads.filter((l) => !/^TEST/.test(l.title));
ok(founder.length === 2 && founder.every((l) => !l.promised_publicly && (l.source_urls || []).length === 0 && !l.commitment_post_url) && /not a durable live queue/.test(q._note), '5c in the screen fixture they are still unpromised and addressless; everything else is TEST data');

// 6 nothing outside the weekly files differs from origin/main
let base = null;
try { base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { /* none */ }
if (!base) console.log('SKIP — 6 origin/main is not in this checkout');
else {
  const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }).split('\n').filter(Boolean);
  ok(!changed.some((f) => /impact|acq-weekly-report|acquisition\.html|bluesky|youtube/i.test(f)), '6 no Tab 17, Stage 1, Bluesky or YouTube file differs from origin/main (' + changed.length + ' files changed)');
}
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
