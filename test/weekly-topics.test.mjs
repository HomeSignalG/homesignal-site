// Tab 20 · Weekly Report topic queue: offline checks on the page wiring, the queue module, the prepared SQL and the lead
// fixture. The SQL's behaviour is proven on a disposable Postgres by test/weekly_stage2_pg/run_queue_only.sh and run_topic_queue.sh.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const js = read('lib/acq-weekly-topics.js'), code = strip(js);
const slice = strip(read('lib/acq-weekly-slice.js'));
// sql: the QUEUE-ONLY release (files 1 and 2). gate: file 7. rest: the other prepared files (docs/weekly-release-order.md).
const baseSql = read('docs/weekly-1-base.sql'), queue = read('docs/weekly-2-topic-queue.sql'), gate = read('docs/weekly-7-topic-queue-gate.sql');
const sql = baseSql + '\n' + queue;
const sqlCode = sql.replace(/--.*$/gm, '');
// the Bluesky sources (docs/weekly-bluesky-sources.sql): an optional file the queue reads beside the queue-only release
const bsky = read('docs/weekly-bluesky-sources.sql');
const stage2 = ['weekly-3-workbench.sql', 'weekly-4-source-copy.sql', 'weekly-5-titles.sql', 'weekly-6-doc-cues.sql'].map((f) => read('docs/' + f)).join('\n') + '\n' + gate;

