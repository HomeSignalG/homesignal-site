// Tab 17 Hot Topics (Impact Stories auto-discovery): the page module's contract with docs/impact-discovery.sql. Offline.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('lib/acq-impact-discovery.js');
const sql = read('docs/impact-discovery.sql');
const html = read('acquisition.html');
const stories = read('lib/acq-impact-stories.js');

// 1. shell
const key = createHash('sha256').update(js).digest('hex').slice(0, 8);
ok(html.includes('lib/acq-impact-discovery.js?v=' + key), '1a acquisition.html loads the module with its content key');
ok(html.indexOf('acq-impact-discovery.js') < html.indexOf('acq-impact-stories.js'), '1b it loads before the stories module that mounts it');
ok(/#is-hot/.test(stories) && /HS\.acqImpactDiscovery\.attach\(/.test(stories), '1c the library mounts the Hot Topics panel');
ok(/Auto-discovered — Ready for Review/.test(stories), '1d the library labels an auto-discovered story ready for review');

// 2. every RPC the page calls is admin-gated and granted to authenticated only
const called = [...new Set([...js.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))];
ok(called.length === 6, '2a the page calls exactly the six founder functions (' + called.join(', ') + ')');
for (const f of called) {
  const body = (sql.match(new RegExp('create or replace function public\\.' + f + '\\([\\s\\S]*?\\$\\$;', 'm')) || [''])[0];
  ok(/public\._hs_is_admin\(\)/.test(body), '2b ' + f + ' checks the dashboard allowlist');
  ok(new RegExp("'public\\." + f + "\\([^']*\\)'").test(sql.slice(sql.indexOf("revoke all on function ' || f || ' from public, anon';") - 400)), '2c ' + f + ' is in the authenticated grant list');
}
ok(!/\.from\(['"]impact_discovery/.test(js), '2d the page never reads a discovery table directly');
ok(!/impact_discovery_(scan_record|scan_finish|research|prepare|scan_claim|tick|nominations)/.test(js), '2e the page never calls a scanner, research or tick function');

// 3. safety and honesty in the page
ok(/function url\(u\) \{ return \/\^https\?:\\\/\\\//.test(js), '3a a link is rendered only when it is http(s)');
ok(/rel="noopener noreferrer"/.test(js), '3b outside links open with noopener');
ok(/The latest scan failed/.test(js) && /Nothing it saw was recorded/.test(js), '3c a failed scan is shown as a failure, not an empty list');
ok(/not evidence/.test(js) && /Provisional — written from the posts, unverified/.test(js), '3d posts and the provisional concept are labelled unverified');
ok(/disabled title="A story is created only after its records are verified"/.test(js), '3e Create Impact Story is disabled until the records are verified');
ok(!/approve|render|publish/i.test((js.match(/rpc\('[^']+'/g) || []).join(' ')), '3f no call approves, renders or publishes');
ok(/Likes and followers are not counted as results/.test(js), '3g performance is first-party results, not likes or followers');
ok(/not collected yet/.test(js), '3h unmeasured outcomes say so instead of showing zero');

// 4. SQL guarantees, by shape (the executable proof is test/impact_discovery_pg)
ok(/ev = 'leads_found'/.test(sql), '4a nomination needs an independent source');
ok(/c\.evidence_status <> 'verified' or c\.source_slug is null/.test(sql), '4b a story needs a verified source pack');
ok(/not st\.experimental_auto/.test(sql), '4c the experimental track is not prepared automatically by default');
ok(/max_prepare_per_scan/.test(sql) && /already prepared/.test(sql), '4d at most N stories per scan');
ok(!/hs_impact_story_decide|hs_impact_story_render|impact_story_approvals \(/.test(sql), '4e the discovery SQL never approves or renders');
ok(/_hs_is_request\(s\.id, 'analyze'/.test(sql) && /_hs_is_request\(s\.id, 'generate'/.test(sql), '4f automatic steps go through the same checks as the founder\'s buttons');

// 5. Codex review on #2308
const create = (sql.match(/create or replace function public\._hs_id_create_story[\s\S]*?\$\$;/) || [''])[0];
ok(create.indexOf('pg_advisory_xact_lock') >= 0 && create.indexOf('pg_advisory_xact_lock') < create.indexOf('select count(*) into n'),
  '5a story creation is serialized before the per-scan count is read');
ok(/function idleDelay\(\)/.test(js) && /st\.scan_enabled === false\) return null/.test(js) && /next_scan_at/.test(js.slice(js.indexOf('function idleDelay')))
   && /IDLE_MAX_MS = 30 \* 60000/.test(js), '5c with scheduled scans on, an idle panel looks again after the next scan is due (at most every 30 min)');
ok(/var PENDING = \['nominated', 'researching', 'preparing'\]/.test(js) && /SLOW_POLL_MS/.test(js), '5b the panel keeps refreshing while topics are nominated, researched or prepared');

// 6. Suggest a topic (founder, 2026-10-28)
const yv = read('lib/acq-youtube-videos.js');
ok(/rpc\('hs_impact_discovery_suggest'/.test(js) && /id="hot-suggest"/.test(js), '6a Hot Topics carries the Suggest a topic form and calls the suggest function');
ok(!/yv-suggest|acqImpactDiscovery/.test(yv),
  '6b Tab 16 no longer jumps to Tab 17: it has its own Suggest a video box (lib/acq-video-suggest.js, founder 2026-10-28)');
ok(/Your pick/.test(js) && /function founderCard\(c\)/.test(js) && /if \(founder\(c\)\) return founderCard\(c\)/.test(js),
  '6d a founder topic is drawn as Your pick (no score, no Bluesky lead line)');
ok(/leads to check, not yet evidence/.test(js) && /Your links are leads to check, not evidence/.test(js), '6e founder links are labelled leads, not evidence');
const fc = js.slice(js.indexOf('function founderCard'), js.indexOf('function card(c)'));
ok(!/exclude_similar|data-k="score"/.test(fc), '6f a founder topic has no Score and no Exclude Similar Topics');
ok(/SUGGEST_FIELDS\.forEach/.test(js.slice(js.indexOf('function snapshot'))), '6g an automatic refresh keeps what was typed in the form');
const sug = (sql.match(/create or replace function public\.hs_impact_discovery_suggest[\s\S]*?\$\$;/) || [''])[0];
ok(/_hs_is_admin\(\)/.test(sug) && /'founder:' \|\| gen_random_uuid\(\)/.test(sug) && /'nominated'/.test(sug), '6h the suggestion is admin-only and goes straight to research');
ok(/where origin = 'scan' and \(cluster_key/.test(sql) && /where origin = 'scan' and last_seen_at/.test(sql), '6i a scan never matches or is handed a founder topic');
ok(/if c\.origin = 'scan' and n >= st\.max_prepare_per_scan/.test(sql), '6j the per-scan limit is for scanned topics only');

console.log(fails ? '\n' + fails + ' failed' : '\nall passed');
process.exit(fails ? 1 : 0);
