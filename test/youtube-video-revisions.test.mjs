// "YouTube Videos" tab: the revision flow (seven states, the Generate button, history, polling, escaping) and the
// SQL of record's contract. The SQL itself is executed by test/youtube_revisions_pg/run.sh.
// Run: node test/youtube-video-revisions.test.mjs
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
const sql = read('docs/youtube-video-revisions.sql');

const files = { final: { path: 's/final.mp4' }, short1: { path: 's/short1.mp4' }, short2: { path: 's/short2.mp4' }, thumbnail: { path: 's/thumbnail.png' } };
const base = (over) => Object.assign({ slug: 's', title: 'T', status: 'pending', created_at: '2026-10-24T00:00:00Z', files: JSON.parse(JSON.stringify(files)), meta: {}, file_decisions: {}, versions: [], revisions: [] }, over);
const A = { status: 'approved' };
const rej = { status: 'rejected', note: 'The narrator mispronounces the word "noise".' };
const rev = (o) => Object.assign({ id: 'r1', file_key: 'short1', parent_version: 1, instruction: rej.note, status: 'queued', attempts: 1, plan: null, result: null }, o);
const state = (p, k) => Y.fileCtx(p, k).state;

// 1. the seven states
ok(state(base(), 'short1') === 'pending', '1a: Awaiting Review');
ok(state(base({ file_decisions: { short1: A } }), 'short1') === 'approved', '1b: Approved');
ok(state(base({ file_decisions: { short1: rej } }), 'short1') === 'rejected', '1c: Rejected — Revision Needed');
ok(state(base({ file_decisions: { short1: rej }, revisions: [rev({ status: 'running' })] }), 'short1') === 'generating', '1d: Generating Revision');
ok(state(base({ file_decisions: { short1: rej }, revisions: [rev({ status: 'validating' })] }), 'short1') === 'validating', '1e: Validating Revision');
const revisedFiles = JSON.parse(JSON.stringify(files)); revisedFiles.short1 = { path: 's/versions/short1/v2-aa.mp4', version: 2, revised: true };
const revised = base({ files: revisedFiles, versions: [{ file_key: 'short1', version: 1, path: 's/versions/short1/v1-original.mp4', decision: rej, created_at: '2026-10-23T00:00:00Z' }, { file_key: 'short1', version: 2, path: 's/versions/short1/v2-aa.mp4', created_at: '2026-10-24T00:00:00Z' }],
  revisions: [rev({ status: 'succeeded', result_version: 2, result: { summary: 'Pronunciation of "noise", treatment 1 of 3.', validation: { human_listening_required: true, checks: [{ name: 'loudness', ok: true, verified: true, detail: '-14.1 LUFS' }, { name: '"noise" sounds right', ok: false, verified: false, detail: 'NOT machine-verifiable' }] } } })] });
ok(state(revised, 'short1') === 'revised', '1f: Revised — Awaiting Review');
ok(state(base({ file_decisions: { short1: rej }, revisions: [rev({ status: 'failed', error: 'Revision failed because narration generation could not complete. Your original video is safe. Retry Generation.' })] }), 'short1') === 'failed', '1g: Generation Failed');
ok(state(Object.assign({}, revised, { file_decisions: { short1: Object.assign({}, A, { version: 1 }) } }), 'short1') === 'revised', '1h: an approval of the OLD version does not carry to the revised one');
ok(state(Object.assign({}, revised, { file_decisions: { short1: Object.assign({}, A, { version: 2 }) } }), 'short1') === 'approved', '1i: approving the revised version approves it');

