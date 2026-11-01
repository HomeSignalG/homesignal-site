#!/usr/bin/env node
// BEFORE/AFTER RECORD COUNTS (release gate item 2, docs/lifecycle-classification-audit-2026-11-01.md §10).
//
// REPORT-ONLY. Two halves, kept apart on purpose:
//
//   collect  Runs on a GitHub runner (lifecycle-before-after.yml, environment `production`). Reads production
//            through the Management API's READ-ONLY endpoint, one ZIP-prefix slice at a time (00..99), and writes
//            the raw counts per (registry_id, stored stage, stored status) to a JSON file. No logic, no mapping:
//            it only counts what is stored. A full national read is ~10 minutes of heap I/O, so it is sliced and
//            sequential (CLAUDE.md §5: full-corpus reads one at a time), and a slice that fails is retried, then
//            the whole run fails (a partial count is never written as a complete one).
//   report   Runs anywhere, offline. Joins those counts to the generated status-mapping audit
//            (docs/lifecycle-mapping-audit/mapping.csv) and writes docs/lifecycle-mapping-audit/before-after.md
//            plus before-after.csv. "Before" is today's column, from HS.canonicalLifecycle (the function every
//            surface uses today). "After" is the audit's proposed column and activity.
//
// THE UNIT IS A ZIP-PAGE PLACEMENT, NOT A UNIQUE RECORD. public.app_projects holds one row per ZIP page a record
// is shown on. Counting placements measures what residents see across the 12,744 ZIP pages; a record shown on four
// pages counts four times. Unique records are not counted here (a distinct count across slices is not additive).
//
// NOTHING IS ENABLED BY THIS. It reads; it writes two files.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/lifecycle-before-after.mjs collect <out.json>
//   node scripts/lifecycle-before-after.mjs report <counts.json>      write the two docs files
//   node scripts/lifecycle-before-after.mjs report <counts.json> --check
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_CSV = 'docs/lifecycle-mapping-audit/mapping.csv';
const OUT_MD = 'docs/lifecycle-mapping-audit/before-after.md';
const OUT_CSV = 'docs/lifecycle-mapping-audit/before-after.csv';
const REGISTRY = 'supabase/functions/get-address-report/jurisdiction-registry.json';
const COLUMNS = ['proposed', 'approved', 'operating', 'unknown'];

// ── collect ──────────────────────────────────────────────────────────────────────────────────────
export function prefixBounds() {
  const out = [];
  for (let i = 0; i < 100; i++) {
    const lo = String(i).padStart(2, '0');
    const hi = i === 99 ? '9:' : String(i + 1).padStart(2, '0'); // ':' sorts after '9'
    out.push([lo, hi]);
  }
  return out;
}

export function sliceSql(lo, hi) {
  if (!/^\d\d$/.test(lo) || !/^(\d\d|9:)$/.test(hi)) throw new Error('bad slice bounds');
  return "select registry_id, stage, status, count(*)::int as n " +
    "from public.app_projects where record_kind = 'development' " +
    `and zip >= '${lo}' and zip < '${hi}' group by 1, 2, 3`;
}

async function readOnly(sql) {
  const ref = process.env.SUPABASE_PROJECT_REF || '';
  const token = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!/^[a-z]{20}$/.test(ref)) throw new Error('SUPABASE_PROJECT_REF is not a 20-letter project ref');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is empty');
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json',
          'User-Agent': 'HomeSignal-lifecycle-before-after/1.0 (+https://homesignal.net)' },
        body: JSON.stringify({ query: sql }),
        signal: AbortSignal.timeout(150000),
      });
      const text = await r.text();
      if (r.ok) {
        const rows = JSON.parse(text);
        if (!Array.isArray(rows)) throw new Error('answer is not an array');
        return rows;
      }
      last = `HTTP ${r.status}: ${text.slice(0, 300)}`;
    } catch (e) { last = e.name + ': ' + e.message; }
    await new Promise((res) => setTimeout(res, 5000 * attempt));
  }
  throw new Error('read failed after 3 attempts: ' + last);
}

