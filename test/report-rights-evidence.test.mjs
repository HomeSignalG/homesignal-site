// EVERY CLEARED SOURCE HAS ITS EVIDENCE — the control behind Development Activity build step 12.
//
// supabase/functions/_shared/report-rights.json says which source families may appear in a paid customer report. (Until 2026-10-04 it
// said none; founder ruling R7 now lists every registry source, so the entries below are judged by the ruling branch, not the publisher
// branch.) The edge function validates the SHAPE of an entry (validateRights in _shared/national-report.ts) but a function
// cannot read docs/, so nothing there can tell a clearance that rests on a publisher's written answer from one somebody typed in. The
// registry's own rule is "Adding an entry is a recorded decision, never a default"; this test is what makes that checkable.
//
// For each entry it requires: a registry_id that is a real source in get-address-report/jurisdiction-registry.json (so a typo cannot
// clear nothing, and no pattern can clear everything); a real, not-future clearance date; an audit_ref of the form
// `docs/<file>.md §N` that points at a real section of a real file, which is neither the blank template nor a drafted request; and in
// that section, naming the source, every line of docs/source-clearance-evidence-template.md filled in (who answered, when and how, the
// publisher's own words as a quotation, what it covers, the attribution, the reconciliation with the publisher's posted terms), with the
// registry's attribution equal to the one the publisher required.
//
// WHY THE EMPTY CASE IS NOT A VACUOUS PASS: with `"cleared": []` there is nothing to check, which is indistinguishable from a checker
// that checks nothing. So the checker is first run on synthetic registries and must ACCEPT one good entry and REJECT each of fourteen
// defects by name; only then is it run on the real file. This test clears nothing. TWO kinds of evidence are accepted, and they are held to
// different standards on purpose: a PUBLISHER's written answer (the template: who answered, their words, what they cover), and the founder's
// own RULING R7 (a risk the founder accepted; it must say so, quote the founder, name every source it covers, and never pass itself off as a
// publisher's grant). An entry that points at the ruling is never excused the ruling's standard, and one that points anywhere else is never
// excused the publisher's.
//
// Run: node test/report-rights-evidence.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLISHER_ATTRIBUTION, RULING_PATH, RULING_SECTION, CLEARED_ON } from '../scripts/build-report-rights.mjs';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + (typeof d === 'string' ? d : JSON.stringify(d)) + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const readRoot = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');

const TEMPLATE_PATH = 'docs/source-clearance-evidence-template.md';
const DRAFT_PATHS = ['docs/corporate-output-utah-clearance-2026-10-02.md', 'docs/utah-source-requests-send-ready-2026-10-04.md'];
// the labels every evidence record fills in, in the template's own words
const LABELS = ['Source (registry_id):', 'Answered by:', 'Date and channel:', 'Verbatim grant:', 'Covers:', 'Attribution:', 'Reconciliation:'];

const validDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/** The text of section N of a markdown file: from its `## N…` / `## §N…` heading to the next heading of the same or a higher level. */
function section(md, num) {
  const lines = md.split('\n');
  const re = new RegExp('^(#{2,3})\\s+§?' + num + '(?![0-9])');
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) { const m = re.exec(lines[i]); if (m) { start = i; level = m[1].length; break; } }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const m = /^(#{1,6})\s/.exec(lines[i]); if (m && m[1].length <= level) { end = i; break; } }
  return lines.slice(start, end).join('\n');
}
/** The value of a `**Label:** value` line (continued onto following non-blank, non-label lines), or null. */
function labelled(sec, label) {
  const lines = sec.split('\n');
  const key = '**' + label + '**';
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(key)) continue;
    let v = lines[i].slice(key.length).trim();
    for (let j = i + 1; j < lines.length && lines[j].trim() !== '' && !lines[j].startsWith('**') && !lines[j].startsWith('#'); j++) v += ' ' + lines[j].trim();
    return v;
  }
  return null;
}
const placeholder = (v) => /<[^<>\n]{1,80}>/.test(v);

