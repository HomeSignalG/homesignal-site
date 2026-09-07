// The legend's stage colours must be TELLABLE APART — pinned in a perceptual space,
// not by eye. Run: node test/lifecycle-color-separation.test.mjs
//
// WHY THIS FILE EXISTS. The founder reported, from the live page, that "Operating now"
// and "Lifecycle unknown" were the same colour in the Stage — pin color legend. They
// were not literally identical on that surface (#1f5130 vs #6b7f76) — they were the
// same HUE FAMILY at a size where the fill is a few pixels inside a 3px white stroke,
// which is the same thing to a reader. Two hex strings differing is not evidence that
// two swatches are distinguishable, so "they are different colours" is exactly the kind
// of naked assertion this repo's claims discipline forbids: the check has to measure
// the quantity a resident actually perceives.
//
// CIEDE2000 is that quantity. It is the CIE's own perceptual-difference metric, so a
// single threshold means the same thing for a green pair and a blue pair — RGB or HSL
// distance does not (equal RGB steps are wildly unequal to the eye, which is how the
// original pair passed inspection). ~1.0 is the just-noticeable difference under ideal
// conditions; small map pins, phone screens and colour-vision deficiency need far more.
//
// THE FLOOR IS 25, and it is derived rather than picked: the collision that was reported
// measured 22.2 (lifecycle) and 19.6 (permit status), and the next-closest pair in each
// palette — pairs nobody has ever reported as confusable — measured 33.6 and 31.6. Any
// floor in (22.2, 31.6] separates "reported broken" from "known fine"; 25 sits inside
// that gap with margin on both sides. It is a REGRESSION floor, not a design target: the
// shipped palettes clear it by 4-6 (lifecycle) and land at 22.1 on one legacy pair, which
// is why that one pair is named as an accepted exception below rather than silently
// excluded by lowering the number for everyone.
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

import { readFileSync } from 'node:fs';

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;

// ── CIEDE2000, implemented here rather than imported ─────────────────────────
// Shipping code does not compute colour distance, so there is nothing to borrow; and a
// test that reused the implementation under test could not detect it being wrong. sRGB
// -> linear -> XYZ (D65) -> CIELAB -> dE00, the standard chain.
const hex2rgb = (h) => { h = String(h).replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function rgb2lab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const Y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const Z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y / 1), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function dE00(hexA, hexB) {
  const [L1, a1, b1] = rgb2lab(hex2rgb(hexA));
  const [L2, a2, b2] = rgb2lab(hex2rgb(hexB));
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (x, y) => { if (x === 0 && y === 0) return 0; const d = Math.atan2(y, x) * 180 / Math.PI; return d >= 0 ? d : d + 360; };
  const h1p = hue(a1p, b1), h2p = hue(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else { const d = Math.abs(h1p - h2p); hbp = d <= 180 ? (h1p + h2p) / 2 : (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * hbp * Math.PI / 180)
    + 0.32 * Math.cos((3 * hbp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * hbp - 63) * Math.PI / 180);
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * Math.PI / 180) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

// §0 — POSITIVE CONTROLS on the metric itself. A distance function that returned a
// constant, or a large number for everything, would make every assertion below pass
// while measuring nothing. Anchors: identical colours are 0; black vs white is the
// maximum-lightness pair; and the historical collision still reproduces its 22.2.
ok(dE00('#1f5130', '#1f5130') === 0, '0a: a colour against itself is exactly 0');
ok(dE00('#000000', '#ffffff') > 99, '0b: black vs white is ~100, so the scale is the real dE00 scale');
ok(Math.abs(dE00('#1f5130', '#6b7f76') - 22.2) < 0.2,
  '0c: the REPORTED collision reproduces at 22.2 — the metric sees what the founder saw');
ok(Math.abs(dE00('#1f9d5c', '#6b7f76') - 19.6) < 0.2,
  '0d: the same collision in the permit-status palette reproduces at 19.6');

const FLOOR = 25;
function pairsOf(palette) {
  const keys = Object.keys(palette), out = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) out.push([keys[i], keys[j], dE00(palette[keys[i]], palette[keys[j]])]);
  }
  return out;
}
const FACILITY = HS.markerRegistry.facilityHex;

