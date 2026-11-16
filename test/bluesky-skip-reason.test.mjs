// Tab 12: skipping a post records WHY (docs/social-skip-reasons.sql). Page and SQL must agree.
import { readFileSync } from 'node:fs';
const rd = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const PAGE = rd('../acquisition.html'), SQL = rd('../docs/social-skip-reasons.sql');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL — ' + m); } else console.log('ok — ' + m); };

const block = PAGE.match(/var BSKY_SKIP_REASONS=\[([\s\S]*?)\n  \];/)[1];
const pageCodes = [...block.matchAll(/\['([a-z_]+)','[^']+'\]/g)].map(m => m[1]);
const sqlList = SQL.match(/reasons <@ array\[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map(x => x.slice(1, -1));
ok(sqlList.length >= 8, 'SQL allows a list of reason codes (positive control)');
ok(sqlList.every(c => pageCodes.includes(c)) && pageCodes.length === sqlList.length,
   'every reason the page offers is allowed by the table, and every allowed one is offered');
ok(/id="bsky-skip-overlay"/.test(PAGE) && /id="bsky-skip-note"/.test(PAGE), 'the skip box and its note field exist');
ok(/rpc\('hs_social_post_skip'/.test(PAGE), 'the page skips through hs_social_post_skip');
ok(!/update\(\{status:'skipped'\}\)/.test(PAGE), 'the page no longer writes status=skipped directly (that path kept no reason)');
ok(/act==='skip'\)\{\s*openBskySkip\(id\)/.test(PAGE), 'the Skip button opens the box, it does not skip');
ok(/only a draft or an approved post can be skipped/.test(PAGE), 'an already-skipped post is not shown as a failure');
ok(/bskySkipBusy/.test(PAGE), 'the confirm button cannot fire twice');
ok(/append-only/.test(SQL) && /enable row level security/.test(SQL), 'the log is append-only with RLS on');
ok(/revoke all on function public\.hs_social_post_skip[^;]*anon/.test(SQL), 'anon cannot execute the skip function');
ok(/_hs_is_admin\(\)/.test(SQL), 'only a dashboard admin can skip or read reasons');
process.exit(fails ? 1 : 0);
