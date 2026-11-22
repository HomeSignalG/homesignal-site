// TAB 2 · 'uncertain' feed read outcome (homesignal-ingest#1160). Run: node test/zip-feed-uncertain.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };
const ctx = { console, Date }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(rd('../lib/acq-zip-feed-health.js'), ctx);
const HS = ctx.HS, L = HS.feedReadLine;
const u = L({ health: 'READ_UNCERTAIN', last_attempt_at: '2026-11-22T08:00:00Z', last_error: 'civicclerk: response could not be classified (empty body on a successful status)' });
ok(/^READ UNCERTAIN · last read/.test(u) && /could not be classified/.test(u), 'an uncertain read is its own line and shows its reason');
ok(!/READ FAILED/.test(u) && !/Read OK/.test(u), 'uncertain is neither failed nor a successful read');
ok(/^Read OK, zero items/.test(L({ health: 'READ_OK_ZERO_ITEMS', last_attempt_at: '2026-11-22T08:00:00Z' })), 'a confirmed empty read is unchanged');
ok(/^READ FAILED/.test(L({ health: 'READ_FAILED', last_attempt_at: '2026-11-22T08:00:00Z', consecutive_errors: 1, last_error: 'x' })), 'a failed read is unchanged');
ok(/^Unrecognised outcome/.test(L({ health: 'READ_UNKNOWN_OUTCOME', last_attempt_at: '2026-11-22T08:00:00Z' })), 'an unknown outcome value is shown as unrecognised, not as OK');
const summary = { feeds_total: 3000, active: 2944, inactive: 56, by_kind: {}, by_evidence: {}, by_kind_evidence: [], feeds_with_outcome: 2900, health_unknown: 44, stale_threshold_hours: 12,
  health_states: { READ_OK_ITEMS: 1800, READ_OK_ZERO_ITEMS: 1000, READ_FAILED: 60, READ_UNCERTAIN: 7, STALE_EVIDENCE: 4, NEVER_CHECKED: 40 } };
const html = HS.feedInventoryHtml(summary);
ok(/Uncertain read/.test(html) && /data-filter="health:READ_UNCERTAIN"/.test(html), 'the summary has an uncertain tile with its own drill-down');
ok(/data-filter="health:READ_FAILED"/.test(html) && /data-filter="health:READ_OK_ZERO_ITEMS"/.test(html), 'failed and empty keep their own drill-downs');
const sql = rd('../docs/feed-read-health-uncertain.sql'), doc = rd('../docs/feed-read-health.sql');
ok(/when l\.outcome = 'uncertain' then 'READ_UNCERTAIN'/.test(sql) && /when l\.outcome = 'ok' then 'READ_OK_ITEMS'/.test(sql) && /else 'READ_UNKNOWN_OUTCOME'/.test(sql), 'SQL maps uncertain apart and no longer treats an unknown value as OK');
ok(sql.includes(doc.slice(doc.indexOf("when l.outcome = 'uncertain'"), doc.indexOf("else 'READ_UNKNOWN_OUTCOME'") + 30)), 'the apply file and the DDL of record agree');
ok(!/\bdrop\s+function/i.test(sql.replace(/--[^\n]*/g, '')), 'the apply file drops nothing');
console.log(`\n${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
