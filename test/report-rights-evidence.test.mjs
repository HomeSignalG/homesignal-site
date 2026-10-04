// EVERY CLEARED SOURCE HAS ITS EVIDENCE — the control behind Development Activity build step 12.
//
// supabase/functions/_shared/report-rights.json says which source families may appear in a paid customer report, and today it says
// none: `"cleared": []`. The edge function validates the SHAPE of an entry (validateRights in _shared/national-report.ts) but a function
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
// defects by name; only then is it run on the real file. This test does NOT clear anything, and it does not edit the structure pin
// (test/national-report-structure.test.mjs 6a) that says the registry is closed: a real clearance edits that pin in the same change.
//
// Run: node test/report-rights-evidence.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

/** Returns a list of problems; empty means every entry is backed by its evidence. ctx: { today, registryIds:Set, exists(path), read(path) } */
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
  const problems = checkClearances(real, { today, registryIds: ids, exists: (p) => existsSync(join(ROOT, p)), read: (p) => readRoot(p) });
  ok(problems.length === 0, '3b every entry in report-rights.json (' + real.cleared.length + ' today) is backed by its evidence record', problems);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
