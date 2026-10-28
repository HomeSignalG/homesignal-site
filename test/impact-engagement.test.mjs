// Tab 17 Engage on Bluesky: the page module's contract with docs/impact-engagement.sql, and its separation from the
// Impact Stories video pipeline. Offline (the SQL itself runs in test/impact_engagement_pg).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('lib/acq-impact-engagement.js');
const sql = read('docs/impact-engagement.sql');
const html = read('acquisition.html');
const stories = read('lib/acq-impact-stories.js');

// 1. shell
const key = createHash('sha256').update(js).digest('hex').slice(0, 8);
ok(html.includes('lib/acq-impact-engagement.js?v=' + key), '1a acquisition.html loads the module at its content key (' + key + ')');
ok(html.indexOf('acq-impact-engagement.js') < html.indexOf('acq-impact-stories.js'), '1b it loads before the library that mounts it');
ok(/id="is-engage"/.test(stories) && /HS\.acqImpactEngagement\.attach\(S\.client, eng\)/.test(stories), '1c the library mounts its own section, beside Hot Topics');
ok(stories.indexOf('id="is-hot"') < stories.indexOf('id="is-engage"'), '1d it sits under the Hot Topics panel');

// 2. RPCs: exactly the two founder functions, admin-gated, authenticated only
const called = [...new Set([...js.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))];
ok(called.sort().join() === 'hs_impact_engagement_decide,hs_impact_engagement_overview', '2a the page calls only the two founder functions (' + called.join(', ') + ')');
for (const f of called) {
  const body = (sql.match(new RegExp('create or replace function public\\.' + f + '\\([\\s\\S]*?\\$\\$;', 'm')) || [''])[0];
  ok(/public\._hs_is_admin\(\)/.test(body), '2b ' + f + ' checks the dashboard allowlist');
}
ok(!/\.from\(['"]impact_/.test(js), '2c the page never reads a table directly');

// 3. separation and no publishing
ok(!/impact_story|hs_impact_story|_hs_is_request|video_bluesky|social_posts/.test(js), '3a the page touches nothing in the video pipeline or the Bluesky queues');
ok(!/impact_stor(y|ies)|video_bluesky_jobs|social_posts|net\.http|_dispatch/.test(sql.replace(/^--.*$/gm, '')), '3b the SQL references no story, job, queue or dispatch');
ok(!/createRecord|bsky\.social\/xrpc|com\.atproto/.test(js), '3c the page cannot post to Bluesky');
ok(/Nothing is posted automatically/.test(js), '3d the page says nothing posts automatically');

// 4. controls and honesty
for (const c of ['preview', 'copy', 'open', 'post-form', 'posted', 'skip']) ok(js.includes("data-ie=\"" + c + '"') || js.includes("data-ie=\\\"" + c), '4a control: ' + c);
ok(/>Preview</.test(js) && />Copy</.test(js) && />Open Original</.test(js) && />Mark Posted</.test(js) && />Skip</.test(js), '4b the five named controls are shown');
ok(/This post: '/.test(js) && /n\(o\.replies\) \+ ' replies/.test(js), '4c counts are labelled as this post\'s own');
ok(/function safe\(u\) \{ return \/\^https:/.test(js), '4d a link is rendered only when it is https');
ok(/LIMIT = 300/.test(js) && /Intl\.Segmenter/.test(js), '4e drafts are counted in graphemes against 300');
ok(/TOP = 5/.test(js) && /PER_TOPIC_IN_TOP = 2/.test(js), '4f the strongest five come first, at most two per topic');
ok(/not read yet/.test(js), '4g an unobserved result says so instead of 0');

// 5. SQL guarantees by shape
ok(/target_uri\s+text not null unique/.test(sql), '5a one row per Bluesky post');
ok(/Already marked posted/.test(sql), '5b a second Mark Posted is refused');
ok(/char_length\(draft->>'text'\) <= 300/.test(sql), '5c the table refuses a draft over 300');
ok(/utm_campaign = 'engage'/.test(sql) && /utm_content/.test(sql), '5d visits are attributed by the draft\'s own utm_content');

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all passed');
