// BLUESKY APPROVE — A REFUSAL IS SHOWN ONCE AND THE QUEUE RE-READ, NEVER RETRIED (2026-09-24).
// Offline, structural: reads the shipped acquisition.html. No network, no browser, no DB.
//
// Why: on 2026-09-22 two Approve clicks on stale drafts were refused by
// hs_approve_social_post with SQLSTATE 40001, which PostgREST re-ran for ~47 h
// (~1,280 failing calls/s, database CPU at ~100%). The database half is fixed in
// homesignal-ingest (20260924230000: stale review -> P0001, refused once). This pins the
// page half so the dashboard can never become the retry loop instead:
//   * the approve RPC is called from exactly ONE place, and not inside any loop;
//   * on refusal the page alerts, re-reads the queue (refreshBluesky) and returns —
//     the founder must look at the current revision and click Approve again.
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../acquisition.html', import.meta.url), 'utf8');
const strip = (src) => src
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const CODE = strip(DASH);

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

const calls = CODE.match(/rpc\(\s*'hs_approve_social_post'/g) || [];
ok(calls.length === 1, `hs_approve_social_post is called from exactly one place (found ${calls.length})`);

// The approve action, brace-matched from its declaration.
const start = CODE.indexOf('async function blueskyAction(');
ok(start !== -1, 'blueskyAction exists (positive control for the slice below)');
let depth = 0, i = CODE.indexOf('{', start), end = -1;
for (; i < CODE.length; i++) {
  if (CODE[i] === '{') depth++;
  else if (CODE[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
const FN = CODE.slice(start, end + 1);
ok(FN.includes("rpc('hs_approve_social_post'"), 'the one approve call lives inside blueskyAction');
ok(!/\b(for|while|do)\s*[({]/.test(FN) && !/setTimeout|setInterval/.test(FN),
   'blueskyAction contains no loop or timer that could re-issue the approve call');

// The refusal branch: alert, re-read, return — in that order, and nothing else.
const branch = FN.match(/if\(r\.error\)\{([^}]*)\}/);
ok(!!branch, 'the approve refusal branch exists');
const b = branch ? branch[1] : '';
ok(/alert\('Approve failed: '/.test(b), 'the refusal is shown to the founder (existing message kept)');
ok(/refreshBluesky\(\)/.test(b), 'the refusal re-reads the queue so the current revision is shown');
ok(!/hs_approve_social_post|blueskyAction\(/.test(b), 'the refusal never re-approves or re-enters the action');
ok(/return;/.test(b), 'the refusal branch returns');
ok(b.indexOf('alert(') < b.indexOf('refreshBluesky()') && b.indexOf('refreshBluesky()') < b.indexOf('return;'),
   'order is alert -> refresh -> return');

// refreshBluesky itself is read-only with respect to approval.
const rs = CODE.indexOf('async function refreshBluesky(');
const re = CODE.indexOf('async function blueskyAction(');
const RB = rs !== -1 && re > rs ? CODE.slice(rs, re) : '';
ok(RB.length > 0 && RB.includes("from('social_posts').select("), 'refreshBluesky re-reads social_posts (positive control)');
ok(!RB.includes('hs_approve_social_post') && !/status:'approved'/.test(RB),
   'refreshBluesky never approves anything');

console.log(`\n${n - bad}/${n} passed`);
if (bad) process.exit(1);
