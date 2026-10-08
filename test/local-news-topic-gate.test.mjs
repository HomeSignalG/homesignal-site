// test/local-news-topic-gate.test.mjs
//
// The Local News topic sub-check of scripts/verify-alerts-page.mjs. Since 2026-09-26 the
// public key cannot read public.alerts, and that refusal (HTTP 401) was an uncaught throw
// that stopped every Alerts page check after it (verify-alerts-page runs 125 and 126,
// "Error: Supabase alerts: 401"). The read now reports NOT MEASURED on a permission
// refusal, fails when the gate is enforced, and still throws on any other failure.
//
// Run: node test/local-news-topic-gate.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalNewsTopicMap, topicGateVerdict, TOPIC_RULE_OWNER }
  from '../scripts/lib/local-news-topic-gate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

// A fetch stand-in that answers a fixed list of responses in order and records each URL.
function fakeFetch(responses) {
  const urls = [];
  const impl = async (url) => {
    urls.push(url);
    const r = responses[Math.min(urls.length - 1, responses.length - 1)];
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { impl, urls };
}
const ARGS = { supabaseUrl: 'https://example.supabase.co', apikey: 'anon' };

// ── the read ─────────────────────────────────────────────────────────────────────
{
  // PostgREST's own body for the refusal, as the public key now receives it.
  const f = fakeFetch([{ status: 401, body: { code: '42501', message: 'permission denied for table alerts' } }]);
  let out, threw = null;
  try { out = await readLocalNewsTopicMap({ fetchImpl: f.impl, ...ARGS }); } catch (e) { threw = e; }
  ok(!threw, 'a 401 from the alerts read does not throw (it stopped every page check before)', threw && threw.message);
  ok(out && out.measured === false && out.status === 401, 'and comes back NOT MEASURED with its status', JSON.stringify(out));
  ok(f.urls.length === 1, 'it stops after the refused request instead of paging on');
  ok(/\/rest\/v1\/alerts\?category=eq\.local_news&select=source_url,subtopics&order=source_url&offset=0&limit=1000$/.test(f.urls[0]),
    'the query itself is unchanged', f.urls[0]);
}
{
  const f = fakeFetch([{ status: 403, body: {} }]);
  const out = await readLocalNewsTopicMap({ fetchImpl: f.impl, ...ARGS });
  ok(out.measured === false && out.status === 403, 'a 403 is the same permission refusal');
}
{
  const f = fakeFetch([{ status: 500, body: {} }]);
  let threw = null;
  try { await readLocalNewsTopicMap({ fetchImpl: f.impl, ...ARGS }); } catch (e) { threw = e; }
  ok(threw && threw.message === 'Supabase alerts: 500',
    'any other failure still throws, as before: a server fault is not a permission refusal', threw && threw.message);
}
{
  // Control: a readable table still builds the map, across pages, OR-ing duplicates.
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ source_url: `u${i}`, subtopics: i === 5 ? [] : ['Air Quality'] }));
  const page2 = [{ source_url: 'u5', subtopics: ['Water Quality'] }, { source_url: 'x', subtopics: null }, { source_url: null, subtopics: ['Air Quality'] }];
  const f = fakeFetch([{ status: 200, body: page1 }, { status: 200, body: page2 }]);
  const out = await readLocalNewsTopicMap({ fetchImpl: f.impl, ...ARGS });
  ok(out.measured === true && f.urls.length === 2 && /offset=1000/.test(f.urls[1]),
    'control: a readable table is read page by page', JSON.stringify({ measured: out.measured, calls: f.urls.length }));
  ok(out.map.get('u0') === true && out.map.get('x') === false, 'tagged and untagged rows are told apart');
  ok(out.map.get('u5') === true, 'a URL tagged on any of its rows counts as tagged');
  ok(!out.map.has(null) && out.map.size === 1001, 'rows without a source_url are skipped', String(out.map.size));
}

// ── the verdict ──────────────────────────────────────────────────────────────────
const rows = [{ source_ref: 'a', title: 'Tagged story' }, { source_ref: 'b', title: 'Untagged story' }];
{
  const v = topicGateVerdict({ topic: { measured: false, status: 401 }, localNews: rows, enforce: false });
  ok(v.kind === 'I', 'NOT MEASURED is reported as information while the gate only reports', v.kind);
  ok(/^NOT MEASURED/.test(v.detail) && /HTTP 401/.test(v.detail) && /2 Local News row\(s\)/.test(v.detail)
     && v.detail.includes(TOPIC_RULE_OWNER),
    'and says why, how many rows went unchecked, and who enforces the rule', v.detail);
}
{
  const v = topicGateVerdict({ topic: { measured: false, status: 401 }, localNews: rows, enforce: true });
  ok(v.kind === 'F', 'an ENFORCED gate that could not read FAILS: not measured is not passed', v.kind);
}
{
  const map = new Map([['a', true], ['b', true]]);
  const v = topicGateVerdict({ topic: { measured: true, map }, localNews: rows, enforce: true });
  ok(v.kind === 'P' && v.detail === 'all 2 Local News row(s) carry >=1 canonical topic',
    'measured and all tagged: the same PASS sentence as before', v.detail);
}
{
  const map = new Map([['a', true], ['b', false]]);
  const info = topicGateVerdict({ topic: { measured: true, map }, localNews: rows, enforce: false });
  ok(info.kind === 'I' && info.detail ===
     '1 of 2 Local News row(s) carry NO canonical topic (e.g. "Untagged story") — gate not yet applied; set LOCAL_NEWS_TOPIC_GATE=1 to enforce',
    'measured with an untagged row, report-only: the same INFO sentence as before', info.detail);
  const fail = topicGateVerdict({ topic: { measured: true, map }, localNews: rows, enforce: true });
  ok(fail.kind === 'F' && fail.detail === '1 of 2 Local News row(s) carry NO canonical topic (e.g. "Untagged story")',
    'and enforced: the same FAIL sentence as before', fail.detail);
}

// ── one read, in one place ───────────────────────────────────────────────────────
{
  const src = readFileSync(join(root, 'scripts/verify-alerts-page.mjs'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  ok(/from '\.\/lib\/local-news-topic-gate\.mjs'/.test(code), 'the verifier imports the module');
  ok(/readLocalNewsTopicMap\(/.test(code) && /topicGateVerdict\(/.test(code), 'and calls both halves of it');
  ok(!/rest\/v1\/alerts/.test(code) && !/Supabase alerts:/.test(code),
    'and keeps no second copy of the alerts read or its throw');
  ok(/rest\/v1\/app_changes/.test(code), 'control: the page-truth read it still owns is still there');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll local news topic gate checks passed.');
process.exit(fails ? 1 : 0);