// 2. what each state shows
const h = (p) => Y.render([p]);
const rejHtml = h(base({ file_decisions: { short1: rej } }));
ok(rejHtml.includes('Generate Revised Video') && rejHtml.includes('value="The narrator mispronounces the word &quot;noise&quot;."'), '2a: a rejected video offers "Generate Revised Video" under the saved note');
ok(rejHtml.includes('value="The narrator mispronounces the word &quot;noise&quot;."') && rejHtml.includes('yv-fsavenote'), '2b: the saved note is shown, editable, and re-savable');
ok(h(base({ file_decisions: { thumbnail: { status: 'rejected', note: 'text too small' } } })).includes('Generate Revised Thumbnail'), '2c: a rejected thumbnail offers "Generate Revised Thumbnail"');
const allKinds = h(base({ file_decisions: { final: { status: 'approved' }, short2: { status: 'approved' }, thumbnail: { status: 'approved' }, short1: { status: 'rejected' } } }));
ok((allKinds.match(/yv-revise yv-revise-now/g) || []).length === 4, '2d: the Generate button is visible on EVERY asset, approved or rejected (founder: visible on all assets)');
ok((h(base({})).match(/yv-revise yv-revise-now/g) || []).length === 4, '2d2: and on every asset still awaiting review');
const genHtml = h(base({ file_decisions: { short1: rej }, revisions: [rev({ status: 'running' })] }));
ok(genHtml.includes('Generating Revision') && genHtml.includes('You can leave this page') && genHtml.includes('yv-rcancel'), '2f: generating shows progress, reassurance and Cancel');
const shortTile = genHtml.slice(genHtml.indexOf('data-key="short1"'), genHtml.indexOf('data-key="short2"'));
ok(!shortTile.includes('class="yv-fapprove"') && !shortTile.includes('class="yv-revise'), '2g: a generating file cannot be approved or re-requested');
const failHtml = h(base({ file_decisions: { short1: rej }, revisions: [rev({ status: 'failed', error: 'Revision failed because narration generation could not complete. Your original video is safe. Retry Generation.' })] }));
ok(failHtml.includes('Generation Failed') && failHtml.includes('Your original video is safe') && failHtml.includes('class="yv-rretry"'), '2h: failure shows the friendly reason and Retry Generation');
ok(!h(base({ file_decisions: { short1: rej }, revisions: [rev({ status: 'failed', attempts: 3, error: 'x' })] })).includes('class="yv-rretry"'), '2i: after three attempts there is no Retry, only "change the note"');
const unsup = h(base({ file_decisions: { short1: rej }, revisions: [rev({ status: 'unsupported', created_at: '2026-10-29T00:08:11Z', error: 'No automatic correction could be made. Your original video is safe.', plan: { unsupported: [{ reason: 'Map corrections need verified coordinates.', suggestion: 'Say "zoom out".' }] } })] }));
ok(unsup.includes('Map corrections need verified coordinates.') && unsup.includes('zoom out'), '2j: an unsupported note says why and what to write instead');
ok(/yv-tried[^>]*>This is the result of your try on [^<]+\. It does not change by itself\. To try again, press <b>Generate Revised Video<\/b>/.test(unsup), '2j2: an unsupported result says when it was tried and that it does not update by itself');
const revHtml = h(revised);
ok(revHtml.includes('Revised — Awaiting Review') && revHtml.includes('Please listen') && revHtml.includes('needs you') && revHtml.includes('-14.1 LUFS'), '2k: a revised file lists what changed, what was measured and what needs a human');
ok(revHtml.includes('Version history (2)') && revHtml.includes('Play this version') && revHtml.includes('you rejected') && revHtml.includes('mispronounces the word &quot;noise&quot;') , '2l: the history keeps the rejected version, its note, and a way to replay it');
ok(revHtml.includes('class="yv-fapprove"'), '2m: the revised version has its own Approve/Reject');

// 3. summary line
const mixed = base({ file_decisions: { final: A, short2: A, thumbnail: A, short1: rej } });
ok(Y.summaryLine(mixed) === '3 Approved · 1 Needs Revision', '3a: "3 Approved · 1 Needs Revision"');
ok(h(mixed).includes('3 Approved · 1 Needs Revision'), '3b: shown on the card');
ok(Y.summaryLine(Object.assign({}, mixed, { revisions: [rev({ status: 'queued' })] })) === '3 Approved · 1 Generating', '3c: a running revision counts as Generating');

// 4. escaping
const evil = h(base({ file_decisions: { short1: { status: 'rejected', note: '<img src=x onerror=1>' } }, revisions: [rev({ status: 'failed', error: '<script>1</script>', instruction: '<b>x</b>' })] }));
ok(!evil.includes('<img src=x') && !evil.includes('<script>1') , '4a: notes and errors are escaped');

// 5. the browser only calls the gated functions; no secrets
ok(/hs_youtube_video_revise/.test(js) && /hs_youtube_video_revision_retry/.test(js) && /hs_youtube_video_revision_cancel/.test(js), '5a: the three admin-gated functions');
ok(!/hs_youtube_revision_(mark|complete|sweep)|hs_youtube_publishable_files|service_role|SUPABASE_WRITE_KEY/.test(js), '5b: the page never names a worker-only function or a key');
ok(/setTimeout/.test(js) && /POLL_MS = 10000/.test(js) && /\.paused/.test(js), '5c: it polls while a revision is active and never reloads under a playing video');

// 6. SQL of record: contract structure (behaviour is executed in test/youtube_revisions_pg)
const code = sql.replace(/--.*$/gm, '');
ok(/revoke all on public\.youtube_video_versions from public, anon, authenticated/.test(code) && /revoke all on public\.youtube_video_revisions from public, anon, authenticated/.test(code), '6a: both new tables are RLS-on with no direct grants');
ok(/create unique index if not exists youtube_video_revisions_one_active[\s\S]{0,200}where status in \('queued', 'running', 'validating'\)/.test(code), '6b: one active revision per file is a database constraint');
ok(/grant execute on function public\.hs_youtube_revision_mark[\s\S]{0,300}to service_role;/.test(code) && !/grant execute on function public\.hs_youtube_revision_(mark|complete|sweep)[^;]*authenticated/.test(code.replace(/revoke[^;]*;/g, '')), '6c: worker functions are service_role only');
ok(!/delete from public\.youtube_video_versions|drop table|truncate/i.test(code), '6e: no version is ever deleted');
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
