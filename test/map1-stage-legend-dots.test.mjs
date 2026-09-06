// THE STAGE LEGEND CARRIES COLOUR, AND ONLY COLOUR. Nothing in the "Stage — pin color" row
// may be a marker silhouette, a project-type shape, or a warning glyph.
//
// WHY THIS EXISTS AS A TEST AND NOT A COMMENT. The row shipped with a filled TRIANGLE in each
// chip (PR #331, "shaped lifecycle legend icons"), and that one mark was saying three things at
// once: it is a map-pin silhouette, it is this product's Industrial *type* shape
// (CATEGORY_REGISTRY.industrial.symbol === 'triangle'), and it is the universal warning icon.
// A reader cannot tell which. The product rule the row now enforces:
//
//     colour  = lifecycle stage      (this row)
//     shape   = project type         (the "Type — pin shape" row, below it)
//     outline / halo / size = selected or hovered state
//
// The page's own live verifier (__HS_TRACKER_MARKER_VERIFY) asserts the same two facts in a
// real browser. This is the OFFLINE half, so a regression is caught on every PR rather than
// only on the runs that have Playwright — the shape came back once already.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const failures = [];

// ── 1. The chip is built from a dot, and the dot's only job is to carry the stage colour ──
const legendBody = (src.match(/function buildLegend\(\)\{[\s\S]*?\n  \}/) || [''])[0];
if (!legendBody) {
  failures.push('buildLegend() not found — the rest of this file cannot mean anything');
}
if (!/class='dot'[^"]*style='background:"\s*\+\s*hexColor\(it\.c\)/.test(legendBody)) {
  failures.push('the stage chip does not render a .dot whose background is the row colour');
}
// The rejected mark, named exactly so a future edit cannot reintroduce it by accident.
if (/markerSVG\(/.test(legendBody.split('var shapes = document.getElementById("mapkeyShapes")')[0])) {
  failures.push('the STAGE row is calling HS.markerSVG — that draws a map-marker shape, which '
    + 'belongs to the Type row. Colour is the only stage signal.');
}

// ── 2. The dot is a CIRCLE, at the founder's 10–12px, and solid ──
const dotCss = (src.match(/\.mapkey \.dot\{[^}]*\}/) || [''])[0];
if (!dotCss) failures.push('.mapkey .dot has no style rule');
if (!/border-radius:50%/.test(dotCss)) {
  failures.push('.mapkey .dot is not a circle — a rounded square, chevron or any other geometry '
    + 'reads as a pin or a type shape');
}
const dotSize = Number((dotCss.match(/width:(\d+)px/) || [])[1]);
if (!(dotSize >= 10 && dotSize <= 12)) {
  failures.push(`.mapkey .dot is ${dotSize || '?'}px; the specified size is 10–12px`);
}

// ── 3-5. THE SHARED `.mapkey span` PILL. ⚖️ These three sections used to pin the STAGE
//       chip. The Stage row is now a multi-select CHECKBOX group (§8 below), so `.mapkey
//       span` — and with it aria-pressed and `.off` — is the TYPE row's pill, which lives
//       in the same `.mapkey` container and still needs every rule below. Kept, re-scoped,
//       and NOT deleted: the neutral-pill and readable-when-off rules are what the Type row
//       relies on, and dropping them here would leave that row with no offline guard at all.
//
//       3. The PILL stays neutral. A strongly coloured pill reads as a pressed button or an
//       already-applied filter, which is the confusion this row must not create. ──
const pillCss = (src.match(/\.mapkey span\{[^}]*\}/) || [''])[0];
if (!/background:#fff/.test(pillCss)) {
  failures.push('the legend pill is not on a white/very-light background');
}
if (!/border:1px solid var\(--line\)/.test(pillCss)) failures.push('the legend pill has no subtle border');
if (!/color:var\(--ink\)/.test(pillCss)) {
  failures.push('the legend LABEL is not dark charcoal — the label text must never be tinted with '
    + 'the stage colour; the dot carries the colour');
}

