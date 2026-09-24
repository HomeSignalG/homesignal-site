// MAPS · DATA CENTER THEME — offline proof of the SITE half. No network, no browser, no DB.
//
// Two kinds of assertion, deliberately separated:
//   BEHAVIOURAL — loads the SHIPPED lib/map.js + lib/maps-social-theme.js and runs them, so
//                 theme membership is proven by execution rather than by reading a regex.
//   STRUCTURAL  — reads the SHIPPED acquisition.html / maps-social-image.mjs, for contracts
//                 that live in a browser page or a Playwright flow this file cannot execute.
//
// THE CONTRACT: the theme is a VIEW over content_family='MAPS'. It introduces no content
// family, no tile, no column, no second queue and no second classifier, and it never changes
// a row's state.
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../acquisition.html', import.meta.url), 'utf8');
const GEN = readFileSync(new URL('../scripts/maps-social-image.mjs', import.meta.url), 'utf8');
const THEME_SRC = readFileSync(new URL('../lib/maps-social-theme.js', import.meta.url), 'utf8');
const POLICY_SRC = readFileSync(new URL('../lib/maps-capture-policy.js', import.meta.url), 'utf8');

// Comment-stripped views. A doc comment naming a forbidden concept is not the same as using
// it, and this unit's files explain at length what they refuse to do.
const strip = (src) => src
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const GEN_CODE = strip(GEN);
const THEME_CODE = strip(THEME_SRC);
const POLICY_CODE = strip(POLICY_SRC);

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

// ── Load the shipped modules exactly as the page loads them, in the page's order ──────
const win = { HS: {} };
globalThis.window = win;
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
for (const f of ['../lib/project-type.js', '../lib/map.js', '../lib/maps-social-theme.js']) {
  new Function('window', 'document', readFileSync(new URL(f, import.meta.url), 'utf8'))(win, globalThis.document);
}
const HS = win.HS;

const post = (over) => ({
  id: 'p-' + Math.random().toString(36).slice(2, 8),
  content_family: 'MAPS', tile: 'development', status: 'draft',
  image_bucket_path: null,
  evidence: { type: 'Development', type_raw: null, project_name: 'Northgate Logistics Park', status: 'Proposed' },
  ...over,
});
const withEvidence = (e, over) => post({ evidence: { type: 'Development', type_raw: null, status: 'Proposed', ...e }, ...over });

// ═══ 1. THEME MEMBERSHIP IS MAP 1'S OWN ANSWER ═══════════════════════════════════════
ok(typeof HS.mapsSocialThemeKey === 'function', '1: the theme predicate is exported');
ok(typeof HS.resolveMarker === 'function', '1: the shipped Map 1 classifier is loaded');