// §1 — THE LIFECYCLE STAGE PALETTE, read from the SHIPPED registry, never restated.
// These four ARE the "Stage — pin color" legend on homesignalmap.html, and they colour
// its 2D pins, its 3D-satellite pins and (since lc3D) its 3D-aerial blocks. Four
// members exactly: the lifecycle contract in lib/map.js admits no fifth, so a new key
// appearing here is itself a finding.
const LC = {
  operating: HS.LIFECYCLE_HEX.operating,
  approved: HS.LIFECYCLE_HEX.approved,
  proposed: HS.LIFECYCLE_HEX.proposed,
  unknown: HS.LIFECYCLE_HEX.unknown
};
ok(Object.values(LC).every((h) => /^#[0-9a-f]{6}$/i.test(String(h))),
  '1a: every lifecycle stage colour resolves to a real hex (nothing undefined)');
ok(HS.LIFECYCLE_KEYS.slice().sort().join(',') === Object.keys(LC).sort().join(','),
  '1b: the four measured here are exactly HS.LIFECYCLE_KEYS — no stage goes unmeasured');
pairsOf(LC).forEach(([a, b, d]) => {
  ok(d >= FLOOR, `1c: lifecycle ${a} vs ${b} — dE00 ${d.toFixed(1)} >= ${FLOOR}`);
});

// §2 — THE PERMIT-STATUS PALETTE (HS.statusHex), the other surface `onfile` colours:
// card bars, dashboard/alerts swatches, and HS.STATUS_LEGEND_ROWS.
const ST = {
  operating: HS.statusHex.operating,
  approved: HS.statusHex.approved,
  proposed: HS.statusHex.proposed,
  onfile: HS.statusHex.onfile
};
pairsOf(ST).forEach(([a, b, d]) => {
  ok(d >= FLOOR, `2a: status ${a} vs ${b} — dE00 ${d.toFixed(1)} >= ${FLOOR}`);
});

// §3 — THE DEFECT ITSELF, stated as its own assertion so a regression names it. These
// two mean OPPOSITE things: "this is operating now" is a claim about the world, and
// "the source states no lifecycle" is a refusal to make one. They may never look alike
// on any surface, at any size.
ok(dE00(LC.operating, LC.unknown) >= FLOOR,
  `3a: LIFECYCLE operating vs unknown — dE00 ${dE00(LC.operating, LC.unknown).toFixed(1)} (was 22.2)`);
ok(dE00(ST.operating, ST.onfile) >= FLOOR,
  `3b: STATUS operating vs on-file — dE00 ${dE00(ST.operating, ST.onfile).toFixed(1)} (was 19.6)`);
ok(LC.operating.toLowerCase() !== LC.unknown.toLowerCase()
  && ST.operating.toLowerCase() !== ST.onfile.toLowerCase(),
  '3c: and they are not literally the same string either');

// §4 — THE NEUTRAL MUST READ AS NEUTRAL. The failure was hue, not distance: a
// desaturated GREEN neutral belongs to the operating family however far apart the two
// measure. Chroma <= 8 in CIELAB is the structural guard — it forbids the whole class,
// not just the one value that was caught. (#6b7f76 measured 9.5 and would fail here.)
const lab = rgb2lab(hex2rgb(HS.statusHex.onfile));
const chroma = Math.hypot(lab[1], lab[2]);
ok(chroma <= 8, `4a: the neutral is chromatically neutral — CIELAB chroma ${chroma.toFixed(1)} <= 8`);
ok(Math.hypot(...rgb2lab(hex2rgb('#6b7f76')).slice(1)) > 8,
  '4b: control — the OLD neutral fails that same test, so §4a is load-bearing');

// §5 — the neutral must survive at pin size against the legend's near-white plate.
// WCAG 1.4.11 asks 3:1 for a meaningful graphical object; a 14px triangle carrying a
// 3px white stroke has little fill left, so a washed-out neutral is unreadable even
// when it is far from every other swatch.
const rel = (h) => { const [r, g, b] = hex2rgb(h).map(toLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = rel(a), y = rel(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
ok(contrast(HS.statusHex.onfile, '#ffffff') >= 3,
  `5a: neutral vs white — contrast ${contrast(HS.statusHex.onfile, '#ffffff').toFixed(2)}:1 >= 3:1`);

// §6 — ONE PALETTE, not two. lib/map.js carries a load-order fallback literal for
// HS.statusHex; if it drifts from lib/templates.js the colour depends on script order,
// which is the drift class this repo has fixed before. Read from the file rather than
// trusting that the two agree.
const mapSrc = readFileSync(new URL('../lib/map.js', import.meta.url), 'utf8');
const fb = mapSrc.match(/HS\.statusHex \|\| \{([^}]*)\}/);
ok(!!fb, '6a: the load-order fallback literal is still present in lib/map.js');
if (fb) {
  const parsed = {};
  fb[1].split(',').forEach((kv) => { const m = kv.match(/(\w+)\s*:\s*'(#[0-9a-fA-F]{6})'/); if (m) parsed[m[1]] = m[2]; });
  ok(Object.keys(HS.statusHex).every((k) => String(parsed[k]).toLowerCase() === String(HS.statusHex[k]).toLowerCase()),
    '6b: that fallback matches lib/templates.js exactly — no script-order-dependent colour');
}

// §7 — STAGE vs the REGULATED-FACILITY purple, on the SAME floor as everything else.
// Facility is not a stage — homesignalmap.html filters it out of the stage row and shows
// it in the "Type — pin shape" row as a SQUARE — but all of these pins share one map, so
// colour has to separate them too and there is no reason to hold it to a weaker bar.
//
// THIS SECTION USED TO CARRY AN EXCEPTION, and the history is the point. It was written
// with FACILITY_FLOOR = 15 because lifecycle `approved` (#2563EB) vs the old facility
// purple (#6f42c1) measured 15.2 — CLOSER than the operating/unknown pair that was
// actually reported from the live page — and that adjacency was pre-existing, so it was
// pinned at its own worst case and named rather than silently excluded. It has since been
// closed: the purple moved from a blue-violet to a true violet (see lib/map.js
// FACILITY_HEX), taking that pair to 27.0 and the permit-status one from 24.3 to 37.6.
// A floor that was a placeholder for an open question is now just the floor.
[['lifecycle', LC], ['status', ST]].forEach(([name, pal]) => {
  Object.keys(pal).forEach((k) => {
    const d = dE00(pal[k], FACILITY);
    ok(d >= FLOOR, `7a: ${name} ${k} vs regulated-facility — dE00 ${d.toFixed(1)} >= ${FLOOR}`);
  });
});
// The two pairs the move existed to fix, asserted by name so a regression says which.
ok(dE00(LC.approved, FACILITY) >= FLOOR,
  `7b: LIFECYCLE approved vs facility — dE00 ${dE00(LC.approved, FACILITY).toFixed(1)} (was 15.2)`);
ok(dE00(ST.approved, FACILITY) >= FLOOR,
  `7c: STATUS approved vs facility — dE00 ${dE00(ST.approved, FACILITY).toFixed(1)} (was 24.3)`);
// Controls: the OLD purple fails both, so §7a-c are load-bearing rather than tautological.
ok(dE00('#2563EB', '#6f42c1') < FLOOR && Math.abs(dE00('#2563EB', '#6f42c1') - 15.2) < 0.2,
  '7d: control — the old purple measured 15.2 against the same blue and would fail this floor');
// §7e — WHY THE PURPLE HAS TO STAY SATURATED, so nobody softens it back into a collision.
// It must clear the warm-grey NEUTRAL as well as the blue, and a muted purple cannot:
// #7b2d8e (chroma 62) lands at 24.7 against it. The constraint is three-way, not two.
ok(dE00('#7b2d8e', LC.unknown) < FLOOR,
  '7e: control — a softer purple fails against the neutral, which is what forces the saturation');

// §8 — THE 3D AERIAL VIEW MUST NOT RESTATE THE PALETTE. This is the other half of the
// same defect and it was worse: build3DFacilities read
//     var col = bkt === "approved" ? 0x2563EB : 0x1f5130;
// so `unknown` was painted the operating green EXACTLY — not merely adjacent, identical
// — and the 3D aerial asserted "operating now" about every record whose source states no
// lifecycle. Recolouring lib/templates.js could never have reached it, because the value
// was typed out again here. The fix routes it through lc3D(), which converts the SAME hex
// the legend chip and the 2D/GL pins read; this check is what stops a literal coming back.
const mapPage = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const aerial = mapPage.slice(mapPage.indexOf('function build3DFacilities'),
  mapPage.indexOf('function resize3D'));
ok(aerial.length > 500, '8a: build3DFacilities was located in the page (the slice is not empty)');
// Whole-line comments are dropped first: the fix deliberately QUOTES the old broken line
// so the next reader knows what was wrong, and a scan that could not tell code from a
// comment would either fail on that or force the explanation out of the file.
const aerialCode = aerial.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').toLowerCase();
ok(aerialCode.indexOf('var col = bkt==="approved"') === -1 && aerial.indexOf('//     var col = bkt==="approved"') !== -1,
  '8a2: the comment-stripper works — the quoted old line survives in the file and not in the scanned code');
// Only the lifecycle hexes matter — the home marker, fog and violation dot are not stages.
const stageLiterals = Object.values(LC).map((h) => '0x' + String(h).replace('#', '').toLowerCase());
stageLiterals.forEach((lit) => {
  ok(aerialCode.indexOf(lit) === -1,
    `8b: the 3D aerial does not hardcode the stage colour ${lit} — it reads lc3D()`);
});
ok(/var col\s*=\s*lc3d\(bkt\)/.test(aerialCode),
  '8c: the block colour is lc3D(bkt) — every bucket, including unknown, gets its own colour');
ok(/lc3d\("proposed"\)/.test(aerialCode),
  '8d: the proposed wireframe reads the palette too, not a second literal');


// §9 — A COLOUR YOU CANNOT SEE IS NOT A COLOUR. §1-§8 prove the palette is separated;
// this proves enough of each mark is actually PAINTED in it for that separation to
// reach a reader. The two are different claims, and the second is the one that was
// missed: after the palette was fixed the legend still read as one colour, because
// markerSVG drew a CONSTANT 3px white halo at every size while the marks are not one
// size — 14 in the legend, 13-15 for the 3D-satellite pins, 20 on the 2D map. A centred
// 3px stroke eats 1.5px inward regardless, so a 14px chip was 29% colour and 71% white.
//
// The invariant is SIZE-INVARIANCE, not a magic number: a chip and a pin must be the
// same drawing at different scales. Asserted as a spread across sizes rather than a
// value per size, so it cannot be satisfied by tuning one call site.
const SIZES = [13, 14, 15, 20, 22, 26];
function fillShare(size) {
  const inradius = (size * 0.40 * 1.16) / 2;          // equilateral: inradius = circumradius / 2
  const inner = Math.max(0, inradius - HS.markerStroke(size) / 2);
  return Math.pow(inner / inradius, 2);               // area share still showing the fill
}
const shares = SIZES.map(fillShare);
const spread = Math.max(...shares) - Math.min(...shares);
ok(spread < 0.02,
  `9a: the visible-fill share is size-invariant — ${(Math.min(...shares) * 100).toFixed(0)}%-${(Math.max(...shares) * 100).toFixed(0)}% across ${SIZES.length} sizes`);
ok(Math.min(...shares) >= 0.5,
  `9b: every mark is at least half its own colour — worst ${(Math.min(...shares) * 100).toFixed(0)}%`);
// The legend chip is the surface the defect was reported on; name it so a regression says so.
ok(fillShare(14) >= 0.5,
  `9c: the 14px LEGEND CHIP is ${(fillShare(14) * 100).toFixed(0)}% colour (was 29% under the constant 3px halo)`);
// Controls, so §9a-c are load-bearing rather than arithmetic that cannot fail.
const constantHalo = (size) => {
  const inradius = (size * 0.40 * 1.16) / 2;
  return Math.pow(Math.max(0, inradius - 1.5) / inradius, 2);
};
ok(constantHalo(14) < 0.35 && constantHalo(26) > 0.5,
  '9d: control — the OLD constant 3px halo gave 29% at 14 and 56% at 26, i.e. it was NOT size-invariant');
ok(Math.max(...SIZES.map(constantHalo)) - Math.min(...SIZES.map(constantHalo)) > 0.2,
  '9e: control — that old spread was >20 points, so §9a would have failed on it');
// The halo must not be thinned away: it is what separates a pin from the map tiles
// underneath, and losing it would trade one legibility defect for another.
ok(SIZES.every((s) => HS.markerStroke(s) >= 1.25),
  '9f: every mark keeps a real white halo — no size drops below 1.25px');
// The largest marks are unchanged in effect, which is what makes this a SMALL-mark fix.
ok(Math.abs(HS.markerStroke(26) - 3) < 0.02,
  `9g: at the default size the halo is still ~3px (${HS.markerStroke(26).toFixed(2)}) — big pins look the same`);
// And it is actually wired into the shipped markup, not just the helper.
const chip = HS.markerSVG('triangle', LC.unknown, '', 14);
const swAttr = Number((chip.match(/stroke-width="([\d.]+)"/) || [])[1]);
ok(Math.abs(swAttr - HS.markerStroke(14)) < 0.01 && swAttr < 3,
  `9h: the emitted 14px chip carries stroke-width ${swAttr} — the helper reaches the real markup`);


// §10 — A STAGE COLOUR MUST READ AS ITS OWN HUE, not merely sit far from its neighbours.
// This is the rule §1's separation floor did not contain, and its absence is why the legend
// still looked like one colour after the palette was "fixed": `operating` was '#1f5130', the
// BRAND green (--green), picked for buttons and headings rather than as a data colour. Its
// CIELAB chroma was 29 — against 80 for approved, 67 for proposed, 71 for the facility violet
// — so it was barely more saturated than the NEUTRAL it has to contrast with (chroma 6), and
// at L*30 on a 14px mark it read as dark GREY.
//
// The pair still measured 33.5 dE00 apart and passed §1. That is the trap worth naming:
// dE00 sums lightness, chroma and hue, so a pair can clear any distance floor on LIGHTNESS
// alone — and lightness is the first thing a small mark loses to a white halo and a shadow.
// A distance floor and a chroma floor answer different questions and both are needed.
const CHROMATIC = { operating: LC.operating, approved: LC.approved, proposed: LC.proposed,
                    facility: FACILITY };
function chromaOf(hex) { const lab = rgb2lab(hex2rgb(hex)); return Math.hypot(lab[1], lab[2]); }
Object.entries(CHROMATIC).forEach(([k, hex]) => {
  ok(chromaOf(hex) >= 45,
    `10a: ${k} reads as its own hue — CIELAB chroma ${chromaOf(hex).toFixed(0)} >= 45`);
});
// The neutral is the deliberate exception and is asserted the OTHER way in §4, so the two
// rules cannot both be satisfied by making everything grey or everything saturated.
ok(chromaOf(LC.unknown) <= 8,
  `10b: the neutral stays neutral — chroma ${chromaOf(LC.unknown).toFixed(0)} <= 8`);
ok(chromaOf('#1f5130') < 45,
  '10c: control — the old brand green measured chroma 29 and would fail 10a');
ok(dE00('#1f5130', LC.unknown) > FLOOR,
  '10d: control — and it PASSED the distance floor while failing to read as green, which is '
  + 'exactly why a distance floor alone was not enough');

// §11 — the three `.band-h.t-*` section headers in homesignalmap.html are stage swatches too:
// same three colours, same stage names, white 16px BOLD text on them. 16px bold is BELOW the
// WCAG large-text threshold (18.66px bold), so they need 4.5:1, not 3:1.
const bandContrast = (hex) => contrast(hex, '#ffffff');
ok(bandContrast(LC.operating) >= 4.5,
  `11a: Operating now band header — white text ${bandContrast(LC.operating).toFixed(2)}:1 >= 4.5`);
ok(bandContrast(LC.approved) >= 4.5,
  `11b: Approved band header — white text ${bandContrast(LC.approved).toFixed(2)}:1 >= 4.5`);
// ⚠️ MEASURED AND NOT FIXED: `proposed` (#E2772F) is 3.04:1 on its band header — it already
// failed before this change and fixing it means altering a stage colour that was not in scope.
// Pinned at its measured value so it cannot get worse without failing, and reported rather
// than silently excluded. Closing it is a founder call.
ok(bandContrast(LC.proposed) >= 3.0,
  `11c: Proposed band header — ${bandContrast(LC.proposed).toFixed(2)}:1, a NAMED pre-existing `
  + 'exception below 4.5, pinned at its current worst');
// The CSS must actually carry the stage colour, or the header and the legend drift apart.
const page = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const bandHex = (page.match(/\.band-h\.t-built\{background:(#[0-9a-fA-F]{6})\}/) || [])[1];
ok(String(bandHex).toLowerCase() === String(LC.operating).toLowerCase(),
  `11d: the "Operating now" band header uses the stage colour (${bandHex} === ${LC.operating})`);


console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