// 1 on the page: Tab 20 is the queue, mounted through its own entry point; the workbench is loaded as a library only
const pages = readdirSync(new URL('..', import.meta.url)).filter((f) => f.endsWith('.html'));
const page = read('acquisition.html');
ok(pages.length > 5 && pages.filter((p) => read(p).includes('acq-weekly-topics')).join() === 'acquisition.html', '1a only acquisition.html loads the topic queue (' + pages.length + ' pages checked)');
ok(/<button data-tab="weeklyreport">20 · Weekly Report<\/button><\/nav>/.test(page) && page.includes('<div class="tab" id="tab-weeklyreport"></div>')
  && /weeklyreport: function \(\) \{\s*var el = document\.getElementById\('tab-weeklyreport'\);\s*if \(el && window\.HS && window\.HS\.acqWeeklyTopics\) window\.HS\.acqWeeklyTopics\.load\(window\.hsClient, el\);/.test(page)
  && /if\(id==='weeklyreport'\) return;/.test(page) && !/acqWeeklySlice/.test(page), '1c Tab 20 mounts the queue through its own entry point and never names the workbench');
for (const f of ['lib/acq-weekly-topics.js', 'lib/acq-weekly-slice.js']) {
  const k = createHash('sha256').update(readFileSync(new URL('../' + f, import.meta.url))).digest('hex').slice(0, 8);
  ok(page.includes('<script src="' + f + '?v=' + k + '"></script>'), '1d ' + f + ' is loaded with its current content key');
}
// everything else on the page is byte-for-byte what main serves
let mainPage = null;
try { mainPage = execFileSync('git', ['show', 'origin/main:acquisition.html'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch (e) { /* none */ }
if (mainPage == null) console.log('SKIP — 1e origin/main is not in this checkout');
else {
  const without = page.replace('<button data-tab="weeklyreport">20 · Weekly Report</button>', '').replace('    <div class="tab" id="tab-weeklyreport"></div>\n', '')
    .replace(/<script src="lib\/acq-weekly-(slice|topics)\.js\?v=[0-9a-f]{8}"><\/script>\n/g, '').replace(/    \/\/ Live, gated \(hs_weekly_\*\)[\s\S]*?acqWeeklyTopics\.load\(window\.hsClient, el\);\n    \},\n/, '')
    .replace("      if(id==='weeklyreport') return;\n", '');
  ok(without === mainPage, '1e apart from the Tab 20 lines, acquisition.html is byte-for-byte origin/main’s (Tab 17 and every other tab unchanged)');
}
ok(/HS\.acqWeeklyTopics/.test(slice) && /ws-topics-host/.test(slice) && /ws-slice-host/.test(slice), '1b the weekly screen mounts the queue in its own box, only when the module is loaded');

const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx); vm.runInContext(js, ctx);
const W = ctx.window.HS.acqWeeklyTopics;
const W_PRE = W.PREPARED;
// 2 the module only talks to weekly admin functions
const rpcs = [...new Set([...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))];
ok(rpcs.length >= 9 && rpcs.every((n) => /^hs_weekly_/.test(n)), '2a every call is an hs_weekly_* admin function (' + rpcs.length + ')');
const defined = (n, text) => new RegExp('function public\\.' + n + '\\(').test(text);
ok(rpcs.every((n) => defined(n, sql) || defined(n, stage2) || defined(n, bsky)), '2b every function it calls is defined in the prepared SQL');
// the two calls that are NOT in the queue-only release are each behind its own switch
const later = rpcs.filter((n) => !defined(n, sql) && !defined(n, bsky)).sort();
ok(rpcs.filter((n) => defined(n, bsky)).sort().join() === 'hs_weekly_bsky_source_file,hs_weekly_bsky_sources'
  && /function notInstalled\(e\)/.test(code), '2j the Bluesky sources: two admin functions of docs/weekly-bluesky-sources.sql, and the section hides itself when that file is not installed');
ok(JSON.stringify(later) === JSON.stringify(['hs_weekly_edition_link_version', 'hs_weekly_paste_answer'])
  && /if \(a === 'paste'\) \{\s*if \(!processing\(\)\) return;/.test(code) && /if \(a === 'link-version'\) \{\s*if \(!canLink\(\)\) return;/.test(code)
  && /function processing\(\) \{ return S\.opts\.researchProcessing === true; \}/.test(code) && /researchProcessing: false/.test(code.match(/function load\(client, el\) \{[\s\S]*?\n  \}/)[0]),
  '2h answer processing and version linking are the only calls outside the queue-only release; both are off unless switched on, and Tab 20’s entry point leaves processing off');
ok(/Prepare research request/.test(js) && /Nothing was submitted for processing/.test(js) && /prepared, not submitted/.test(js) && W_PRE === 'Research request prepared'
  && /Unavailable in this release: research processing is not deployed/.test(js), '2i a prepared request is worded apart from submitted research, and the unavailable action says why');
ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\.from\s*\(|\.storage\b|\.upload\s*\(|localStorage|sessionStorage|indexedDB|document\.cookie|perplexity\.ai|anthropic\.com|api\.bsky\.app|bsky\.social\/xrpc|youtube/i.test(code), '2c no network, table, storage, browser-storage, provider or posting call');
ok(!/\b(confirm|alert|prompt)\s*\(/.test(code), '2d no browser dialogs');
ok(!/\bverified\b/i.test(code.replace(/unverified/gi, '')), '2e nothing is labelled "verified"');
ok(/This records the promise\. It is not evidence for the story\./.test(js) && /A topic is a lead, not evidence\./.test(js) && /not evidence/.test(js.match(/Where the lead came from[^']*/)[0]), '2f promise, lead and source wording stay apart from evidence');
ok(/Nothing here posts, publishes or starts a job\./.test(js), '2g the screen says it posts nothing');

// 3 vocabulary agrees with the database
const want = ['captured', 'queued_for_research', 'researching', 'ready_for_editorial_review', 'included', 'published', 'deferred', 'dropped'];
ok(JSON.stringify(Object.keys(W.STATUS)) === JSON.stringify(want) && want.every((s) => sql.includes("'" + s + "'")), '3a the eight statuses match the database');
ok(JSON.stringify(Object.values(W.STATUS)) === JSON.stringify(['Captured', 'Queued for research', 'Researching', 'Ready for editorial review', 'Included in report', 'Published', 'Deferred', 'Dropped']), '3b the status labels are the brief’s');
ok(JSON.stringify(W.VIEWS.map((v) => v[1]).slice(0, 6)) === JSON.stringify(['Inbox / unassigned', 'Promised publicly', 'Assigned to this edition', 'Research in progress', 'Deferred / carry forward', 'Published']), '3c the six views are the brief’s');
ok(W.FIELDS.every((f) => new RegExp('\\b' + f + '\\b').test(queue)), '3d every captured field exists in the SQL');
ok(!/promised_publicly\s*[:=]\s*(true|!)/.test(code) && /generated always as \(commitment_post_url is not null\) stored/.test(queue), '3e "promised publicly" is derived by the database from the published-post address, never set by the screen');

// 4 the SQL is prepared, not applied, admin-only, and reaches nothing outside
ok(!existsSync(new URL('../supabase/migrations', import.meta.url)) || !readdirSync(new URL('../supabase/migrations', import.meta.url)).some((f) => /topic/.test(f)), '4a it is not in a migrations folder');
ok([baseSql, queue, gate].every((t) => /PREPARED, NOT APPLIED TO PRODUCTION/.test(t.split('\n')[0])) && !/supabase\.co/.test(sql + gate), '4b each file says it is not applied and names no production address');
ok(!/grant\s+(select|insert|update|delete|all)[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i.test(sqlCode), '4c no table grant to anon or authenticated');
ok(/revoke all on public\.%I from public, anon, authenticated/.test(sql) && /enable row level security/.test(sql), '4d tables: row security on, visitor access revoked');
ok(!/\bnet\.http|pg_net|cron\.schedule|_hs_.*dispatch|_wk_dispatch|_wk_queue|vault\.|storage\./i.test(sqlCode), '4e the queue-only release dispatches nothing, schedules nothing, reads no secret and touches no storage');
ok(!/insert\s+into\s+public\.weekly_(runs|research_answers)/i.test(sqlCode) && !/weekly_scripts|weekly_script_approvals/.test(sqlCode), '4h it cannot queue an engine run or save an answer, and needs no script table');
ok(!/impact_|video_bluesky|bsky_|youtube_video|social_posts/i.test(sqlCode), '4f no Tab 17, Bluesky or YouTube object is named');
ok(/weekly_append_only/.test(queue) && /weekly_topic_lead_events/.test(queue), '4g lead events are append-only');

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
  ok(!changed.some((f) => /impact|acq-weekly-report|^topics\.js$|youtube|^lib\/.*bluesky|^docs\/(?!weekly-bluesky-sources\.sql$).*bluesky/i.test(f)), '6 no Tab 17, Stage 1, Bluesky or YouTube file differs from origin/main (' + changed.length + ' files changed)');
  // the one other-tab file that changes: a test that counts the dashboard's tabs (19 -> 20)
  ok(JSON.stringify(changed.filter((f) => !/weekly/i.test(f)).sort()) === JSON.stringify(['acquisition.html', 'test/claim-check.test.mjs', 'test/video-bluesky-queue.test.mjs']),
    '6b outside the weekly files, only acquisition.html and two tab-count tests changed');
}
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