/**
 * An entry that rests on the founder's ruling (R7), not on a publisher's answer. It is held to ITS standard: the ruling file exists and carries the
 * founder's words as a quotation; the section the entry points at names this source; the file says in plain words that this is a risk the founder
 * accepted and not a publisher's grant; the date is the ruling's; and the credit line is exactly the one recorded for a publisher that requires one
 * (for those, that publisher's own evidence file must say CLEARED WITH ATTRIBUTION and name the dataset), or empty.
 */
function ruledEntryProblems(e, id, num, ctx) {
  const R = ctx.ruling, who = '[' + id + '] ', out = [];
  if (num !== String(R.section)) out.push(who + 'a ruling entry must point at section ' + R.section + ' of the ruling');
  const md = ctx.exists(R.path) ? ctx.read(R.path) : null;
  if (md === null) return [...out, who + 'the ruling file does not exist (' + R.path + ')'];
  if (!md.split('\n').some((l) => /^>\s/.test(l) && l.includes(R.quote))) out.push(who + 'the ruling does not quote the founder\'s decision');
  const sec = section(md, num);
  if (sec === null) out.push(who + 'the ruling has no section ' + num);
  else if (!sec.includes('`' + id + '`')) out.push(who + 'the ruling section does not name this source');
  if (!/accepting a risk/.test(md) || !/not a publisher'?s? grant/i.test(md) || !/does not\s+reinterpret any HOLD as cleared/.test(md)) {
    out.push(who + 'the ruling does not say, in plain words, that this is a risk the founder accepted, not a publisher\'s grant, and that no HOLD is reinterpreted');
  }
  if (e.cleared_on !== R.date) out.push(who + 'cleared_on is not the ruling\'s date (' + R.date + ')');
  const want = R.attribution[id];
  if (want) {
    if (e.attribution !== want.text) out.push(who + 'the credit line is not the one the publisher requires');
    const ev = ctx.exists(want.evidence) ? ctx.read(want.evidence) : null;
    if (ev === null) out.push(who + 'the publisher\'s evidence file does not exist (' + want.evidence + ')');
    else if (!ev.includes(want.dataset) || !/CLEARED WITH ATTRIBUTION/.test(ev)) out.push(who + 'the publisher\'s evidence file does not show CLEARED WITH ATTRIBUTION for this dataset');
  } else if (e.attribution !== '') out.push(who + 'a credit line is carried that no publisher is recorded as requiring');
  return out;
}