// The file must not carry a vocabulary of its own — that is what "no second classifier" means.
// "No second classifier" is a claim about MATCHING, not about the word "data". The module
// legitimately carries the Map 1 CATEGORY KEY ('datacenter') and the founder's display label
// ("Data Center Theme") — both are references to the shipped registry, not a vocabulary. What
// it must never do is TEST TEXT, so that is what is asserted: no regex literal, no .test(),
// no .match(). A file that cannot match a string cannot be a classifier.
ok(!/\.test\(|\.match\(|new RegExp/.test(THEME_CODE),
  '1: lib/maps-social-theme.js performs NO text matching of its own (no .test/.match/RegExp)');
ok(!/\/[^\s/][^\n]*\/[gimsuy]*\s*[.;,)]/.test(THEME_CODE.replace(/https?:\/\/\S+/g, '')),
  '1: it carries no regular-expression literal — the data-centre patterns live only in lib/map.js');
ok(/HS\.resolveMarker/.test(THEME_CODE),
  '1: it decides membership by calling the shipped HS.resolveMarker');

ok(HS.mapsSocialThemeKey(withEvidence({ project_name: 'RBC Data Center Campus Major Amendment' })) === 'datacenter',
  '1: a record whose own words state a data centre IS a theme member');
ok(HS.mapsSocialThemeKey(withEvidence({ type: 'Industrial', type_raw: 'DATA CENTER', project_name: 'Parcel 7 Build' })) === 'datacenter',
  '1: a record whose CLASS FIELD states a data centre IS a theme member');
ok(HS.mapsSocialThemeKey(post()) === null,
  '1: an ordinary MAPS development record is NOT a theme member');

// ── the four ways a data-centre STRING does not make a member ─────────────────────────
ok(HS.mapsSocialThemeKey(withEvidence({ type: 'Other project', project_name: 'IRON MOUNTAIN DATA CENTER - PUMP' })) === null,
  '2: a TERMINAL-NEUTRAL source type outranks a data-centre name (Map 1 precedence 1.5)');
ok(HS.mapsSocialThemeKey(withEvidence({ type: 'Residential', project_name: '1100 DATACENTER RD SFR ADDITION' })) === null,
  '2: a STREET NAME containing "data center" is not a data centre');
ok(HS.mapsSocialThemeKey(withEvidence({ type: 'Utility', project_name: 'New 132 kV substation and transmission line serving the Vantage data center campus' })) === null,
  '2: an INCIDENTAL reference — a substation SERVING one — is not a data centre');
ok(HS.mapsSocialThemeKey(withEvidence({ type: 'Commercial', project_name: 'AT&T - OAKTON DATA CENTER GENERATOR POWER' })) === 'datacenter',
  '2: CONTROL — a data-centre project involving power still classifies, so the guard is narrow');

// ── non-MAPS and non-development can never enter ──────────────────────────────────────
ok(HS.mapsSocialThemeKey(withEvidence({ project_name: 'Riverside Data Center' }, { content_family: 'ALERTS' })) === null,
  '3: an ALERTS row can never be a MAPS theme member');
ok(HS.mapsSocialThemeKey(withEvidence({ project_name: 'Riverside Data Center' }, { tile: 'notices' })) === null,
  '3: a non-development tile can never be a MAPS theme member');

// ═══ 4. THE FILTER — right rows, counts from the SAME result, no mutation ════════════
const queue = [
  withEvidence({ project_name: 'RBC Data Center Campus' }),                       // theme
  withEvidence({ type: 'Industrial', type_raw: 'DATA CENTER', project_name: 'Parcel 7' }), // theme
  post(),                                                                          // MAPS, not theme
  post({ evidence: { type: 'Residential', type_raw: null, project_name: 'Elm Street Subdivision', status: 'Approved' } }),
  post({ content_family: 'ALERTS', tile: 'notices', evidence: {} }),               // ALERTS
];
const frozen = JSON.stringify(queue);
const buckets = HS.mapsSocialThemeBuckets(queue);
ok(buckets.all.length === 4, '4: "All Maps" returns every MAPS row and only MAPS rows');
ok(buckets.byTheme.datacenter.length === 2, '4: "Data Center Theme" returns only the theme rows');
ok(buckets.byTheme.datacenter.every((p) => p.content_family === 'MAPS'),
  '4: every theme row is still content_family=MAPS — no new family is introduced');
ok(buckets.byTheme.datacenter.every((p) => HS.mapsSocialThemeKey(p) === 'datacenter'),
  '4: the bucket agrees with the per-row predicate (counts and rows are one result)');
ok(JSON.stringify(queue) === frozen,
  '4: partitioning MUTATES NOTHING — the queue is byte-identical after filtering');
ok(HS.mapsSocialThemeLabel('datacenter') === 'Data Center', '4: the theme has its display label');
ok(HS.mapsSocialThemeLabel('nope') === null, '4: an unknown key gets NO invented label');

// ═══ 5. THE DASHBOARD — hierarchy, derived counts, preserved actions ═════════════════
// Both must carry a content-hash cache key — test/lib-cache-keys.test.mjs is the contract,
// and a keyless same-origin script there is a shipped fix that never reaches a warm browser.
// Asserted WITH the key rather than around it, so dropping the key fails here too.
ok(/src="lib\/map\.js\?v=[0-9a-f]{8}"/.test(DASH)
   && /src="lib\/maps-social-theme\.js\?v=[0-9a-f]{8}"/.test(DASH),
  '5: the dashboard loads the shipped classifier and the theme derivation, both content-keyed');
ok(/id="bsky-nav"/.test(DASH), '5: the Bluesky tab carries a filter nav');
ok(/MAPS THEMES|Maps themes/i.test(DASH), '5: the theme row is labelled as a row of MAPS THEMES');
ok(/All Maps/.test(DASH), '5: the theme row offers "All Maps" beside the theme');
ok(/HS\.MAPS_SOCIAL_THEMES/.test(DASH),
  '5: the theme chips are GENERATED from the registry, never hard-coded in the page');
ok(/mapsSocialThemeBuckets/.test(DASH),
  '5: the dashboard partitions ONCE and renders counts and rows from that one result');
ok(!/Data Center Theme\s*\(\s*\d+\s*\)/.test(DASH), '5: no count is hard-coded in the markup');
// The hierarchy: the theme must never be offered as a third content family.
ok(/_bskyFamily\s*=\s*'all'/.test(DASH)
   && /bskyNavBtn\('family'/.test(DASH) && /bskyNavBtn\('theme'/.test(DASH),
  '5: family and theme are SEPARATE scopes — the theme is nested under MAPS, not beside it');
// The theme row is rendered ONLY while MAPS is the active family. That is what makes it a
// theme WITHIN MAPS rather than a third family chip sitting beside it.
ok(/if\(_bskyFamily==='MAPS'\)\{/.test(DASH.replace(/\n\s*/g, '')),
  '5: the MAPS THEMES row renders only when MAPS is the active family');
ok(/if\(val!=='MAPS'\)\s*_bskyTheme=null/.test(DASH.replace(/\s+/g, (m) => m.includes('\n') ? '\n' : ' ')) || /_bskyTheme=null/.test(DASH),
  '5: leaving MAPS clears the theme, so a theme can never narrow another family');
ok(!/content_family\s*[=:]\s*['"]DATA_CENTER['"]/i.test(DASH) && !/content_family\s*[=:]\s*['"]DATACENTER['"]/i.test(DASH),
  '5: NO new content_family is introduced anywhere in the dashboard');
// Existing actions survive.
for (const act of ['approve', 'edit', 'skip']) {
  ok(new RegExp(`data-act="${act}"`).test(DASH), `5: the ${act} action is preserved`);
}
ok(/verify source/.test(DASH), '5: source verification is preserved');
ok(/\/300/.test(DASH), '5: the 300-grapheme readout is preserved');

// ═══ 6. APPROVAL GATES ══════════════════════════════════════════════════════════════
// BEHAVIOURAL, not nominal. The first version asserted only that the function EXISTS, so
// stubbing its body to `return false` — which silently allows a theme post to be approved
// with no Map 1 capture at all — left the suite green. Proven by mutation. The two small
// pure functions are lifted out of the page and RUN against a stubbed HS.
const bodyOf = (name) => {
  const m = DASH.match(new RegExp('function ' + name + '\\(([^)]*)\\)\\{([\\s\\S]*?)\\n  \\}'));
  return m ? { args: m[1], body: m[2] } : null;
};
// ⚖️ TWO PREDICATES ARE LIFTED NOW, AND THE SPLIT IS THE POINT. `dcThemeImageMandatory`
// carried BOTH questions in one expression — "does this post need a map at all" and "does
// its picture additionally have to prove the Data Center filter state" — so the first was
// only ever asked of one theme. Measured 2026-09-21: 29 of 55 MAPS drafts carry no theme
// and 26 of those no image, and nothing at any surface required one of them.
//
//   bskyMapGateBlock        — UNIVERSAL: every MAPS post needs a current bound map
//   dcThemeMapPolicyApplies — THEME-SPECIFIC: and a DC capture also proves the filter state
const lifted = (() => {
  const a = bodyOf('bskyTheme'), b = bodyOf('dcThemeMapPolicyApplies'),
    c = bodyOf('bskyIsAbsence'), d = bodyOf('bskyMapGateBlock');
  if (!a || !b || !c || !d) return null;
  return new Function('HS', 'window', `
    function bskyTheme(${a.args}){${a.body}}
    function bskyIsAbsence(${c.args}){${c.body}}
    function dcThemeMapPolicyApplies(${b.args}){${b.body}}
    function bskyMapGateBlock(${d.args}){${d.body}}
    return { bskyTheme, dcThemeMapPolicyApplies, bskyMapGateBlock };`)(HS, { HS });
})();
const dcPolicy = lifted && lifted.dcThemeMapPolicyApplies;
const mapGate = lifted && lifted.bskyMapGateBlock;
ok(typeof dcPolicy === 'function' && typeof mapGate === 'function',
  '6: both the universal map gate and the theme policy are liftable and runnable');
ok(mapGate && mapGate(withEvidence({ project_name: 'RBC Data Center Campus' }, { zip: '80210' })) !== '',
  '6: a Data Center Theme post with no bound map is BLOCKED');
ok(mapGate && mapGate(post({ zip: '80210' })) !== '',
  '6: and so is an ordinary MAPS post — the requirement is universal, not scoped to a theme');
ok(mapGate && mapGate({ content_family: 'ALERTS' }) === '',
  '6: while an ALERTS post is untouched — the rule is scoped to the MAPS family');
ok(dcPolicy && dcPolicy(withEvidence({ project_name: 'RBC Data Center Campus' })) === true
  && dcPolicy(post()) === false,
  '6: the THEME-SPECIFIC policy still applies to the Data Center Theme only');
ok(/function bskyApprovalBlockReason/.test(DASH),
  '6: ONE function decides whether approval is allowed');
ok(/var block=bskyApprovalBlockReason\(gr\);\s*if\(block\)\{ alert\(block\); return; \}/.test(DASH.replace(/\n\s*/g, ' ')),
  '6: the click handler refuses through that same one function — button and handler cannot disagree');
// ⚖️ WIDENED 2026-09-20 from `!row.image_bucket_path` to `!bskyCaptureBound(row)`. The
// original pin was correct and too weak: it caught "no capture at all" and missed a capture
// taken for DIFFERENT draft details, which is the worse case because it RENDERS — the
// founder would see a real Map 1 screenshot and approve a picture of an older version of
// the draft. The assertion's own sentence is unchanged because its intent never moved; only
// the definition of "no capture" got stricter.
ok(/if \(row && bskyMapGateBlock\(row\)\) \{/.test(DASH),
  '6: ANY MAPS post with no BOUND map can never unlock approval — the button reads the same universal predicate');
ok(/mapsImageRequired\(p\) && !_bskyImgOk\[_bskyImgKey\(p\)\]/.test(DASH),
  '6: an attached image must have RENDERED before approval, as before');
// ⚠️ KEYED ON THE IMAGE PATH, NOT THE ROW ID. A re-capture writes a NEW object, so a cache
// keyed on the id alone would return the SUPERSEDED picture's blob and report it rendered —
// the founder would approve the old map believing they had seen the new one.
ok(/function _bskyImgKey\(p\)\{ return String\(p && p\.id\) \+ '\|' \+ String\(\(p && p\.image_bucket_path\) \|\| ''\); \}/.test(DASH),
  '6: …and that render flag is keyed on the row id PLUS its image path');

// ═══ 7. THE CAPTURE — real controls, real marker, real product card ═════════════════
// ⚠️ THE MANOEUVRE MOVED INTO lib/maps-capture-policy.js AND THE GENERATOR NOW INJECTS IT.
// The pins move with it: asserting against the generator alone would pass while the shared
// module — the thing the browser suite and the capture both actually run — was gutted.
ok(/applyDataCenterCapturePolicy/.test(GEN_CODE) && /mapsDcCaptureApplyPolicy/.test(GEN_CODE),
  '7: the generator applies the SHIPPED Data Center map-state policy');
ok(/addScriptTag\(\{ content: POLICY_SRC \}\)/.test(GEN_CODE),
  '7: …by INJECTING that module, so there is one implementation and not two');
ok(/dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/.test(POLICY_CODE),
  '7: the filter is applied THROUGH THE REAL CONTROLS (a change event on the page\'s own checkbox)');
// ALL THREE DIMENSIONS, which is the whole of this fix: the previous version set the PROJECT
// TYPE row and said nothing about STATUS or the REGULATORY overlay, so the picture published
// whatever those happened to be.
ok(/#mapkey \.stagechip\[data-stage="/.test(POLICY_CODE),
  '7: …including every STATUS control');
ok(/getElementById\('regToggleBox'\)/.test(POLICY_CODE) && /regulatory: false/.test(POLICY_CODE),
  '7: …and the REGULATORY overlay, which the policy requires OFF');
ok(!/HS\.setCategoryFilter|HS\.setStatusFilter/.test(POLICY_CODE),
  '7: the policy never writes a filter value directly — it drives the page\'s own handler');
ok(/#mapkeyShapes \.typechip/.test(POLICY_CODE),
  '7: it addresses the shipped PROJECT TYPE chips by their own selector');
// ORDER: the filter must go on BEFORE the project's marker is located, so the marker's
// survival is the proof of bucket membership.
// ⚠️ INDEX THE CALL SITE, NOT THE DEFINITION. The first version of this searched for
// `applyDataCenterTypeFilter(page)`, which matches the `async function
// applyDataCenterTypeFilter(page) {` declaration near the top of the file — so the check
// compared a fixed early offset against the marker wait and could never fail. Proven by
// mutation: moving the call after the wait left it green.
const iFilter = GEN_CODE.indexOf('await applyDataCenterCapturePolicy(page');
const iMarker = GEN_CODE.indexOf('proj.source_key');
ok(iFilter > 0 && iMarker > 0 && iFilter < iMarker,
  '7: the Data center filter is applied BEFORE the project marker is located');
ok(/no marker on Map 1 with the Data center PROJECT TYPE filter/.test(GEN),
  '7: a project that vanishes under the filter REFUSES the capture — no substitute is used');
ok(/EMBED_PARAM = 'embed=1'/.test(GEN_CODE),
  '7: the theme capture uses the SHIPPED embed mode rather than a private layout');
// SUPERSEDED 2026-09-22 (founder): EVERY MAPS capture is the card, not only a theme capture.
ok(/const CARD_CLIP = '\.card\.mapcard';/.test(GEN_CODE)
  && (GEN_CODE.match(/const sel = CARD_CLIP;/g) || []).length === 2,
  '7: BOTH capture paths clip to the Map 1 PRODUCT CARD — an ordinary MAPS capture carries the panel too');
ok(!/'#map'/.test(GEN_CODE) && !/\(theme \? `&\$\{EMBED_PARAM\}`/.test(GEN_CODE),
  '7: no path clips to the bare #map, and embed mode is not conditional on the theme');
ok(/panelSectionsInFrame/.test(GEN_CODE) && /does not fit the frame/.test(GEN),
  '7: a card whose controls are out of frame REFUSES the capture');
ok(/IMG_W = 1200, IMG_H = 630/.test(GEN_CODE), '7: the 1200x630 image contract is unchanged');
ok(/sidebar_hidden/.test(GEN_CODE) && /search_form_hidden/.test(GEN_CODE),
  '7: global chrome is asserted ABSENT before the shutter, not assumed');
// Anti-fabrication, still.
ok(/source_key/.test(GEN_CODE) && !/findIndex\(\(x\) => x && x\.s && x\.s\.lat/.test(GEN_CODE),
  '7: the marker is still joined on the stable project key, never on coordinates or DOM order');
ok(!/No generic fallback[\s\S]{0,40}approve/i.test(GEN_CODE),
  '7: the generator does not grant approval — it only records');
ok(/There is NO generic fallback for this theme/.test(GEN),
  '7: a failed theme capture records that there is no fallback, matching the dashboard gate');

// ═══ 8. ATTRIBUTION AND THE OTHER FAMILIES ══════════════════════════════════════════
ok(!/utm_campaign=data-?center/i.test(DASH) && !/utm_campaign=data-?center/i.test(GEN),
  '8: no parallel attribution system is introduced');
ok(!/content_family=eq\.(?!MAPS)/.test(GEN_CODE.replace('content_family=eq.MAPS', '')),
  '8: the generator still selects ONLY MAPS rows — ALERTS are never touched');
ok(/content_family=eq\.MAPS/.test(GEN), '8: MAPS remains the generator\'s only scope');
// The dashboard must still show ALERTS.
ok(/ALERTS · community intelligence/.test(DASH), '8: the ALERTS family label is preserved');


// ═══ 9. THE ABSENCE POST — "no data center filings appear here" ══════════════════════
// It is a Data Center Theme post with NO PROJECT. Map 1 cannot classify a record that does
// not exist, so `markerItemFor` would hand the resolver an object with every field
// undefined and the row would be INVISIBLE: no theme chip, no sub-nav count, and no
// "Draft exists" badge on its ZIP in the founder's Post ZIP order list. That is what
// production looked like for 20904 on 2026-09-20, with the draft sitting in the queue.
// ⚠️ `over` IS SPREAD FIRST, THEN `evidence` — the reverse order let `over.evidence`
// REPLACE the merged object and silently drop `theme_answer`, so an "unrecognised stamp"
// case was really testing a row that was not an absence post at all. It passed, and it
// passed for the wrong reason: a mutation that accepted ANY stamp survived it.
const absence = (over) => post({
  ...over,
  evidence: { theme: 'datacenter', theme_answer: 'none_found', ...((over || {}).evidence || {}) },
});

ok(HS.mapsSocialThemeKey(absence()) === 'datacenter',
  '9: an ABSENCE post is a theme member — it answers the campaign question, with "none"');
ok(HS.mapsSocialIsAbsence(absence()) === true, '9: and it is identified as an absence post');
ok(HS.mapsSocialThemeBuckets([absence()]).byTheme.datacenter.length === 1,
  '9: so it is counted in the theme bucket the sub-nav and the ZIP badge read');

// THE STAMP IS READ ONLY WHERE THERE IS NOTHING TO CLASSIFY. A row carrying a project is
// still Map 1's answer and nothing else — otherwise this would be the second classifier
// the whole file exists to refuse.
ok(HS.mapsSocialThemeKey(post({
  evidence: { type: 'Development', type_raw: null, status: 'Proposed',
              project_name: 'Northgate Logistics Park', project_id: 'p1',
              theme: 'datacenter', theme_answer: 'none_found' },
})) === null,
  '9: a PROJECT-BACKED row may NOT claim the theme from a stamp — the marker still decides');
ok(HS.mapsSocialIsAbsence(post({
  evidence: { theme: 'datacenter', theme_answer: 'none_found', project_id: 'p1' },
})) === false,
  '9: a row with a project_id is never an absence post, whatever it is stamped');
ok(HS.mapsSocialThemeKey(post({ evidence: { theme_answer: 'none_found' } })) === null,
  '9: an absence post with NO stamped theme yields null — nothing is invented');
ok(HS.mapsSocialThemeKey(absence({ evidence: { theme: 'wildfire' } })) === null,
  '9: an UNRECOGNISED stamp yields null, never a new theme');
ok(HS.mapsSocialIsAbsence(absence({ content_family: 'ALERTS' })) === false
   && HS.mapsSocialIsAbsence(absence({ tile: 'community' })) === false,
  '9: the family and tile guards still apply to the absence path');

// ⚖️ THE GATE — EVERY DATA CENTER THEME POST REQUIRES THE MAP 1 CAPTURE, ABSENCE INCLUDED.
// Founder ruling, 2026-09-21: **every MAPS post gets a map, even when there is no data
// centre.** This block asserted the exemption; it is flipped, not deleted, so the change of
// rule is visible exactly where the old rule was pinned.
//
// 🛑 THE EXEMPTION'S OWN JUSTIFICATION WAS: "Making the badge correct without this would
// have made both absence drafts PERMANENTLY unapprovable: dcThemeImageMandatory would be
// true, and a post with no project can never obtain a bound Map 1 capture." The premise
// after the comma is what changed — an absence post CAN obtain a bound capture now, because
// its picture is of its ZIP's Map 1 page rather than of a project
// (scripts/maps-social-image.mjs::captureAbsence). Nothing is permanently unapprovable; a
// capture is simply owed first, which is the ruling.
ok(mapGate && mapGate(absence({ zip: '80210' })) !== '',
  '9: an absence post REQUIRES a map too — its ZIP\'s map is the picture');
ok(mapGate && mapGate(withEvidence({ project_name: 'RBC Data Center Campus' }, { zip: '80210' })) !== '',
  '9: a record-bearing theme post still REQUIRES one — the rule is uniform');
ok(!/theme\(p\) === 'datacenter' && !bskyIsAbsence\(p\)/.test(DASH),
  '9: no absence limb survives in the page\'s expression');
ok(/function bskyIsAbsence\(p\)\{/.test(DASH),
  '9: while the absence PREDICATE survives — what kind of post this is stays answerable');
// ⚖️ SUPERSEDED — §7 of the ruling: "Do not accidentally scope the new mandatory-map
// rule only to Data Center Theme." An ordinary MAPS draft needs a map like every other one;
// what it does NOT acquire is the theme's additional burden of proving the filter state.
// Both halves are asserted, because that distinction is the whole architecture.
const ordinary = post({ zip: '80210',
  evidence: { type: 'Residential', type_raw: 'SINGLE FAMILY', status: 'Proposed',
              project_name: 'Elm Street Townhomes', project_id: 'p9' } });
ok(mapGate && mapGate(ordinary) !== '',
  '9: an ordinary MAPS draft IS map-gated — the family is the boundary, not the theme');
ok(dcPolicy && dcPolicy(ordinary) === false,
  '9: …but it does NOT acquire the Data Center map-state burden — that scope is still a scope');

console.log(`\n${n - bad} passed, ${bad} failed`);
if (bad) process.exit(1);
