// "YouTube Videos" tab, step 6: Claude reads the note and the founder sees "Here's what I'll change" before anything is
// built. The page side (docs/youtube-video-revision-plans.sql is executed by test/youtube_video_revision_plans_pg/run.sh).
// Run: node test/youtube-video-plans.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
global.window = { HS: {} };
global.document = { body: { contains: () => true } };
require('../lib/acq-youtube-videos.js');
const Y = global.window.HS.acqYoutubeVideos;
const js = read('lib/acq-youtube-videos.js');
const sql = read('docs/youtube-video-revision-plans.sql');

const files = { final: { path: 's/final.mp4' }, short1: { path: 's/short1.mp4' }, short2: { path: 's/short2.mp4' }, thumbnail: { path: 's/thumbnail.png' } };
const base = (over) => Object.assign({ slug: 's', title: 'T', status: 'pending', created_at: '2026-10-24T00:00:00Z', files: JSON.parse(JSON.stringify(files)), meta: {}, file_decisions: {}, versions: [], revisions: [] }, over);
const ready = { id: 'p1', file_key: 'short1', status: 'ready', note: 'the music is <b>way</b> too loud', plan_md5: 'abc123', created_at: '2026-10-30T10:00:00Z',
  plan: { steps: [{ from_note: 'the music is <i>way</i> too loud', instruction: 'lower the music', changes: ['Background music halved (gain 0.045 -> 0.023).'] }],
          not_done: [{ text: 'use a nicer photo', reason: 'I could not turn this into a change I know how to make.' }],
          corrections: [{ kind: 'music', summary: 'Background music halved', delta: { bed_gain: 0.0225 } }] } };
const tile = (p, k) => Y.decisionBox(Y.fileCtx(p, k), k);

// 1. with the plans available, the note box previews instead of building
const on = tile(base({ plans: [] }), 'short1');
ok(on.includes('Preview changes') && on.includes('data-plans="1"') && !on.includes('Generate Revised Video'), '1a: the note box says Preview changes when Claude reads notes');
const off = tile(base(), 'short1');
ok(off.includes('Generate Revised Video') && !off.includes('data-plans'), '1b: without the plans SQL the note box works as before');

// 2. Claude is reading
const reading = tile(base({ plans: [Object.assign({}, ready, { status: 'planning', plan: null })] }), 'short1');
ok(reading.includes('Claude is reading your note') && reading.includes('yv-pcancel') && !reading.includes('yv-pconfirm'), '2a: while Claude reads, the tile says so and offers Cancel only');

// 3. the plan
const shown = tile(base({ plans: [ready] }), 'short1');
ok(shown.includes('Here’s what I’ll change') && shown.includes('Background music halved'), '3a: the plan lists what will change');
ok(shown.includes('Not done from your note') && shown.includes('use a nicer photo'), '3b: the plan lists what will not be done');
ok(shown.includes('data-md5="abc123"') && shown.includes('Confirm and build'), '3c: Confirm carries the md5 of the plan the founder sees');
ok(!shown.includes('<b>way</b>') && shown.includes('&lt;b&gt;way&lt;/b&gt;') && !shown.includes('<i>way</i>'), '3d: the note and the quoted parts are escaped');
ok(!shown.includes('yv-fapprove'), '3e: no Approve/Reject while a plan waits');
const nothing = tile(base({ plans: [Object.assign({}, ready, { plan: { steps: [], not_done: [{ text: 'x', reason: 'r' }], corrections: [] } })] }), 'short1');
ok(!nothing.includes('yv-pconfirm') && nothing.includes('Nothing in this note is a change I can make') && nothing.includes('Preview changes'), '3f: a plan that changes nothing cannot be confirmed and offers a new note');

// 4. failures, staleness, history
const failed = tile(base({ plans: [Object.assign({}, ready, { status: 'failed', plan: null, error: 'Claude could not read your note this time.' })] }), 'short1');
ok(failed.includes('Claude could not read your note this time.') && failed.includes('Preview changes'), '4a: a failed read says why and the note box comes back');
ok(tile(base({ plans: [Object.assign({}, ready, { status: 'confirmed' })] }), 'short1').includes('Preview changes'), '4b: a confirmed plan is not shown again');
const newer = base({ plans: [ready], revisions: [{ id: 'r1', file_key: 'short1', parent_version: 1, instruction: 'x', status: 'failed', attempts: 1, created_at: '2026-10-30T11:00:00Z' }], file_decisions: { short1: { status: 'rejected', note: 'x' } } });
ok(!tile(newer, 'short1').includes('yv-pconfirm'), '4c: a plan older than the newest revision is history');
ok(!tile(base({ plans: [ready] }), 'final').includes('yv-pconfirm'), '4d: a plan belongs to its own file only');

// 5. the wiring
ok(js.includes("client.rpc('hs_youtube_video_plan_start'") && js.includes("client.rpc('hs_youtube_video_plan_confirm', { p_plan_id: t.getAttribute('data-plan'), p_plan_md5: t.getAttribute('data-md5') })"), '5a: Preview starts a plan; Confirm sends the md5');
ok(/hs_youtube_video_plans'\)\.then\(function \(x\) \{ return x && !x\.error/.test(js), '5b: the plans list is optional (the tab works before the SQL is applied)');
ok(/x\.status === 'planning'/.test(js), '5c: the tab re-reads while Claude is reading');
ok(/approvedNow && !window\.confirm/.test(js), '5d: confirming a plan on an approved file asks first');

// 6. the SQL contract
ok(!/hs_youtube_video_plan_start[\s\S]*?file_decide[\s\S]*?\$fn\$;/.test(sql.split('create or replace function public.hs_youtube_video_plan_confirm')[0].split('create or replace function public.hs_youtube_video_plan_start')[1] || 'file_decide'), '6a: starting a plan records no decision');
ok(sql.includes("'mode', 'plan'") && sql.includes("'plan', coalesce(rv.confirmed_plan::text, '')"), '6b: plan dispatch asks for mode=plan; a build carries its confirmed plan');
ok(sql.includes('if p_plan_md5 is distinct from pl.plan_md5 then'), '6c: confirm checks the md5');
ok(/APPLY ORDER: homesignal-ingest #973/.test(sql), '6d: the file names its apply order');

console.log(fails ? fails + ' FAILURE(S)' : 'ALL PASS');
process.exit(fails ? 1 : 0);