// ── 4. Selection is its own channel: darker outline + a very subtle tint, never the stage hue ──
const selCss = (src.match(/\.mapkey span\[aria-pressed="true"\]\{[^}]*\}/) || [''])[0];
if (!selCss) failures.push('there is no selected-state rule; selection would be indistinguishable');
if (!/border-color:#9aa8a3/.test(selCss)) failures.push('the selected chip has no darker outline');
if (!/background:#f4f6f5/.test(selCss)) failures.push('the selected chip has no subtle tint');

// ── 5. Unselected stays NEUTRAL and stays READABLE. `opacity:.4` on the whole chip put the
//       label under accessible contrast; the strike-through is what carries "hidden" in text. ──
const offCss = (src.match(/\.mapkey span\.off\{[^}]*\}/) || [''])[0];
if (/opacity:\s*\.?[0-4]/.test(offCss)) {
  failures.push('the unselected chip dims its whole self again — that fails contrast on the label. '
    + 'Dim the dot, keep the words readable.');
}
if (!/\.mapkey span\.off \.t\{text-decoration:line-through\}/.test(src)) {
  failures.push('the unselected chip has no strike-through — on/off would be carried by colour alone');
}

// ── 6. STATUS IS NEVER COLOUR ALONE ON THE MAP EITHER. Every marker carries its own words. ──
if (!/function markerTitle\(s, mk\)\{/.test(src)) {
  failures.push('markerTitle() is gone — markers would communicate stage by colour alone');
}
if (!/title="' \+ escAttr\(title\)/.test(src)) failures.push('the 2D marker carries no title attribute');
// THE TITLE BELONGS INSIDE siteIcon(), NOT AT THE CREATION CALL. The regulatory switch
// repaints every badged marker through syncRegulatoryBadges() -> setIcon(siteIcon(...)),
// so a title applied only where the marker is first built is silently dropped the moment
// a resident toggles that switch — and a missing tooltip looks like nothing at all.
// Both halves are asserted: the builder takes the title, and the repaint path passes one.
if (!/function siteIcon\(mk, size, solidPoint, title\)/.test(src)) {
  failures.push('siteIcon() does not take the title — a marker repaint would drop it');
}
if (!/setIcon\(siteIcon\(x\.mk, x\.size, x\.solidPoint, markerTitle\(x\.s, x\.mk\)\)\)/.test(src)) {
  failures.push('the regulatory-badge repaint rebuilds icons without a title, so toggling the '
    + 'regulatory switch would strip every marker of its stage text');
}
if (!/el\.setAttribute\("title", title\)/.test(src)) failures.push('the satellite marker carries no title');
// The words must come from the same two facts the mark is drawn from, or the sentence and the
// symbol can disagree — the exact class of bug kindLabel() was named to prevent.
if (!/MARKER_TITLE_STAGE\[stageOf\(s\)\]/.test(src)) {
  failures.push('the marker title does not read the record\'s own lifecycle bucket');
}
if (!/mk\.legendLabel/.test(src)) {
  failures.push('the marker title does not read the resolver\'s category label, so the words could '
    + 'name a different type than the shape drawn');
}

// ── 8. THE STAGE ROW IS A MULTI-SELECT CHECKBOX GROUP ────────────────────────────────
// The offline half of test/map1-stage-filter-chips.browser.test.mjs. That suite drives the
// real page and proves the BEHAVIOUR; this one runs on every PR (the browser job is reported,
// not required), so the contract that a regression would silently merge past is pinned here.
//
// The row used to be four role="button" chips carrying aria-pressed, an `.off` class, a
// strike-through label and a dimmed dot — a control that read as "deleted / disabled" rather
// than "not selected", with checkbox behaviour re-implemented in ARIA. Each assertion below
// names the specific way back to that.
const chipBody = (src.match(/function buildLegend\(\)\{[\s\S]*?var shapes = document\.getElementById\("mapkeyShapes"\)/) || [''])[0];
if (!/type = "checkbox"/.test(chipBody)) {
  failures.push('the Stage chip is not a native <input type=checkbox> — Tab, Space and screen-reader '
    + 'checkbox semantics would have to be re-implemented in ARIA, which is what this row moved away from');
}
if (!/createElement\("label"\)/.test(chipBody)) {
  failures.push('the Stage chip is not a <label> wrapping its control, so the WHOLE chip is not a hit target');
}
if (/aria-pressed/.test(chipBody)) {
  failures.push('the Stage chip is back on aria-pressed — that is a toggle BUTTON, not a member of a '
    + 'multi-select filter, and it re-states a state the checkbox already owns');
}
// The state must be readable in WORDS, never carried by the tick or the tint alone.
if (!/status, " \+ \(on \? "shown on map" : "hidden from map"\)/.test(src)) {
  failures.push('the Stage chip\'s accessible name no longer says whether the stage is shown or hidden');
}
// Inclusion is a SHAPE plus a GLYPH. \2713 is the check mark; a rule that only changes a
// colour would put the state back on hue alone.
if (!/#mapkey \.stagechip \.ck::after\{content:"\\2713"/.test(src)) {
  failures.push('the Stage chip has no check-mark glyph — selection would rest on colour alone');
}
const chipCss = (src.match(/#mapkey \.stagechip\{[^}]*\}/) || [''])[0];
if (!/background:#fff/.test(chipCss) || !/color:var\(--ink\)/.test(chipCss)) {
  failures.push('the Stage chip is not a neutral pill with a dark charcoal label — the dot carries the colour');
}
// The two rejected "unselected" treatments, named exactly so neither returns by accident.
if (/#mapkey[^{]*\.stagechip[^{]*\{[^}]*text-decoration:line-through/.test(src)) {
  failures.push('the unselected Stage chip is struck through again — it reads as deleted, not as unselected');
}
if (/#mapkey \.stagechip\{[^}]*opacity:\s*0?\.[0-8]/.test(src)) {
  failures.push('the unselected Stage chip is dimmed to look disabled');
}
if (!/@media \(pointer:coarse\)\{\s*#mapkey \.stagechip\{min-height:44px/.test(src)) {
  failures.push('the Stage chip has no 44px touch target on coarse pointers');
}
// Zero selected is a legal state, so it must have somewhere to be said and a way out.
if (!/id="mapkeyStageEmpty"/.test(src) || !/No project statuses are selected\./.test(src)) {
  failures.push('there is no empty-state for "zero statuses selected"');
}
if (!/id="stageSelectAll"/.test(src) || !/Select all statuses\./.test(src)) {
  failures.push('the empty-state offers no way back — a resident could be stranded on a blank map');
}
if (!/Checked statuses are shown on the map\./.test(src) || !/aria-describedby="mapkeyStageHelp"/.test(src)) {
  failures.push('the governing rule is missing or is not programmatically associated with the group');
}
// The filter's boundary vocabulary. A label and a hue are presentation and have both moved
// once already; the id is the part a redesign may not move.
if (!/HS\.stageKeyForId/.test(src) || !/HS\.stageIdForKey/.test(src)) {
  failures.push('the Stage filter is not keying on stable status IDs (lib/map.js stageIdForKey/stageKeyForId)');
}

// ── 7. The caption still states the rule, because the rule is the thing being taught ──
if (!/Pin shape shows project type; color shows lifecycle stage/.test(src)) {
  failures.push('the legend caption no longer states shape=type / colour=stage');
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('map1 stage legend: solid colour dots (no marker shapes), a neutral checkbox chip '
  + 'that is never struck through or dimmed, state in words as well as a tick, zero-selected '
  + 'answered, stable status IDs, and every marker carrying stage text of its own.');
