// Tab 17 · Impact Stories: offline contract between the page, the SQL of record and the dashboard shell.
// Run: node test/impact-stories.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('lib/acq-impact-stories.js');
const sql = read('docs/impact-stories.sql');
const html = read('acquisition.html');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 1. the tab
const nav = html.match(/<nav class="tabs">([\s\S]*?)<\/nav>/)[1];
const labels = [...nav.matchAll(/data-tab="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
ok(labels.length === 17 && labels[16][0] === 'impactstories' && labels[16][1] === '17 · Impact Stories', 'nav: tab 17 is named exactly "17 · Impact Stories"');
ok(!/youtube|tiktok/i.test(labels[16][1]), 'nav: the tab name carries no platform name');
ok(labels[10][1] === '11 · Video Producer' && labels[15][1] === '16 · YouTube Videos' && labels[15][0] === 'youtubevideos', 'nav: tabs 11 and 16 keep their ids and names');
ok(html.includes('<div class="tab" id="tab-impactstories"></div>'), 'shell: the tab container exists');
ok(/impactstories: function \(\) \{[\s\S]*?HS\.acqImpactStories\.load\(window\.hsClient, el\)/.test(html), 'shell: a trusted initializer loads the module');
ok(html.includes("if(id==='impactstories') return;"), 'shell: a snapshot refresh never overwrites the open workspace');
const key = createHash('sha256').update(read('lib/acq-impact-stories.js')).digest('hex').slice(0, 8);
ok(html.includes('lib/acq-impact-stories.js?v=' + key), 'shell: the cache key is the file content (' + key + ')');

// 2. every RPC the page calls exists, is admin-gated, and is granted to authenticated only
const called = [...new Set([...code.matchAll(/rpc\('([a-z_0-9]+)'/g)].map((m) => m[1]))];
ok(called.length >= 10, 'page calls ' + called.length + ' functions');
for (const f of called) {
  const def = sql.match(new RegExp('create or replace function public\\.' + f + '\\(([^)]*)\\)[\\s\\S]*?\\$\\$;', 'm'));
  ok(!!def, f + ': defined in docs/impact-stories.sql');
  ok(def && /_hs_is_admin\(\)/.test(def[0]), f + ': checks the dashboard allowlist');
  ok(new RegExp("'public\\." + f + "\\([^']*\\)'[^\\]]*\\]\\s*loop\\s*execute 'revoke all on function ' \\|\\| f \\|\\| ' from public, anon';\\s*execute 'grant execute on function ' \\|\\| f \\|\\| ' to authenticated'").test(sql), f + ': granted to authenticated, revoked from anon');
}
for (const f of ['hs_impact_story_job_claim', 'hs_impact_story_job_complete', 'hs_impact_story_job_fail']) {
  ok(!called.includes(f), f + ': never called from the browser');
  ok(new RegExp("'public\\." + f + "\\([^']*\\)'[^\\]]*\\]\\s*loop\\s*execute 'revoke all on function ' \\|\\| f \\|\\| ' from public, anon, authenticated';\\s*execute 'grant execute on function ' \\|\\| f \\|\\| ' to service_role'").test(sql), f + ': service_role only');
}

// 3. data safety
for (const t of ['impact_stories', 'impact_story_versions', 'impact_story_jobs', 'impact_story_approvals', 'impact_story_events',
                 'impact_story_assets', 'impact_story_media_decisions']) {
  ok(sql.includes('alter table public.' + t + ' enable row level security;') && sql.includes('revoke all on public.' + t + ' from public, anon, authenticated;'), t + ': RLS on, no browser grant');
}
ok(!/(insert into|update|delete from)\s+public\.(youtube_video_\w+|video_bluesky_jobs|social_posts)/i.test(sql), 'sql: never writes a Tab 11/16 or social table');
ok(!/\b(drop table|truncate|alter table public\.(youtube|social|video_))/i.test(sql), 'sql: additive only');
ok(/'impact-story-render\.yml'/.test(sql) && /'impact-story-job\.yml'/.test(sql) && /actions\/workflows\/' \|\| _wf \|\| '\/dispatches/.test(sql) && /'ref', 'main'/.test(sql),
   'sql: dispatches the ingest worker (text jobs) or the render workflow, on main');
ok(/values \('impact-media', 'impact-media', false,/.test(sql) && /for select to authenticated using \(bucket_id = 'impact-media' and public\.hs_is_dashboard_admin\(\)\)/.test(sql)
   && !/policy[^;]*impact-media[^;]*for (insert|update|delete|all)/i.test(sql), 'sql: the media bucket is private and admin read-only');

// 4. the page cannot publish, upload or hold a secret
ok(!/googleapis|youtube\.com\/upload|open\.tiktokapis|bsky\.social|com\.atproto/i.test(code), 'page: no platform API');
ok((code.match(/\.storage\./g) || []).length === 1 && /\.storage\.from\(BUCKET\)\.download\(/.test(code)
   && !/\.(upload|createSignedUrl|getPublicUrl|createSignedUploadUrl)\(/.test(code)
   && !/service_role|SUPABASE_WRITE_KEY|sk-ant/i.test(code), 'page: storage is read only (download as the admin), no secret');
ok(!/hs_youtube|hs_video_|social_posts/.test(code), 'page: never calls a Tab 16 / Bluesky queue function');
ok(/nothing is published/.test(js) && /Not published/.test(js) && /Not connected/.test(js) && !/Not built yet/.test(js), 'page: honest Media / Distribution states');
ok(!/innerHTML\s*=\s*[^;]*\+\s*(?!esc\()[a-z]+\.(title|text|error)\b/.test(code), 'page: database text goes through esc()');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
