// The "New projects proposed" counter counts PROJECTS, not pins (2026-10-20, NC pre-launch).
// NCDOT STIP line projects draw one marker per road segment; on 28110 the tile read "8" for 3
// projects. The counter now uses the rails' identity (HS.zipAuthProjectCount); a site with no ref
// is its own project. This test runs the page's own projectsIn() and pins the wiring.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const raw = fs.readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const src = raw.replace(/\/\/.*$/gm, '');

// 1. The counter is computed through projectsIn over the active-undecided proposed points.
const stmt = src.match(/var propActive = [\s\S]*?;\n/);
assert.ok(stmt, 'propActive statement present');
assert.ok(/projectsIn\(propLive\)/.test(stmt[0]), 'the counter counts projects through projectsIn');
assert.ok(/var propLive = HS\.isActiveUndecided \? propPoints\.filter/.test(src),
  'only active, undecided proposed points are counted');

// 2. Run the page's projectsIn with the shipped zipAuthProjectCount.
const fn = raw.match(/function projectsIn\(list\)\{[\s\S]*?\n  \}/);
assert.ok(fn, 'projectsIn is defined in the page');
const ctx = { window: {}, HS: {} };
ctx.window.HS = ctx.HS;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../lib/zip-authoritative.js', import.meta.url), 'utf8'), ctx);
assert.equal(typeof ctx.HS.zipAuthProjectCount, 'function', 'shared counter loaded');
vm.runInContext(fn[0] + '; this.projectsIn = projectsIn;', ctx);

const seg = (ref) => ({ zip_project_ref: ref, scope: 'point' });
// 28110's shape: 3 projects drawn as 8 segment markers.
const ncdot = [seg('a:U-5723'), seg('a:U-5723'), seg('a:U-5764'), seg('a:U-5764'), seg('a:U-5764'),
  seg('a:U-5764'), seg('a:U-5764'), seg('b:R-1')];
assert.equal(ctx.projectsIn(ncdot), 3, '8 segment markers of 3 projects count as 3');
// A site without a ref (address mode, a data-centre row) is one project each.
assert.equal(ctx.projectsIn([{}, {}, seg('x')]), 3, 'ref-less sites count one each');
assert.equal(ctx.projectsIn([]), 0, 'empty is zero');
console.log('ok: the proposed counter counts projects, not segment markers');
