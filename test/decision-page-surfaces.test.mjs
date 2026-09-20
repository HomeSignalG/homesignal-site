// test/decision-page-surfaces.test.mjs
//
// The decision has to reach a RESIDENT, not just the payload. This pins the surfaces on
// homesignalmap.html — the page all 12,722 canonical /community/<zip>/ documents and the
// address view share — plus the community-page and N5 surfaces that read the same rows.
//
// Structural, because these are inline-script surfaces with no module boundary to drive.
// Each assertion names the sentence or the identifier it is protecting, so a rewrite that
// keeps the behaviour can move it deliberately rather than trip over it.
//
// Run: node test/decision-page-surfaces.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const MAP = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
ok(MAP.length > 100000, `homesignalmap.html read (${MAP.length} bytes — control)`);

// ── the notation reaches the two places a record is read ────────────────────────
ok(/function decisionNoteHTML\(/.test(MAP), 'the page has ONE notation renderer, not one per surface');
ok(/function currentStatusHTML\(/.test(MAP), 'and ONE current-status renderer');
{
  const popup = MAP.slice(MAP.indexOf('function popupHTML(s){'), MAP.indexOf('function popupHTML(s){') + 4000);
  ok(/decisionNoteHTML\(/.test(popup), 'the map POPUP renders the decision notation');
  ok(/currentStatusHTML\(/.test(popup), 'and the current-status line');
  // Order matters: a ruling below the environmental block is a ruling nobody reads. The
  // comparison is made inside the RETURN statement, not the whole function — `envHtml` is
  // assigned near the top, so slicing the function body would compare the assignment's
  // position rather than the rendered order, and pass for the wrong reason.
  const ret = popup.slice(popup.indexOf('return "<div class=\'pt\'>'));
  ok(ret.indexOf('decHtml+statusHtml') < ret.indexOf('envHtml'),
    'the notation sits ABOVE the source and environmental blocks — prominent, per the contract',
    ret.slice(0, 300));
}
{
  const list = MAP.slice(MAP.indexOf('function listInto(id, items'), MAP.indexOf('function listInto(id, items') + 4500);
  ok(/decisionNoteHTML\(/.test(list) && /currentStatusHTML\(/.test(list),
    'the RAIL rows render both the notation and the current-status line');
  ok(/showCurrentStatus/.test(list),
    'the current-status line is scoped by an explicit option, not applied blindly to every rail');
}

// ── the counter is the ELIGIBILITY number, the rail is the BROWSING category ────
ok(/counts\.proposed_active/.test(MAP),
  'the Proposed counter reads counts.proposed_active — the active-undecided projection');
ok(/HS\.activeUndecidedCount/.test(MAP),
  'and falls back to the shared predicate locally, so a pre-change cached report still counts honestly');
{
  const i = MAP.indexOf('$("cDev").textContent');
  const stmt = MAP.slice(i, MAP.indexOf(';', MAP.indexOf('propActive', i)) + 1);
  ok(!/counts\.proposed\b(?!_)/.test(stmt),
    'the counter never falls back to counts.proposed — that is the browsing size and would '
    + 'describe a refused application as an active, pending one',
    stmt.slice(0, 200));
}

// ── the mixed browsing category is DISCLOSED, and only when it is mixed ─────────
ok(/HS\.proposedRailNote/.test(MAP), 'the Proposed rail asks whether it holds a decided record');
// The phrase is asserted absent from RENDERED content only. It survives twice in the
// comments that explain why it was removed, and a test that cannot tell a comment from a
// claim would force those explanations to be deleted — losing the record of the change to
// protect against the change.
{
  const rendered = MAP
    .replace(/<!--[\s\S]*?-->/g, '')            // HTML comments
    .replace(/^\s*\/\/.*$/gm, '');              // whole-line JS comments
  ok(!/Hearings and notices you can still weigh in on/.test(rendered),
    'the old blanket "you can still weigh in on" sub-line is gone from rendered content — it '
    + 'was an ACTIVE claim over a category that now legitimately holds decided applications');
  ok(/Hearings and notices you can still weigh in on/.test(MAP),
    'and the comments still record what it used to say (control — this assertion is what '
    + 'proves the one above is reading stripped content, not an empty string)');
}
ok(/id="propSub"/.test(MAP), 'the sub-line is written at render time so it can say what the category means');

// ── colour never carries the decision ───────────────────────────────────────────
{
  const i = MAP.indexOf('function markerTitle(s, mk)');
  const body = MAP.slice(i, MAP.indexOf('\n  }', i));
  ok(/decisionOf\(/.test(body) && /outcome_label/.test(body),
    'the marker TITLE — the hover text and the DOM text — names the outcome in words, '
    + 'so the decision is readable without seeing a pin');
}
{
  const i = MAP.indexOf('function kindLabel(s)');
  const body = MAP.slice(i, MAP.indexOf('\n  // STATUS IS NEVER COMMUNICATED BY COLOUR', i));
  ok(/decisionOf\(/.test(body),
    'the popup subheader appends the outcome — "Proposed / hearing" alone reads as a live stage');
}

// ── the other surfaces that read the same rows ──────────────────────────────────
{
  const n5 = readFileSync(join(root, 'lib/n5-radius.js'), 'utf8');
  ok(/'decided'\) return 'proposed'/.test(n5),
    'the N5 radius map colours a Decided record as Proposed — its browsing category — '
    + 'instead of the grey "lifecycle unknown" it used to fall through to');
}
{
  const cp = readFileSync(join(root, 'lib/community-page.js'), 'utf8');
  ok(/status==='Decided'/.test(cp),
    'the community page keeps Decided records in the Proposed browsing group — they used to '
    + 'fall through BOTH groups and surface only when the page had nothing else at all');
  ok(/browsingStatusLabel/.test(cp), 'and labels them by category, not by the bare word "Decided"');
}
{
  const t = readFileSync(join(root, 'lib/templates.js'), 'utf8');
  ok(/browsingStatusLabel\(p\)/.test(t), 'templates.js owns the one browsing-category label');
  ok(/Proposed · decided/.test(t), 'which reads category first, decision second');
  const i = t.indexOf('browsingStatusLabel(p) {');
  const body = t.slice(i, t.indexOf('\n    },', i));
  ok(!/denied|refused/i.test(body),
    'and NEVER names an outcome: app_projects carries no outcome word, so saying "denied" '
    + 'there would invent the fact this whole unit exists to source');
}
{
  const im = readFileSync(join(root, 'lib/impact.js'), 'utf8');
  ok(/const decided = st === 'decided'/.test(im),
    'impact.js recognises a decided application');
  const i = im.indexOf('if (decided) {');
  const body = im.slice(i, im.indexOf('}', im.indexOf('return fitLength', i)));
  ok(!/if approved|once construction begins|moves ahead/i.test(body),
    'and gives it NO forward-looking sentence — "if approved… once construction begins" about '
    + 'an application a body refused is a future that is not going to happen');
  ok(!/denied|refused/i.test(body), 'while asserting no outcome it cannot source');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll decision page-surface checks passed.');
process.exit(fails ? 1 : 0);
