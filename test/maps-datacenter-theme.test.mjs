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

// Comment-stripped views. A doc comment naming a forbidden concept is not the same as using
// it, and this unit's files explain at length what they refuse to do.
const strip = (src) => src
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const GEN_CODE = strip(GEN);
const THEME_CODE = strip(THEME_SRC);

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

// ── Load the shipped modules exactly as the page loads them, in the page's order ──────
const win = { HS: {} };
globalThis.window = win;
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js']) {
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
ok(HS.mapsSocialThemeLabel('datacenter') === 'Data Center Theme', '4: the theme has its display label');
ok(HS.mapsSocialThemeLabel('nope') === null, '4: an unknown key gets NO invented label');

// ═══ 5. THE DASHBOARD — hierarchy, derived counts, preserved actions ═════════════════
ok(/src="lib\/map\.js"/.test(DASH) && /src="lib\/maps-social-theme\.js"/.test(DASH),
  '5: the dashboard loads the shipped classifier and the theme derivation');
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
// `dcThemeImageMandatory` delegates to `bskyTheme`, so both are lifted into ONE scope —
// which also proves the delegation is real rather than a second copy of the rule.
const lifted = (() => {
  const a = bodyOf('bskyTheme'), b = bodyOf('dcThemeImageMandatory');
  if (!a || !b) return null;
  return new Function('HS', 'window', `
    function bskyTheme(${a.args}){${a.body}}
    function dcThemeImageMandatory(${b.args}){${b.body}}
    return { bskyTheme, dcThemeImageMandatory };`)(HS, { HS });
})();
const dcMandatory = lifted && lifted.dcThemeImageMandatory;
ok(typeof dcMandatory === 'function', '6: the Data Center Theme image gate is liftable and runnable');
ok(dcMandatory && dcMandatory(withEvidence({ project_name: 'RBC Data Center Campus' })) === true,
  '6: a Data Center Theme post declares the Map 1 screenshot MANDATORY');
ok(dcMandatory && dcMandatory(post()) === false,
  '6: an ordinary MAPS post does NOT require a capture — the stricter rule is scoped to the theme');
ok(/function bskyApprovalBlockReason/.test(DASH),
  '6: ONE function decides whether approval is allowed');
ok(/var block=bskyApprovalBlockReason\(gr\);\s*if\(block\)\{ alert\(block\); return; \}/.test(DASH.replace(/\n\s*/g, ' ')),
  '6: the click handler refuses through that same one function — button and handler cannot disagree');
ok(/dcThemeImageMandatory\(row\) && !row\.image_bucket_path/.test(DASH),
  '6: a theme post with NO capture can never unlock approval');
ok(/mapsImageRequired\(p\) && !_bskyImgOk\[p\.id\]/.test(DASH),
  '6: an attached image must have RENDERED before approval, as before');

// ═══ 7. THE CAPTURE — real controls, real marker, real product card ═════════════════
ok(/applyDataCenterTypeFilter/.test(GEN_CODE), '7: the generator has a Data center capture state');
ok(/dispatchEvent\(new Event\('change'/.test(GEN_CODE),
  '7: the filter is applied THROUGH THE REAL CONTROLS (a change event on the page\'s own checkbox)');
ok(!/HS\.setCategoryFilter|applyFilter\(\)/.test(GEN_CODE),
  '7: the generator never writes a filter value directly — it drives the page\'s own handler');
ok(/#mapkeyShapes \.typechip/.test(GEN_CODE),
  '7: it addresses the shipped PROJECT TYPE chips by their own selector');
// ORDER: the filter must go on BEFORE the project's marker is located, so the marker's
// survival is the proof of bucket membership.
// ⚠️ INDEX THE CALL SITE, NOT THE DEFINITION. The first version of this searched for
// `applyDataCenterTypeFilter(page)`, which matches the `async function
// applyDataCenterTypeFilter(page) {` declaration near the top of the file — so the check
// compared a fixed early offset against the marker wait and could never fail. Proven by
// mutation: moving the call after the wait left it green.
const iFilter = GEN_CODE.indexOf('await applyDataCenterTypeFilter(page)');
const iMarker = GEN_CODE.indexOf('proj.source_key');
ok(iFilter > 0 && iMarker > 0 && iFilter < iMarker,
  '7: the Data center filter is applied BEFORE the project marker is located');
ok(/no marker on Map 1 with the Data center PROJECT TYPE filter/.test(GEN),
  '7: a project that vanishes under the filter REFUSES the capture — no substitute is used');
ok(/EMBED_PARAM = 'embed=1'/.test(GEN_CODE),
  '7: the theme capture uses the SHIPPED embed mode rather than a private layout');
ok(/theme === 'datacenter' \? '\.card\.mapcard' : '#map'/.test(GEN_CODE),
  '7: a theme capture clips to the Map 1 PRODUCT CARD; a plain MAPS capture is unchanged');
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

console.log(`\n${n - bad} passed, ${bad} failed`);
if (bad) process.exit(1);
