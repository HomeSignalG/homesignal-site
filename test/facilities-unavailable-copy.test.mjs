// A failed EPA read must render as UNKNOWN, and a genuine zero must still render as 0.
//
// WHY. The 1,722 zero-facility pages included BOTH outage victims and genuinely-empty rural ZIPs.
// Printing "unavailable" over a correct 0 would be a new inaccuracy in the opposite direction, so
// the flag is server-side and per-snapshot — never inferred from the count. This pins the client
// half: the em-dash and the note are driven by the flag ALONE, so no future edit can reintroduce
// the "facilities === 0 means outage" inference that was explicitly rejected.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const failures = [];

// the flag has to actually be fetched, or the page can never know
if (!/select=[^"]*facilities_unavailable/.test(src)) {
  failures.push('development_reports select does not request facilities_unavailable');
}
if (!/facUnavailable\s*:\s*!!row\.facilities_unavailable/.test(src)) {
  failures.push('the flag is not carried from the row into render()');
}
// the tile must show an em-dash, and ONLY on the flag
if (!/FAC_UNAVAILABLE\s*=\s*ZIP_MODE\s*&&\s*!!data\.facUnavailable/.test(src)) {
  failures.push('FAC_UNAVAILABLE is not derived from the server flag alone');
}
if (!/\$\("cFac"\)\.textContent\s*=\s*FAC_UNAVAILABLE\s*\?\s*"\\u2014"/.test(src)) {
  failures.push('#cFac does not render an em-dash when the EPA read failed');
}
// the note must exist and must take precedence over the facilities-only note
if (!/EPA's facility service could not be reached/.test(src)) {
  failures.push('the honest-unavailable note copy is missing');
}
if (!/unavailable rather than zero/.test(src)) {
  failures.push('the note must name the distinction it exists to make: unavailable, not zero');
}
if (!/if\(FAC_UNAVAILABLE\)\{[\s\S]{0,600}?return;\s*\}\s*\n\s*if\(!FACILITIES_ONLY\)/.test(src)) {
  failures.push('the unavailable note does not take precedence over the facilities-only note');
}
// THE REJECTED INFERENCE: nothing may conclude "outage" from a zero count.
if (/FAC_UNAVAILABLE\s*=\s*[^;]*facilities\s*===?\s*0/.test(src)
    || /FAC_UNAVAILABLE\s*=\s*[^;]*facCount\s*===?\s*0/.test(src)) {
  failures.push('FAC_UNAVAILABLE is being inferred from a zero count — explicitly rejected, because '
    + 'genuinely-empty rural ZIPs (84022 Dugway, 84034 Ibapah, 84083 Wendover, 84313 Grouse Creek) '
    + 'are CORRECT zeros and must keep rendering 0');
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('facilities-unavailable: em-dash + note driven by the server flag alone; '
  + 'zero-count inference absent; note takes precedence.');
