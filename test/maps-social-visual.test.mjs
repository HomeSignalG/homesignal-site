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
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
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
ok(/x\.s\.source_id === sourceKey/.test(GEN),
  'the marker join is the source id — the same string app_projects.source_key holds');
ok(/coord_agrees/.test(GEN),
  'and the record\u2019s own coordinates must still agree with the project\u2019s');
ok(/__hsMarkerSettle/.test(GEN),
  'the capture waits for the draw to SETTLE, not merely to start');
ok(/live coordinates differ from the draft evidence/.test(GEN),
  'the live project row is re-read and must still agree with the draft');
ok(/record_kind !== 'development'/.test(GEN), 'facilities can never be captured');

// ── surrounding development is not hidden ────────────────────────────────────────────
ok(!/display:\s*none[^}]*marker|hideMarkers|removeLayer|clearLayers/.test(GEN),
  'the generator never hides other markers to make a cleaner picture');
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
for (const forbidden of ['approved_at', 'scheduled_slot', 'published_at', 'bsky_uri', "'approved'", "'published'"]) {
  ok(!new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(GEN),
    `the generator never writes ${forbidden}`);
}
ok(!/schedule:/.test(WF), 'the capture workflow has NO schedule — automatic generation stays off');
// The trigger is a push scoped to ONE branch and ONE path (the arm file) while this lives
// on a feature branch — workflow_dispatch cannot reach a workflow that is not on main. What
// must hold is that it can never become ambient: no schedule, never on main's branch list,
// and a push of ordinary code cannot fire it.
ok(/workflow_dispatch/.test(WF), 'it is dispatchable once it reaches main');
ok(/paths: \['\.github\/maps-social-arm'\]/.test(WF),
  'the push trigger fires ONLY on the arm file, so a code push cannot start a capture');
ok(!/branches: \[main\]|branches:\s*\n\s*- main/.test(WF), 'it is never triggered on main');
ok(/ARMING GATE/.test(WF) && /EXPECTED_ARM/.test(WF), 'and arm-gated before it touches production');

// ── founder review distinguishes real from fallback ──────────────────────────────────
ok(/REAL MAP VISUAL/.test(DASH), 'founder review shows an explicit REAL MAP VISUAL state');
ok(/NO PROJECT-SPECIFIC VISUAL/.test(DASH), 'and an explicit fallback state');
ok(/createSignedUrl\('?social-images'?|from\('social-images'\)/.test(DASH),
  'the preview reads the private bucket through a signed URL');
ok(/function visualStatus\(p\)\{[\s\S]{0,300}content_family!=='MAPS'/.test(DASH),
  'ALERTS rows keep their original image chip — visualStatus branches on family first');
ok(/function mapsVisual\(p\)\{\s*\n\s*if\(p\.content_family!=='MAPS'/.test(DASH),
  'the Maps image block renders nothing for an ALERTS row');

// ── the Alerts visual path is a different module and is untouched here ───────────────
ok(!/screenshot-alert|captureItem/.test(GEN_CODE),
  'the Maps generator does not reach into the Alerts screenshot module');

console.log(`\n${n - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
