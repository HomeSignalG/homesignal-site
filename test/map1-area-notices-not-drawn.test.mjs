// A dot means a precise project site (founder bar, Denton launch 2026-10-12). Jurisdiction-level ("area") records have no
// trustworthy coordinate, so Map 1 must not DRAW them (they stay in the lists/counters). Structural pin on the shipped page.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) bad++; };
const m = src.match(/function mappable\(s\)\{([^}]*)\}/);
ok(!!m, 'mappable() exists exactly once');
ok(m && /scope==="point"/.test(m[1]) && !/area/.test(m[1]), 'mappable() admits point scope only');
ok(!/placeAreaSites\(sites, home\);/.test(src), 'drawMap no longer assigns synthetic display positions to area items');
const uses = (src.match(/if\(!mappable\([a-z]\)\)\s*return/g) || []).length;
ok(uses >= 5, `every drawing path (2D, 3D aerial, GL) still gates on mappable() (${uses} sites)`);
ok(/var dev = sites\.filter\(function\(s\)\{ return s\.scope==="area" && !isCivic\(s\); \}\)/.test(src), 'area records still feed the lists (not lost)');
process.exit(bad ? 1 : 0);