/** Returns a list of problems; empty means every entry is backed by its evidence. ctx: { today, registryIds:Set, exists(path), read(path), ruling?:{ path, section, date, quote, attribution } } */
export function checkClearances(reg, ctx) {
  const problems = [];
  if (!reg || !Array.isArray(reg.cleared)) return ['the registry has no cleared[] array'];
  for (const e of reg.cleared) {
    const id = e && e.registry_id;
    const who = '[' + id + '] ';
    if (typeof id !== 'string' || !id) { problems.push('an entry has no registry_id'); continue; }
    if (/[*?%]/.test(id)) problems.push(who + 'the registry_id is a pattern');
    if (!ctx.registryIds.has(id)) problems.push(who + 'the registry_id is not a source in the jurisdiction registry');
    if (!validDay(e.cleared_on)) problems.push(who + 'cleared_on is not a real YYYY-MM-DD day');
    else if (e.cleared_on > ctx.today) problems.push(who + 'cleared_on is in the future');
    const m = /^(docs\/[A-Za-z0-9._\-\/]+\.md) §(\d+)$/.exec(String(e.audit_ref || ''));
    if (!m) { problems.push(who + 'audit_ref is not of the form "docs/<file>.md §N"'); continue; }
    const [, path, num] = m;
    if (ctx.ruling && path === ctx.ruling.path) { problems.push(...ruledEntryProblems(e, id, num, ctx)); continue; }
    if (path === TEMPLATE_PATH) problems.push(who + 'audit_ref points at the blank template');
    if (DRAFT_PATHS.includes(path)) problems.push(who + 'audit_ref points at a drafted request, which clears nothing');
    if (!ctx.exists(path)) { problems.push(who + 'the evidence file does not exist (' + path + ')'); continue; }
    const sec = section(ctx.read(path), num);
    if (sec === null) { problems.push(who + 'the evidence file has no section ' + num); continue; }
    if (!sec.includes(id)) problems.push(who + 'the evidence section does not name this source');
    const vals = {};
    for (const l of LABELS) {
      const v = labelled(sec, l);
      vals[l] = v;
      if (v === null) { problems.push(who + 'the evidence section has no "' + l + '" line'); continue; }
      if (l !== 'Verbatim grant:' && !v.trim()) problems.push(who + '"' + l + '" is empty');
      if (placeholder(v)) problems.push(who + '"' + l + '" still holds a template placeholder');
    }
    const quote = sec.split('\n').filter((x) => /^>\s*\S/.test(x)).map((x) => x.replace(/^>\s*/, '')).join(' ');
    if (quote.length < 20) problems.push(who + 'the verbatim grant is not a quotation of at least 20 characters');
    else if (placeholder(quote)) problems.push(who + 'the verbatim grant still holds a template placeholder');
    const attr = vals['Attribution:'];
    if (attr !== null && attr !== undefined) {
      const none = /^"?none required"?\.?$/i.test(attr.trim());
      const clean = attr.trim().replace(/^[`"“']+|[`"”'.]+$/g, '');
      if (none && e.attribution !== '') problems.push(who + 'the evidence says no attribution is required but the registry carries one');
      if (!none && e.attribution !== clean) problems.push(who + 'the registry attribution is not the one the publisher required');
    }
  }
  return problems;
}

// ---- 1. the checker, proved on synthetic registries before it is trusted on the real one -----------------------------------------------
const GOOD_EVIDENCE = [
  '# A clearance', '',
  '## 1. Evidence record — udot-active-projects', '',
  '**Source (registry_id):** `udot-active-projects`', '',
  '**Answered by:** Pat Example, GIS Manager, Example Department of Transportation', '',
  '**Date and channel:** 2026-11-02, email — kept in the founder\'s mailbox', '',
  '**Verbatim grant:**', '',
  '> The data is published for general reuse, including commercial use, with attribution to the Example DOT.', '',
  '**Covers:** both layers of the All Projects service; storing records in a delivered report; keeping a history; sharing by link, print and PDF; a daily check that emails the customer; no term and no revocation right',
  '',
  '**Attribution:** Source: Example DOT', '',
  '**Reconciliation:** the posted terms say nothing different', '',
  '## 2. Another section', '', 'unrelated',
].join('\n');
const files = { 'docs/source-clearance-example-2026-11-02.md': GOOD_EVIDENCE, [TEMPLATE_PATH]: readRoot(TEMPLATE_PATH), [DRAFT_PATHS[0]]: 'x' };
const ctx = { today: '2026-12-01', registryIds: new Set(['udot-active-projects', 'slc-planning-petitions']), exists: (p) => p in files, read: (p) => files[p] };
const entry = (over = {}) => ({ registry_id: 'udot-active-projects', cleared_on: '2026-11-02', audit_ref: 'docs/source-clearance-example-2026-11-02.md §1', attribution: 'Source: Example DOT', ...over });
const reg = (...es) => ({ version: 1, cleared: es });
const EV = 'docs/source-clearance-example-2026-11-02.md';
// the same context with the evidence file the entries point at replaced by `md`
const withEvidence = (md) => ({ ...ctx, read: (p) => (p === EV ? md : files[p]) });

ok(checkClearances(reg(entry()), ctx).length === 0, '1a a complete, evidenced entry is ACCEPTED (the checker can say yes)', checkClearances(reg(entry()), ctx));
const rejects = [
  ['1b an unknown source id', reg(entry({ registry_id: 'udot-active-projectz' })), ctx, /not a source in the jurisdiction registry/],
  ['1c a pattern as the id', reg(entry({ registry_id: 'udot-*' })), ctx, /is a pattern/],
  ['1d a date that is not a day', reg(entry({ cleared_on: '2026-02-30' })), ctx, /not a real YYYY-MM-DD/],
  ['1e a clearance dated in the future', reg(entry({ cleared_on: '2027-01-01' })), ctx, /in the future/],
  ['1f an audit_ref with no section', reg(entry({ audit_ref: 'docs/source-clearance-example-2026-11-02.md' })), ctx, /not of the form/],
  ['1g an evidence file that does not exist', reg(entry({ audit_ref: 'docs/source-clearance-nobody-2026-11-02.md §1' })), ctx, /does not exist/],
  ['1h a section number the file does not have', reg(entry({ audit_ref: 'docs/source-clearance-example-2026-11-02.md §7' })), ctx, /no section 7/],
  ['1i the blank template as the evidence', reg(entry({ audit_ref: TEMPLATE_PATH + ' §1' })), ctx, /blank template/],
  ['1j a drafted request as the evidence', reg(entry({ audit_ref: DRAFT_PATHS[0] + ' §1' })), ctx, /drafted request/],
  ['1k a section that does not name the source', reg(entry({ registry_id: 'slc-planning-petitions' })), ctx, /does not name this source/],
  ['1l a registry attribution the publisher did not require', reg(entry({ attribution: 'Source: somebody else' })), ctx, /not the one the publisher required/],
  ['1m evidence that says no attribution is needed beside a registry that carries one', reg(entry()), withEvidence(GOOD_EVIDENCE.replace('**Attribution:** Source: Example DOT', '**Attribution:** none required')), /no attribution is required/],
];
for (const [name, r, c, want] of rejects) {
  const p = checkClearances(r, c);
  ok(p.some((x) => want.test(x)), name + ' is REFUSED', p);
}
// evidence-text defects, run through the same checker with a one-line mutation of the good evidence
const mut = (from, to) => { const md = GOOD_EVIDENCE.replace(from, to); return md === GOOD_EVIDENCE ? null : md; };
const textCases = [
  ['1n a left-over template placeholder', mut('Pat Example, GIS Manager, Example Department of Transportation', '<full name>, <role>'), /placeholder/],
  ['1o a missing label', mut('**Reconciliation:** the posted terms say nothing different', ''), /no "Reconciliation:" line/],
  ['1p a summary instead of the publisher\'s words', mut('> The data is published for general reuse, including commercial use, with attribution to the Example DOT.', 'They said yes.'), /verbatim grant is not a quotation/],
  ['1q an empty "Covers"', mut(/\*\*Covers:\*\*[^\n]*/.exec(GOOD_EVIDENCE)[0], '**Covers:**'), /"Covers:" is empty/],
];
for (const [name, md, want] of textCases) {
  ok(md !== null, name + ' (the mutation applied)');
  if (md === null) continue;
  const p = checkClearances(reg(entry()), withEvidence(md));
  ok(p.some((x) => want.test(x)), name + ' is REFUSED', p);
}
ok(checkClearances({ version: 1 }, ctx).length === 1 && checkClearances(reg(), ctx).length === 0, '1r a registry with no cleared[] array is refused; an empty one has nothing to check');

// ---- 1s. the RULING branch, proved on a synthetic ruling the same way: it must accept a good entry and refuse each defect by name -----------------
const RULING_FILE = 'docs/ruling-example-2026-12-01.md', PUB_FILE = 'docs/publisher-example-2026-11-01.md';
const QUOTE = 'just make all 12,722 prodiuce report with records';
const GOOD_RULING = [
  '# A ruling', '',
  '## 1. The ruling', '', '> ' + QUOTE, '',
  'It is the founder **accepting a risk**, not a publisher\'s grant. This does not', 'reinterpret any HOLD as cleared.', '',
  '## 2. Sources covered', '', '- `udot-active-projects`', '- `nyc-dob-permit-issuance` — a publisher credit is required', '',
  '## 3. What this does not do', '', 'Not much.',
].join('\n');
const PUB_EVIDENCE = 'The NYC dataset ipu4-2q9a is **CLEARED WITH ATTRIBUTION**.';
const NYC_LINE = 'NYC DOB, dataset ipu4-2q9a';
const rfiles = { [RULING_FILE]: GOOD_RULING, [PUB_FILE]: PUB_EVIDENCE };
const rctx = {
  today: '2026-12-05', registryIds: new Set(['udot-active-projects', 'nyc-dob-permit-issuance', 'slc-planning-petitions']),
  exists: (p) => p in rfiles, read: (p) => rfiles[p],
  ruling: { path: RULING_FILE, section: 2, date: '2026-12-01', quote: QUOTE, attribution: { 'nyc-dob-permit-issuance': { text: NYC_LINE, evidence: PUB_FILE, dataset: 'ipu4-2q9a' } } },
};
const rentry = (over = {}) => ({ registry_id: 'udot-active-projects', cleared_on: '2026-12-01', audit_ref: RULING_FILE + ' §2', attribution: '', ...over });
const withRuling = (md) => ({ ...rctx, read: (p) => (p === RULING_FILE ? md : rfiles[p]) });
ok(checkClearances(reg(rentry()), rctx).length === 0 && checkClearances(reg(rentry({ registry_id: 'nyc-dob-permit-issuance', attribution: NYC_LINE })), rctx).length === 0,
  '1s a ruling entry, with and without a required credit line, is ACCEPTED (the ruling branch can say yes)', [checkClearances(reg(rentry()), rctx), checkClearances(reg(rentry({ registry_id: 'nyc-dob-permit-issuance', attribution: NYC_LINE })), rctx)]);
const rmut = (from, to) => { const md = GOOD_RULING.replace(from, to); return md === GOOD_RULING ? null : md; };
const rulingCases = [
  ['1t the founder\'s decision is not quoted', reg(rentry()), withRuling(rmut('> ' + QUOTE, 'The founder agreed.')), /does not quote the founder/],
  ['1u the section does not name the source', reg(rentry({ registry_id: 'slc-planning-petitions' })), rctx, /does not name this source/],
  ['1v the date is not the ruling\'s', reg(rentry({ cleared_on: '2026-12-02' })), rctx, /not the ruling's date/],
  ['1w a section other than the ruling\'s', reg(rentry({ audit_ref: RULING_FILE + ' §3' })), rctx, /must point at section 2/],
  ['1x the ruling no longer says it is a risk, not a publisher\'s grant', reg(rentry()), withRuling(rmut('**accepting a risk**, not a publisher\'s grant', 'giving a licence')), /risk the founder accepted/],
  ['1y the ruling no longer says no HOLD is reinterpreted', reg(rentry()), withRuling(rmut('reinterpret any HOLD as cleared', 'clear everything')), /risk the founder accepted/],
  ['1z a publisher\'s required credit line left blank', reg(rentry({ registry_id: 'nyc-dob-permit-issuance', attribution: '' })), rctx, /not the one the publisher requires/],
  ['1za a credit line no publisher is recorded as requiring', reg(rentry({ attribution: 'Source: somebody' })), rctx, /no publisher is recorded as requiring/],
  ['1zb a required credit whose publisher evidence is missing', reg(rentry({ registry_id: 'nyc-dob-permit-issuance', attribution: NYC_LINE })), { ...rctx, exists: (p) => p !== PUB_FILE && p in rfiles }, /evidence file does not exist/],
  ['1zc a required credit whose publisher evidence does not show the grant', reg(rentry({ registry_id: 'nyc-dob-permit-issuance', attribution: NYC_LINE })), { ...rctx, read: (p) => (p === PUB_FILE ? 'HOLD' : rfiles[p]) }, /does not show CLEARED WITH ATTRIBUTION/],
  ['1zd a ruling file that does not exist', reg(rentry()), { ...rctx, exists: (p) => p !== RULING_FILE && p in rfiles }, /does not exist/],
];
for (const [name, r, c, want] of rulingCases) {
  ok(c !== null && !(c instanceof Error), name + ' (the case applied)');
  const p = checkClearances(r, c);
  ok(p.some((x) => want.test(x)), name + ' is REFUSED', p);
}
{
  // the ruling branch is not a loophole: with no ruling configured, an entry pointing at the ruling file gets the PUBLISHER standard, which a ruling cannot meet
  const p = checkClearances(reg(rentry()), { ...rctx, ruling: undefined });
  ok(p.length > 0 && p.some((x) => /no "Source \(registry_id\):" line|"Verbatim grant|verbatim grant/i.test(x)), '1ze without a configured ruling, an entry pointing at it is held to the publisher standard and REFUSED', p);
}

// ---- 2. the template carries every line the checker needs ---------------------------------------------------------------------------------
{
  const t = readRoot(TEMPLATE_PATH);
  ok(t.length > 500, '2a the evidence template exists');
  ok(LABELS.every((l) => t.includes('**' + l + '**')), '2b it has every line the checker requires, in the checker\'s own words', LABELS.filter((l) => !t.includes('**' + l + '**')));
  ok(/silence is not consent/i.test(t) && /drafted request is not a\s+pending one/i.test(t) && /Not a summary/.test(t), '2c it says silence is not consent, that a draft is not a pending request, and that the grant is pasted, not summarised');
  // a blank copy of the template, pointed at, must be refused: the checker cannot be satisfied by copying the file and changing nothing
  const blank = { ...files, 'docs/source-clearance-blank-2026-11-02.md': t };
  const p = checkClearances(reg(entry({ audit_ref: 'docs/source-clearance-blank-2026-11-02.md §1' })), { ...ctx, exists: (x) => x in blank, read: (x) => blank[x] });
  ok(p.some((x) => /placeholder/.test(x)) && p.length >= 3, '2d an unedited copy of the template is refused', p);
}

// ---- 3. the real registry ------------------------------------------------------------------------------------------------------------------------
{
  const real = JSON.parse(readRoot('supabase/functions/_shared/report-rights.json'));
  const jr = JSON.parse(readRoot('supabase/functions/get-address-report/jurisdiction-registry.json'));
  const ids = new Set();
  for (const v of Object.values(jr)) if (Array.isArray(v)) for (const e of v) if (e && typeof e === 'object' && typeof e.registry_id === 'string') ids.add(e.registry_id);
  ok(ids.size > 200 && ['udot-active-projects', 'udot-active-projects-lines', 'slc-planning-petitions', 'provo-planning-applications'].every((i) => ids.has(i)),
    '3a (control) the jurisdiction registry was read: ' + ids.size + ' source ids, including the four Utah sources', ids.size);
  const today = new Date().toISOString().slice(0, 10);
  const ruling = { path: RULING_PATH, section: RULING_SECTION, date: CLEARED_ON, quote: 'just make all 12,722 prodiuce report with records', attribution: PUBLISHER_ATTRIBUTION };
  const problems = checkClearances(real, { today, registryIds: ids, exists: (p) => existsSync(join(ROOT, p)), read: (p) => readRoot(p), ruling });
  ok(real.cleared.length > 0 && problems.length === 0, '3b every entry in report-rights.json (' + real.cleared.length + ' today) is backed by its evidence record: the founder\'s ruling R7 for all of them, plus the publisher\'s own file for each credit line', problems.slice(0, 5));
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
