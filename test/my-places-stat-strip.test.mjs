// MY PLACES STAT STRIP — a missing comment window is not an open one, and an unmeasured
// score is not a zero.
//
// WHAT WAS BROKEN, measured on production before the fix. ZIP 78617 holds 17 non-news
// app_changes rows; ALL 17 carry window_closes_at NULL and 0 are open. The strip rendered
// "17 Need you across all Places" while every Address card below it rendered "Nothing needs
// you" — the contradiction a resident actually saw on homesignal.net.
//
// THE CAUSE IS ONE JAVASCRIPT COERCION. HS.daysUntil returns null when there is no
// window_closes_at, and `null >= 0` is TRUE (null converts to 0 in a relational comparison,
// unlike in ==). So `daysUntil(x.window_closes_at) >= 0` accepted every record that has no
// comment window at all. The correct form was already used in four other places in this
// repo; three call sites had never adopted it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 300) : ''));
  if (!c) fails++;
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(join(root, f), 'utf8');
// Comments must never satisfy — or fail — a source scan. Both files deliberately QUOTE the
// forbidden expression in order to explain why it is forbidden, so a scan over raw text
// would report the defect as still present forever.
const strip = (x) => x
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const propsRaw = read('properties.html');
const props = strip(propsRaw);
const property = strip(read('property.html'));
const templates = read('lib/templates.js');

console.log('\n--- §1 THE COERCION ITSELF (control) -------------------------------------');
// If this ever stops being true the guard is unnecessary — so the test says WHY it exists.
ok(null >= 0, '1a `null >= 0` is TRUE in JavaScript — this is the whole defect');
ok(!(null > 0), '1b ...while `null > 0` is false, which is why it reads as "today, still open"');
ok(!(undefined >= 0), '1c ...and undefined does NOT coerce, so only a null return is dangerous');

// The shipped helper really does return null for an absent window — the premise of §1.
const daysUntilSrc = (templates.match(/function daysUntil\(dateStr\) \{[\s\S]*?\n  \}/) || [''])[0];
ok(/if \(!dateStr\) return null;/.test(daysUntilSrc),
  '1d HS.daysUntil returns null for an absent window', daysUntilSrc.slice(0, 120));

console.log('\n--- §2 NO SHIPPED COMPARISON IS UNGUARDED --------------------------------');
// The forbidden shape: a daysUntil(...) result compared to 0 with no null check. Scanned
// across every file that ships, not just the two repaired here, so a fourth site cannot
// appear later and go unnoticed.
const SHIPPED = ['properties.html', 'property.html', 'alerts.html', 'shell.js',
                 'lib/templates.js', 'lib/why.js', 'development.html', 'dashboard.html',
                 'lib/community-page.js', 'homesignalmap.html'];
const unguarded = [];
for (const f of SHIPPED) {
  let src;
  try { src = strip(read(f)); } catch (e) { continue; }
  // Direct comparison of the CALL to a number, e.g. `HS.daysUntil(x.y) >= 0`.
  const m = src.match(/(?:HS\.)?daysUntil\([^()]*\)\s*[<>]=?\s*-?\d/g) || [];
  for (const hit of m) unguarded.push(f + ': ' + hit);
}
ok(unguarded.length === 0,
  '2a no shipped file compares a daysUntil() call straight to a number', unguarded);

// Positive control: the scan CAN see the shape it forbids, so 2a is not vacuous.
ok((strip('var n = HS.daysUntil(x.window_closes_at) >= 0;')
     .match(/(?:HS\.)?daysUntil\([^()]*\)\s*[<>]=?\s*-?\d/g) || []).length === 1,
  '2b CONTROL: the scan matches the forbidden shape when it is present');

// And the guarded form is what the repaired sites actually use.
for (const [file, src] of [['properties.html', props], ['property.html', property]]) {
  const guards = (src.match(/d\s*!=\s*null\s*&&\s*d\s*>=\s*0/g) || []).length;
  ok(guards >= 1, '2c ' + file + ' uses the `d != null && d >= 0` form', guards);
}
// Both properties.html sites are covered — the strip helper and the Address card.
ok(/function openWindowCount/.test(props), '2d the strip counts through a named helper');
ok(/openWindowCount\(changes\)/.test(props), '2e ...and the tile is built from it');
ok(/var needs = HS\.withDistance\(changes, p\)[\s\S]{0,260}d != null && d >= 0/.test(props),
  '2f ...and the Address card guards its own count too');

console.log('\n--- §3 AN UNMEASURED SCORE IS NOT A ZERO ---------------------------------');
// app_properties.score is NULL on every stored row, so `p.score || 0` averaged absent
// values as real zeros and rendered "0 Avg Address score" as a measurement.
ok(!/p\.score \|\| 0/.test(props),
  '3a the average no longer coerces an absent score to 0');
ok(/typeof p\.score === 'number' && isFinite\(p\.score\)/.test(props),
  '3b only addresses carrying a real number are averaged');
ok(/scored\.length[\s\S]{0,140}: null;/.test(props),
  '3c ...and with none the average is null, so the tile is omitted entirely');
ok(/avg != null \? HS\.tpl\.statTile\(avg, 'Avg Address score'/.test(props),
  '3d the tile still renders when a score genuinely exists');
// The Address card was already honest and must stay that way.
ok(/miniscore">' \+ \(p\.score \|\| ''\)/.test(props),
  '3e the Address card still renders an absent score as blank, not 0');

console.log('\n--- §4 A TILE MAY NOT CLAIM A SPAN IT DID NOT MEASURE ---------------------');
// changes/projects are read for the VIEWED ZIP only.
ok(/HS\.data\.changes\(S\.zip/.test(props) && /HS\.data\.projects\(S\.zip/.test(props),
  '4a CONTROL: the page reads one ZIP, which is what makes the old label false');
ok(!/across all Places/.test(propsRaw),
  '4b no tile claims "across all Places" anywhere in the file, comments included');
ok(!/Nearby projects total/.test(propsRaw),
  '4c ...nor "Nearby projects total", which was neither nearby nor a total');
ok(/'Need you' \+ inZip/.test(props) && /'Projects' \+ inZip/.test(props),
  '4d both ZIP-scoped tiles name the ZIP they actually measured');
ok(/var inZip = S\.zip \?/.test(props),
  '4e ...and degrade to a bare label rather than printing "ZIP undefined"');
// The Places tile IS a true all-places count and must keep its plain label.
ok(/statTile\(a\.length \+ z\.length, 'Places'/.test(props),
  '4f the Places tile is unchanged — that one really does span every place');

console.log('\n' + (fails ? fails + ' FAILED' : 'All stat-strip assertions passed'));
process.exit(fails ? 1 : 0);
