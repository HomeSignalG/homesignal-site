// MAP 1 — ONE FILTER PATTERN ACROSS ALL THREE ROWS: "checked categories are shown on the map".
//
// Stage shipped the checkbox chip first (#1098) and is the approved reference. Type and
// Regulatory were then converted to it: the Type row lost its "Show types" dropdown and
// the Regulatory row lost its ON/OFF switch, so every filter on the page now answers the
// same question the same way.
//
// WHY OFFLINE. test/map1-type-filter-chips.browser.test.mjs and
// test/map1-regulatory-toggle.browser.test.mjs drive the real page and prove the
// BEHAVIOUR, but the browser job is reported-not-required. This runs on every PR, so the
// contract a regression would otherwise merge past is pinned here.
//
// It deliberately asserts the SHARED STYLING as shared SELECTORS rather than as duplicated
// declarations: the three rows are styled by one set of rules, so "they match" is a fact
// about the stylesheet rather than a promise someone has to keep in sync by hand.
//
// Run: node test/map1-filter-chip-parity.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const mapjs = readFileSync(join(root, 'lib/map.js'), 'utf8');
const failures = [];
const need = (cond, msg) => { if (!cond) failures.push(msg); };

// ── 1. THE TWO REPLACED CONTROLS ARE GONE, NOT HIDDEN BESIDE THEIR REPLACEMENTS ──────
// Two controls over one piece of state is the defect this change removes; leaving either
// in place would recreate it and give the two a way to disagree.
need(!/typeFilterBtn|typeFilterMenu|typeFilterCount|tfmenu|tfbtn|tfwrap|tfrow/.test(src),
  'the "Show types" dropdown still has markup, styling or wiring in the page');
