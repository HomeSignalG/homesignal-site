// Offline proof of the MAPS visual pipeline's contract. No network, no browser, no DB:
// this asserts the rules the generator and the founder-review surface must hold, by
// reading the SHIPPED files, so a green run means the shipped behaviour is what is
// asserted here.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const GEN = readFileSync(new URL('../scripts/maps-social-image.mjs', import.meta.url), 'utf8');
const MAP1 = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../acquisition.html', import.meta.url), 'utf8');
const WF = readFileSync(new URL('../.github/workflows/maps-social-image.yml', import.meta.url), 'utf8');

// Some assertions below are about what the generator DOES, not what it explains. Its header
// necessarily names the things it refuses to do ("no radius circle", "not the Alerts
// screenshot path"), so those checks run against the CODE with comments stripped — a doc
// comment mentioning a forbidden concept is not the same as using it.
const GEN_CODE = GEN
// ⚠️ The block-comment strip must not fire inside a URL: homesignalmap.html's CSP carries
// `https://*.tile.openstreetmap.org`, whose `/*` opened a phantom comment swallowing 2,297
// bytes of that file's head — so an absence-pin over the CSP or the head scripts passed by
// reading nothing. Requiring the opener not to follow `:` or `/` keeps every real comment.
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

// ── the visual is a capture of Map 1, not a second map ────────────────────────────────
ok(/from 'playwright'/.test(GEN), 'the generator drives a real browser, not a drawing library');
ok(!/tile\.openstreetmap|L\.tileLayer|canvas|new Image\(|createCanvas/.test(GEN),
  'the generator never fetches tiles or draws its own map');
ok(/homesignalmap\.html\?zip=/.test(GEN), 'it opens the real public Map 1 ZIP page');
ok(/window\.siteMarkers/.test(GEN), 'it uses the markers Map 1 itself drew');
ok(/window\.siteMarkers/.test(MAP1), 'and Map 1 really does expose them (contract still present)');

// ── no invented public deep link ──────────────────────────────────────────────────────
const genUrls = [...GEN.matchAll(/homesignalmap\.html\?([a-z0-9_=&${}.\-]+)/gi)].map((m) => m[1]);
ok(genUrls.length > 0, 'the generator builds Map 1 URLs');
ok(genUrls.every((q) => /^zip=/.test(q)), 'every Map 1 URL it builds uses only ?zip= : ' + genUrls.join(' | '));
ok(!/[?&]addr=/.test(GEN), 'it never opens address mode');
ok(!/[?&](project|site|marker|focus|pid)=/.test(GEN),
  'it invents no project-specific query parameter');

// ── geography: no HOME, no radius, no proximity, no centroid ─────────────────────────
ok(/homePins[\s\S]{0,200}refused/.test(GEN), 'a home marker on the map REFUSES the capture');
ok(/\.homepin/.test(GEN) && /\.homepin/.test(MAP1),
  'the refusal checks the class Map 1 actually uses for the home pin');
ok(/HOME_ANCHOR = true/.test(MAP1), 'ZIP mode sets HOME_ANCHOR, so no home marker is drawn');
ok(/if\(!ZIP_MODE\)\{?\s*\n\s*L\.circle/.test(MAP1) || /if\(!ZIP_MODE\)[\s\S]{0,200}L\.circle/.test(MAP1),
  'the radius circle is guarded behind !ZIP_MODE in Map 1');
ok(/function updateHome3D\(\)\{[\s\S]{0,500}if\(ZIP_MODE\)return/.test(MAP1),
  '3D aerial ZIP mode draws no home house at the report centroid');
ok(/function drawRings\(\)\{[\s\S]{0,400}if\(ZIP_MODE\)return/.test(MAP1),
  '3D aerial ZIP mode draws no mile rings around a ZIP centroid');
ok(/function draw3DSoft\(\)\{[\s\S]{0,1600}if\(!ZIP_MODE\)\{[\s\S]{0,80}ringStops/.test(MAP1),
  'the Canvas 2D aerial fallback is the same ZIP geography (no rings, no house)');
ok(/HS\.zipFrameFromSites/.test(MAP1) && /ZIP_FRAME\.spanMi/.test(MAP1),
  'ZIP 3D frames the records\' own extent, not a centroid + radius');
ok(/if\(ZIP_MODE\)\{[\s\S]{0,40}bounds = \[\]/.test(MAP1),
  '2D ZIP fit is not seeded with a ZIP centroid');
ok(!/L\.circle|L\.polygon|1609\.34|\* *1609|milesTo|toMeters/i.test(GEN_CODE),
  'the generator creates no geographic circle and converts no distance to metres');
ok(/homePins > 0.*refused|refused: a home marker/.test(GEN_CODE),
  'the ONLY geometry veto is the home marker');
ok(/vectorPaths/.test(GEN_CODE) && /vector_paths/.test(GEN_CODE),
  'vector paths in frame are recorded into the evidence, not silently ignored');
ok(/setView\(\[hit\.s\.lat, hit\.s\.lng\]/.test(GEN),
  'the view is centred on the RECORD\u2019s own coordinates, never a ZIP centroid or a fanned pixel position');
ok(/screen-pixel|SCREEN PIXELS/i.test(GEN) && /46px/.test(GEN),
  'the selection halo is sized in screen pixels, so it cannot read as a distance');

// ── the target must be identified, not assumed ───────────────────────────────────────
ok(/COORD_EPS\s*=\s*1e-5/.test(GEN), 'marker matching is a coordinate identity test');
ok(/no drawn marker for this project/.test(GEN),
  'no matching marker is an honest failure, not a fallback image');
ok(/zip_project_ref \|\| s\.source_id/.test(GEN),
  'the marker join accepts BOTH names the page uses for the project key');
ok(/zip_project_ref/.test(readFileSync(new URL('../lib/zip-authoritative.js', import.meta.url), 'utf8')),
  'and zip_project_ref really is what the authoritative path emits');
ok(/deltaM > 500/.test(GEN),
  'the drawn marker may carry better geometry than the stored point, but the delta is bounded');
ok(/marker_vs_stored_point_m/.test(GEN),
  'and that delta is recorded in the evidence rather than hidden');
ok(/waitForFunction\([\s\S]{0,240}zip_project_ref \|\| x\.s\.source_id\) === key/.test(GEN),
  'the capture waits for THIS project\u2019s marker, not for a count to stop changing');
ok(/live coordinates differ from the draft evidence/.test(GEN),
  'the live project row is re-read and must still agree with the draft');
ok(/record_kind !== 'development'/.test(GEN), 'facilities can never be captured');

// ── surrounding development is not hidden ────────────────────────────────────────────
// ⚠️ THIS READS `GEN_CODE`, NOT `GEN`, and that is this file's own stated rule applied to a
// line that had missed it: the check is about what the generator DOES, and the raw text also
// matches a COMMENT that merely names the forbidden call. It failed exactly that way when the
// Data Center Theme work added a comment explaining that Leaflet nulls `m._map` on
// removeLayer — an explanation of the page's behaviour, not a call in this module.
ok(!/display:\s*none[^}]*marker|hideMarkers|removeLayer|clearLayers/.test(GEN_CODE),
  'the generator never hides other markers to make a cleaner picture');
// THE ONE SANCTIONED NARROWING, and why it is not a breach of the rule above. A MAPS · Data
// Center Theme capture puts Map 1's PROJECT TYPE row into a Data-center-only state. That is
// NOT the generator hiding markers: it operates the product's OWN filter control, the control
// is inside the captured frame, and its checkmarks therefore DISCLOSE the narrowing to anyone
// looking at the image. The rule this file protects is that a picture must not be quietly
// cleaned up; a visible, resident-operable filter is the opposite of quiet. Asserted rather
// than assumed — the narrowing must happen through a change event on the page's own checkbox,
// never by touching the map.
ok(/dispatchEvent\(new Event\('change'/.test(GEN_CODE),
  'the theme filter is applied through the page\u2019s OWN control, not by editing the map');
ok(!/layerGroup|\.addTo\(|L\.marker|setStyle/.test(GEN_CODE),
  'and the generator still never touches Leaflet layers itself');
ok(/leaflet-control-container\{display:none/.test(GEN),
  'only Leaflet’s own zoom control is hidden for the shot');

// ── dimensions match the shipped contract ────────────────────────────────────────────
ok(/IMG_W = 1200, IMG_H = 630/.test(GEN), 'the image is 1200x630 — the ratio og-default.png already ships');
ok(/deviceScaleFactor: SCALE/.test(GEN) && /SCALE = 2/.test(GEN), 'captured at 2x so labels stay legible');

// ── storage + attachment reuse the existing path ─────────────────────────────────────
ok(/storage\/v1\/object\/social-images\//.test(GEN), 'it uploads into the existing private social-images bucket');
ok(/image_bucket_path: objectPath/.test(GEN), 'it attaches through the existing image_bucket_path column');
ok(/content_family=eq\.MAPS/.test(GEN), 'it selects MAPS rows only');
ok(/status=eq\.draft/.test(GEN), 'it selects drafts only');

// ── the publication hold ─────────────────────────────────────────────────────────────
// ⚠️ NARROWED 2026-09-20, from "never MENTIONS these columns" to "never WRITES them", and
// the narrowing is what the change required rather than what it wanted. The capture run now
// RE-READS `status`/`approved_at`/`scheduled_slot`/`published_at` on every row it touched
// and raises if one stopped being a draft — a stronger guarantee than never naming them,
// and one a mention-ban makes impossible to write. So the ban moves to where writes happen.
const PATCH_SITES = (GEN.match(/method: 'PATCH'/g) || []).length;
ok(PATCH_SITES > 0, `the generator has ${PATCH_SITES} PATCH site(s) to check`);
ok((GEN.match(/JSON\.stringify\(assertWriteScope\(/g) || []).length === PATCH_SITES,
  'EVERY PATCH body goes through assertWriteScope — a new write path cannot skip the gate');
ok(/const WRITABLE = \['image_bucket_path', 'evidence'\];/.test(GEN),
  'and the writable set is exactly image_bucket_path + evidence');
// ⚠️ `status` IS DELIBERATELY NOT IN THIS LIST, and leaving it out is not a weakening.
// `evidence.visual.status` is a different field that lives INSIDE the one jsonb column this
// job may write, and a mention-ban cannot tell the two apart — it would fail on the nested
// one while proving nothing about the column. The social_posts.status column is covered
// twice over and more strongly: by the exact WRITABLE pair asserted above, and by the
// post-run re-read asserted below.
for (const forbidden of ['approved_at', 'scheduled_slot', 'published_at', 'bsky_uri']) {
  ok(!new RegExp(`${forbidden}:\\s`).test(GEN.replace(/select=[^'"`]*/g, '')),
    `the generator never assigns ${forbidden} in an object literal`);
}
// The forbidden columns may still be READ. That read is the post-run proof, so assert it
// exists rather than merely tolerating it — otherwise deleting the proof would go unnoticed
// and the narrowing above would have bought nothing.
ok(/proveNothingApproved/.test(GEN) && /REFUSING TO REPORT SUCCESS/.test(GEN),
  'the run re-reads the rows it touched and RAISES if any left draft state');

// ── the trigger: recurring, bounded, and still switchable off ────────────────────────
// ⚖️ CHANGED 2026-09-20. This block used to assert `!/schedule:/` — that the job could not
// run on its own. That assertion was correct about the hold and wrong about where the hold
// lives: the job last ran 2026-09-04 and 40 of 49 MAPS drafts had no image, including every
// Data Center Theme candidate, which cannot be approved without one. The hold on PUBLICATION
// is now enforced by the write scope above (and by publish-worker reading status='approved'
// only), so the schedule is what the founder asked for and the assertions move to BOUNDING it.
ok(/schedule:/.test(WF) && /cron:/.test(WF), 'the capture workflow runs on a schedule');
ok(/workflow_dispatch/.test(WF), 'and is still dispatchable on demand');
ok(/concurrency:/.test(WF) && /cancel-in-progress: false/.test(WF),
  'runs never overlap, so a slow run cannot be stacked by the next fire');
ok(/--limit "\$\{\{ inputs\.limit \|\| '\d+' \}\}"/.test(WF),
  'every run is hard-capped by --limit, scheduled fires included');
ok(/ENABLE GATE/.test(WF) && /EXPECTED_ENABLE/.test(WF),
  'and a standing switch can still stop every future run');
ok(/if \[ ! -r \.github\/maps-social-capture \]/.test(WF),
  'the switch FAILS CLOSED — a missing file stops the job rather than defaulting it on');
// Scoped to the DECLARATION, not to the string. The workflow header quotes its own
// superseded wording so a reader can see what changed, and this repo keeps such receipts;
// a pin that forbade the characters would force deleting the history to satisfy it.
ok(!/^\s*EXPECTED_ARM:/m.test(WF),
  'the one-shot arm token is gone: no per-run re-arm is needed any more');

// ── founder review distinguishes the FOUR capture states ─────────────────────────────
// ⚖️ WIDENED from two. "Real" vs "fallback" could not say whether a missing picture meant
// nobody had tried yet, our screenshot failed, or the project cannot be photographed — and
// a reader who cannot tell those apart is one step from reading the last as "no data
// centres here", which is a claim about the world made out of an instrument failure.
ok(/REAL MAP VISUAL/.test(DASH), 'founder review shows an explicit REAL MAP VISUAL state');
ok(/AWAITING MAP CAPTURE/.test(DASH), 'an explicit not-yet-attempted state');
ok(/CAPTURE FAILED/.test(DASH), 'an explicit capture-failure state');
ok(/CANNOT BE PHOTOGRAPHED YET/.test(DASH), 'an explicit ineligible state');
ok(/IMAGE OUT OF DATE/.test(DASH), 'and an explicit state for an image that no longer matches its draft');
for (const s of ['CAPTURE FAILED', 'CANNOT BE PHOTOGRAPHED YET']) {
  const i = DASH.indexOf(s);
  ok(i > -1 && /not a finding about this ZIP/.test(DASH.slice(i, i + 400)),
    `"${s}" is stated as an instrument fact, never as a finding about the ZIP`);
}
ok(/createSignedUrl\('?social-images'?|from\('social-images'\)/.test(DASH),
  'the preview reads the private bucket through a signed URL');
ok(/function visualStatus\(p\)\{[\s\S]{0,300}content_family!=='MAPS'/.test(DASH),
  'ALERTS rows keep their original image chip — visualStatus branches on family first');
ok(/function mapsVisual\(p\)\{\s*\n\s*if\(p\.content_family!=='MAPS'/.test(DASH),
  'the Maps image block renders nothing for an ALERTS row');

// ── the Alerts visual path is a different module and is untouched here ───────────────
ok(!/screenshot-alert|captureItem/.test(GEN_CODE),
  'the Maps generator does not reach into the Alerts screenshot module');

ok(/app_zip_projects_markers/.test(GEN),
  'the generator asks the AUTHORITATIVE whole-ZIP set whether the project is drawn at all');
ok(/boundary_complete/.test(GEN),
  'and reports a not-yet-computed ZIP boundary as the reason rather than a browser failure');
ok(/authoritative_zip_status/.test(GEN),
  'the authoritative status is recorded in the evidence of every real visual');

ok(/popupOpen \|\| !clean\.haloPresent/.test(GEN),
  'a capture where the target could not be made identifiable is REFUSED, not shipped');
ok(/popup_text/.test(GEN),
  'the popup text that names the project in the image is recorded as evidence');

console.log(`\n${n - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