async function collect(outPath) {
  const started = new Date().toISOString();
  const slices = [];
  for (const [lo, hi] of prefixBounds()) {
    const t0 = Date.now();
    const rows = await readOnly(sliceSql(lo, hi));
    const n = rows.reduce((s, r) => s + Number(r.n || 0), 0);
    slices.push({ lo, hi, rows: rows.map((r) => [r.registry_id, r.stage, r.status, Number(r.n)]) });
    console.log(`slice ${lo}: ${rows.length} groups, ${n} placements, ${Date.now() - t0} ms`);
    await new Promise((res) => setTimeout(res, 1000));
  }
  const ctl = await readOnly('select count(*)::int as zip_pages from public.canonical_zip_registry');
  const out = { kind: 'lifecycle-before-after-counts', started, finished: new Date().toISOString(),
    unit: 'zip_page_placement', zip_pages_registry: Number(ctl[0].zip_pages), slices };
  writeFileSync(outPath, JSON.stringify(out));
  const total = slices.reduce((s, x) => s + x.rows.reduce((a, r) => a + r[3], 0), 0);
  console.log(`wrote ${outPath}: ${total} placements, control zip_pages_registry=${out.zip_pages_registry}`);
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function loadHS() {
  const win = { HS: {} };
  new Function('window', 'document', readFileSync(join(root, 'lib/project-type.js'), 'utf8'))(win, undefined);
  if (!win.HS.canonicalLifecycle) throw new Error('lib/project-type.js did not define HS.canonicalLifecycle');
  return win.HS;
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

// The after-column is the audit's when it names one of the four; anything else depends on the record.
export function afterColumn(auditRow) {
  if (!auditRow) return 'unmatched';
  const c = auditRow.proposed_column;
  return COLUMNS.includes(c) ? c : 'per_record';
}

// Activity group for the founder's reconciliation: total = active + preliminary + paused + undetermined + inactive
// (+ per_record + unmatched, which are not yet decided).
export function activityGroup(auditRow, HS) {
  if (!auditRow) return 'unmatched';
  if (auditRow.needs === 'per_record') return 'per_record';
  const a = auditRow.proposed_activity;
  if (a === 'active') return /^preliminary_/.test(auditRow.proposed_stage) ? 'preliminary' : 'active';
  if (a === 'paused' || a === 'inactive' || a === 'undetermined') return a;
  return 'per_record';
}

function registryStates() {
  const reg = JSON.parse(readFileSync(join(root, REGISTRY), 'utf8'));
  const m = new Map();
  for (const p of ['socrata', 'arcgis', 'ckan', 'csv', 'carto']) for (const e of reg[p] || []) {
    const st = [...new Set((e.coverage || []).map((c) => c && c.state).filter(Boolean))].sort();
    m.set(e.registry_id, st.length === 1 ? st[0] : st.length ? 'multi-state' : 'none declared');
  }
  return m;
}

export function buildReport(counts) {
  if (!counts || counts.kind !== 'lifecycle-before-after-counts') throw new Error('not a counts file');
  if (!Array.isArray(counts.slices) || counts.slices.length !== 100) throw new Error('counts file does not carry all 100 slices');
  const HS = loadHS();
  const auditText = readFileSync(join(root, AUDIT_CSV), 'utf8');
  const audit = parseCsv(auditText);
  const byPair = new Map();
  for (const r of audit) byPair.set(r.registry_id + '\u0000' + norm(r.status), r);
  const states = registryStates();

  // Merge slices into (registry, stage, status) groups.
  const groups = new Map();
  let total = 0;
  for (const s of counts.slices) for (const [reg, stage, status, n] of s.rows) {
    const k = [reg, stage, status].join('\u0000');
    groups.set(k, (groups.get(k) || 0) + n);
    total += n;
  }

  const inc = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
  const matrix = new Map(), byActivity = new Map(), byClass = new Map(), byState = new Map(), bySource = new Map();
  const moved = [], unmatched = [], needsTally = new Map();
  for (const [k, n] of groups) {
    const [reg, stage, status] = k.split('\u0000');
    const a = byPair.get(reg + '\u0000' + norm(stage));
    const before = HS.canonicalLifecycle({ status }).key;
    const after = afterColumn(a);
    const act = activityGroup(a, HS);
    const cls = a ? a.record_class_proposed : '(no audit row)';
    const st = states.get(reg) || 'not in registry';
    inc(matrix, before + '\u0000' + after, n);
    inc(byActivity, act, n);
    inc(needsTally, a ? (a.needs || '(none)') : 'unmatched', n);
    const kc = byClass.get(cls) || { total: 0, moved: 0 }; kc.total += n; if (before !== after) kc.moved += n; byClass.set(cls, kc);
    const ks = byState.get(st) || { total: 0, moved: 0 }; ks.total += n; if (before !== after) ks.moved += n; byState.set(st, ks);
    const kr = bySource.get(reg) || { total: 0, moved: 0, state: st }; kr.total += n; if (before !== after) kr.moved += n; bySource.set(reg, kr);
    if (!a) unmatched.push({ reg, stage, status, n });
    if (before !== after) moved.push({ reg, stage, status, before, after, activity: act, needs: a ? a.needs : 'unmatched', rule: a ? a.rule : '', n });
  }
  const activitySum = [...byActivity.values()].reduce((s, v) => s + v, 0);
  if (activitySum !== total) throw new Error(`activity reconciliation failed: ${activitySum} != ${total}`);
  const matrixSum = [...matrix.values()].reduce((s, v) => s + v, 0);
  if (matrixSum !== total) throw new Error(`column reconciliation failed: ${matrixSum} != ${total}`);

  const auditFp = createHash('md5').update(auditText).digest('hex');
  const sorted = (m) => [...m.entries()].sort((x, y) => (y[1].total ?? y[1]) - (x[1].total ?? x[1]) || (x[0] < y[0] ? -1 : 1));
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
  const fmt = (n) => n.toLocaleString('en-US');
  moved.sort((x, y) => y.n - x.n || (x.reg + x.stage < y.reg + y.stage ? -1 : 1));
  unmatched.sort((x, y) => y.n - x.n || (x.reg + x.stage < y.reg + y.stage ? -1 : 1));
  const movedTotal = moved.reduce((s, m) => s + m.n, 0);

  const L = [];
  L.push('# Before/after record counts (release gate item 2)', '');
  L.push('Generated by `scripts/lifecycle-before-after.mjs report` from production counts collected by');
  L.push('`lifecycle-before-after.yml` (read-only endpoint) and the generated audit `mapping.csv`. **Nothing is enabled:');
  L.push('this measures what the proposed mapping WOULD do. No record, column or registry value has changed.**', '');
  L.push('## Read this first', '');
  L.push('- **Unit: ZIP-page placements**, one per ZIP page a record is shown on (`public.app_projects` rows,');
  L.push('  `record_kind = development`). A record shown on four ZIP pages counts four times. This is what residents see,');
  L.push('  not the number of distinct government records.');
  L.push('- **"After" is the audit\'s PROPOSAL.** Every value marked `receipt`, `review` or `per_record` is still undecided');
  L.push('  and needs the founder\'s or an agency\'s answer before it is used. Until then those values show here as');
  L.push('  they would land with no receipt: Lifecycle unknown / undetermined, or "per record".');
  L.push('- **"per_record"** after-column = the column depends on the individual record (D1 pre-application, D3 completed');
  L.push('  work type) or on JODY\'s own observation history for an inactive record (§4.4). Not yet counted into a column.');
  L.push('- **"unmatched"** = a stored status that the audit has no row for (see the last section).', '');
  L.push('## Integrity', '');
  L.push(`- Collected ${counts.started} → ${counts.finished}; 100 of 100 ZIP-prefix slices read.`);
  L.push(`- Control: ${fmt(counts.zip_pages_registry)} ZIP pages in \`canonical_zip_registry\`.`);
  L.push(`- Placements counted: ${fmt(total)} across ${fmt(groups.size)} (source, stored status) groups.`);
  L.push(`- Reconciles exactly: before×after matrix sums to ${fmt(matrixSum)}; activity groups sum to ${fmt(activitySum)}.`);
  L.push(`- Audit used: \`${AUDIT_CSV}\`, md5 \`${auditFp}\` (the file, byte for byte).`);
  L.push(`- Placements whose column would change: ${fmt(movedTotal)} (${pct(movedTotal, total)}).`, '');
  L.push('## Before column → after column', '');
  L.push('| before (today) | after (proposed) | placements | share |', '|---|---|---:|---:|');
  for (const [k, n] of [...matrix.entries()].sort((x, y) => y[1] - x[1])) {
    const [b, a] = k.split('\u0000');
    L.push(`| ${b} | ${a} | ${fmt(n)} | ${pct(n, total)} |`);
  }
  L.push('', '## Activity (total = active + preliminary + paused + undetermined + inactive + per_record + unmatched)', '');
  L.push('| activity | placements | share |', '|---|---:|---:|');
  for (const k of ['active', 'preliminary', 'paused', 'undetermined', 'inactive', 'per_record', 'unmatched']) {
    L.push(`| ${k} | ${fmt(byActivity.get(k) || 0)} | ${pct(byActivity.get(k) || 0, total)} |`);
  }
  L.push(`| **total** | **${fmt(activitySum)}** | |`);
  L.push('', '## What the after-column still waits on', '');
  L.push('| needs | placements | share |', '|---|---:|---:|');
  for (const [k, n] of [...needsTally.entries()].sort((x, y) => y[1] - x[1])) L.push(`| ${k} | ${fmt(n)} | ${pct(n, total)} |`);
  L.push('', '## By record class (proposed)', '');
  L.push('| class | placements | would move | share moving |', '|---|---:|---:|---:|');
  for (const [k, v] of sorted(byClass)) L.push(`| ${k} | ${fmt(v.total)} | ${fmt(v.moved)} | ${pct(v.moved, v.total)} |`);
  L.push('', '## By state (from each source\'s declared coverage)', '');
  L.push('| state | placements | would move | share moving |', '|---|---:|---:|---:|');
  for (const [k, v] of sorted(byState)) L.push(`| ${k} | ${fmt(v.total)} | ${fmt(v.moved)} | ${pct(v.moved, v.total)} |`);
  L.push('', '## By source (top 60 by placements; every source is in before-after.csv)', '');
  L.push('| source | state | placements | would move | share moving |', '|---|---|---:|---:|---:|');
  for (const [k, v] of sorted(bySource).slice(0, 60)) L.push(`| ${k} | ${v.state} | ${fmt(v.total)} | ${fmt(v.moved)} | ${pct(v.moved, v.total)} |`);
  L.push('', '## Largest moves (top 60; the full list is before-after.csv)', '');
  L.push('| source | stored status | before → after | activity | needs | placements |', '|---|---|---|---|---|---:|');
  for (const m of moved.slice(0, 60)) L.push(`| ${m.reg} | ${m.stage.replace(/\|/g, '/')} | ${m.before} → ${m.after} | ${m.activity} | ${m.needs || '(none)'} | ${fmt(m.n)} |`);
  L.push('', '## Stored statuses with no audit row', '');
  if (!unmatched.length) L.push('None.');
  else {
    L.push(`${unmatched.length} groups, ${fmt(unmatched.reduce((s, u) => s + u.n, 0))} placements. Usually a status the source`);
    L.push('emitted before its registry entry changed, or a source whose status column is a constant. Each needs a look.', '');
    L.push('| source | stored status | stored column value | placements |', '|---|---|---|---:|');
    for (const u of unmatched.slice(0, 60)) L.push(`| ${u.reg} | ${String(u.stage).replace(/\|/g, '/')} | ${u.status} | ${fmt(u.n)} |`);
    if (unmatched.length > 60) L.push(`| … ${unmatched.length - 60} more in before-after.csv | | | |`);
  }
  L.push('');

  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const C = ['registry_id,state,stored_status,stored_column_value,before,after,activity,needs,rule,placements'];
  for (const [k, n] of [...groups.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const [reg, stage, status] = k.split('\u0000');
    const a = byPair.get(reg + '\u0000' + norm(stage));
    C.push([reg, states.get(reg) || 'not in registry', stage, status, HS.canonicalLifecycle({ status }).key, afterColumn(a),
      activityGroup(a, HS), a ? (a.needs || '') : 'unmatched', a ? a.rule : '', n].map(csvCell).join(','));
  }
  return { md: L.join('\n'), csv: C.join('\n') + '\n', total, moved: movedTotal };
}

async function main() {
  const [cmd, file, flag] = process.argv.slice(2);
  if (cmd === 'collect') { if (!file) throw new Error('usage: collect <out.json>'); await collect(file); return; }
  if (cmd === 'report') {
    if (!file) throw new Error('usage: report <counts.json> [--check]');
    const out = buildReport(JSON.parse(readFileSync(file, 'utf8')));
    if (flag === '--check') {
      const same = readFileSync(join(root, OUT_MD), 'utf8') === out.md && readFileSync(join(root, OUT_CSV), 'utf8') === out.csv;
      console.log(same ? 'OK: before/after files are current' : 'STALE: rerun report'); process.exit(same ? 0 : 1);
    }
    writeFileSync(join(root, OUT_MD), out.md); writeFileSync(join(root, OUT_CSV), out.csv);
    console.log(`wrote ${OUT_MD} and ${OUT_CSV}: ${out.total} placements, ${out.moved} would move`);
    return;
  }
  throw new Error('usage: lifecycle-before-after.mjs collect <out.json> | report <counts.json> [--check]');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