// Scoped to RENDERED text on purpose: the comments that record why the dropdown was
// removed legitimately name it, and a bare substring search cannot tell those apart from
// a button label. What must never come back is the string as element content.
need(!/>Show types/.test(src) && !/textContent\s*=\s*["']Show types/.test(src),
  'the "Show types" control label is rendered again');
need(!/\bregtog\b/.test(src), 'the regulatory ON/OFF switch styling (.regtog) is still present');
need(!/role["']?\s*,\s*["']switch|role=["']switch/.test(src),
  'something is still exposed as role="switch" — the regulatory control is a checkbox now');

// ── 2. ALL THREE ROWS ARE CHECKBOX CHIPS, BUILT THE SAME WAY ─────────────────────────
const legend = (src.match(/function buildLegend\(\)\{[\s\S]*?\n  \}/) || [''])[0];
const regRow = (src.match(/function buildRegulatoryRow\(\)\{[\s\S]*?\n  \}/) || [''])[0];
need(/className = "typechip"/.test(legend), 'the Type row does not build a .typechip');
need(/className = "regchip"/.test(regRow), 'the Regulatory row does not build a .regchip');
[['Type', legend], ['Regulatory', regRow]].forEach(([name, body]) => {
  need(/createElement\("label"\)/.test(body), name + ' chip is not a <label> wrapping its control');
  need(/type = "checkbox"/.test(body), name + ' chip is not a native <input type=checkbox>');
  need(/addEventListener\("change"/.test(body), name + ' chip listens on something other than `change`');
  need(!/aria-pressed/.test(body), name + ' chip is back on aria-pressed — that is a toggle BUTTON');
});

// ── 3. ONE STYLING CONTRACT, SHARED BY SELECTOR ──────────────────────────────────────
// Each rule that styles the approved Stage chip must also name the other two rows, so the
// three cannot drift apart without someone deleting a selector on purpose.
const shared = [
  ['the chip pill', /#mapkeyShapes \.typechip, #mapkeyReg \.regchip, #mapkey \.stagechip\{/],
  ['the inner reset', /#mapkeyShapes \.typechip>span, #mapkeyReg \.regchip>span, #mapkey \.stagechip>span\{/],
  ['hover', /#mapkeyShapes \.typechip:hover, #mapkeyReg \.regchip:hover, #mapkey \.stagechip:hover\{/],
  ['the focus ring', /#mapkeyShapes \.typechip:focus-within, #mapkeyReg \.regchip:focus-within, #mapkey \.stagechip:focus-within\{/],
  ['the hidden input', /#mapkeyShapes \.chipbox, #mapkeyReg \.chipbox, #mapkey \.stagebox\{/],
  ['the tick box', /#mapkeyShapes \.typechip \.ck, #mapkeyReg \.regchip \.ck, #mapkey \.stagechip \.ck\{/],
  ['the checkmark glyph', /#mapkeyShapes \.typechip \.ck::after, #mapkeyReg \.regchip \.ck::after, #mapkey \.stagechip \.ck::after\{content:"\\2713"/],
  ['the checked fill', /#mapkeyShapes \.chipbox:checked~\.ck, #mapkeyReg \.chipbox:checked~\.ck, #mapkey \.stagebox:checked~\.ck\{/],
  ['the selected chip', /#mapkeyShapes \.typechip\.on, #mapkeyReg \.regchip\.on, #mapkey \.stagechip\.on\{/],
  ['the label colour', /#mapkeyShapes \.typechip \.t, #mapkeyReg \.regchip \.t, #mapkey \.stagechip \.t\{color:var\(--ink\)\}/]
];
shared.forEach(([what, re]) => {
  need(re.test(src), 'the three rows no longer share one rule for ' + what
    + ' — Type/Regulatory would drift from the approved Stage chip');
});
need(/@media \(pointer:coarse\)\{[\s\S]{0,400}?#mapkeyShapes \.typechip, #mapkeyReg \.regchip\{min-height:44px/.test(src),
  'the Type and Regulatory chips have no 44px touch target on coarse pointers');

// ── 4. THE TWO REJECTED "UNSELECTED" TREATMENTS, NAMED SO NEITHER RETURNS ────────────
need(!/#mapkeyShapes \.typechip[^{]*\{[^}]*text-decoration:line-through/.test(src),
  'the unselected Type chip is struck through — it reads as deleted, not unselected');
need(!/#mapkeyShapes \.typechip\{[^}]*opacity:\s*0?\.[0-8]/.test(src),
  'the unselected Type chip is dimmed to look disabled');
need(/#mapkeyShapes \.typechip \.ic, #mapkeyReg \.regchip \.ic\{opacity:1\}/.test(src),
  'the pin-shape icon and the purple R are not pinned to full strength in both states');

// ── 5. THE GOVERNING SENTENCE, ONCE PER GROUP, PROGRAMMATICALLY ATTACHED ─────────────
[['stage', 'mapkeyStageHelp', 'Checked statuses are shown on the map.'],
 ['type', 'mapkeyTypeHelp', 'Checked types are shown on the map.'],
 ['regulatory', 'mapkeyRegRule', 'Checked records are shown on the map.']].forEach(([row, id, copy]) => {
  need(src.includes('id="' + id + '"') && src.includes(copy),
    'the ' + row + ' row is missing its rule copy "' + copy + '"');
  need(new RegExp('aria-describedby="' + id + '"').test(src),
    'the ' + row + ' rule is not programmatically associated with its group');
});
need(/aria-label="Project type filters"/.test(src), 'the Type group has no screen-reader label');
need(/aria-label="Regulatory record filters"/.test(src), 'the Regulatory group has no screen-reader label');

// ── 6. ZERO SELECTED IS ANSWERED, AND PROMISES NOTHING ──────────────────────────────
need(/id="mapkeyEmpty"/.test(src) && /No project types are selected\./.test(src),
  'there is no empty-state for "zero types selected"');
need(/id="typeSelectAll"/.test(src) && /Select all types\./.test(src),
  'the Type empty-state offers no way back');
need(!/All types are hidden, so the map is empty/.test(src),
  'the old note is still there — it claims map emptiness, which is not what the control reports');

// ── 7. STATE KEYS ON STABLE IDS, NEVER ON LABELS OR ICONS ───────────────────────────
need(/HS\.typeIdForKey/.test(mapjs) && /HS\.typeKeyForId/.test(mapjs),
  'lib/map.js does not expose the stable Type id vocabulary');
["data_center", "industrial", "residential", "roads_infrastructure",
 "commercial", "civic_public", "other_project"].forEach((id) => {
  need(mapjs.includes("'" + id + "'"), 'the stable Type id ' + id + ' is missing from lib/map.js');
});
need(/typeKeyForId/.test(src), 'the page does not resolve ?types= through the stable id map');
need(/searchParams\.set\("types"/.test(src), 'the page never writes ?types= to the URL');
need(/searchParams\.set\("regulatory"/.test(src), 'the page never writes ?regulatory= to the URL');
need(/searchParams\.get\("regulatory"\)/.test(src), 'the page never reads ?regulatory= from the URL');
// The Stage contract must survive untouched beside the two new ones.
need(/searchParams\.set\("stages"/.test(src) && /searchParams\.get\("stages"\)/.test(src),
  'the existing ?stages= contract was disturbed');
need(/addEventListener\("popstate"/.test(src),
  'nothing restores filter state on history navigation');

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('map1 filter-chip parity: one checkbox-chip pattern across Stage, Type and Regulatory; '
  + 'dropdown and switch removed; shared styling by selector; stable ids and URL state for all three.');
