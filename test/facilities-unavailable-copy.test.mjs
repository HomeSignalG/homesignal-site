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
const community = readFileSync(join(root, 'lib/community-page.js'), 'utf8');
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
// (FAC_UNMEASURED joins it 2026-09-22: a ZIP-mode facility plane that is not a membership
// measurement is an unknown count too — docs/zip-membership-canonical.sql §3. The EPA-outage
// NOTE stays keyed on FAC_UNAVAILABLE alone, pinned above.)
// (2026-10-23: a stored count above zero, confirmed on the day the facility clock holds, shows
// with that date instead — HS.facilityCount, pinned behaviourally at the end of this file.)
if (!/\$\("cFac"\)\.textContent\s*=\s*FAC_CONFIRMED_ON \? _facN\s*:\s*\(FAC_UNAVAILABLE \|\| FAC_UNMEASURED\)\s*\?\s*"\\u2014"/.test(src)) {
  failures.push('#cFac does not render an em-dash when the EPA read failed and no confirmed count exists');
}
if (!/facConfirmedAt\s*:\s*row\.facilities_refreshed_at/.test(src)
    || !/select=[^"]*facilities_refreshed_at/.test(src)) {
  failures.push('Map 1 does not read development_reports.facilities_refreshed_at for the confirmed date');
}
if (!/HS\.facilityCount\(\{ unavailable:true, count:_facN, confirmedAt:data\.facConfirmedAt \}\)/.test(src)) {
  failures.push('Map 1 does not ask HS.facilityCount (the one decision) for the dated count');
}
// the note must exist and must take precedence over the facilities-only note
if (!/EPA's facility service did not answer/.test(src)) {
  failures.push('the honest-unavailable note copy is missing');
}
if (/unreachable since 2026-08-09/.test(src)) {
  failures.push('the note still names a fixed outage date, false of every page flagged since');
}
if (!/cannot be confirmed/.test(src)) {
  failures.push('the note must say the count CANNOT BE CONFIRMED — the only claim true of every '
    + 'flagged page regardless of which day it was last refreshed');
}
if (!/unavailable rather than zero/.test(src)) {
  failures.push('the note must name the distinction it exists to make: unavailable, not zero');
}
if (!/if\(FAC_UNAVAILABLE\)\{[\s\S]{0,1400}?return;\s*\}\s*\n\s*if\(!FACILITIES_ONLY\)/.test(src)) {
  failures.push('the unavailable note does not take precedence over the facilities-only note');
}
// THE REJECTED CAUSAL CLAIM: the note must not say anything about what happened at THIS page's
// last update. "could not be reached when this page was last updated" was true of the 486 pages
// refreshed 2026-08-09 (EPA failed 486 of 486 that day) and FALSE of the older zero cohorts — EPA
// answered for 1,978 of 2,133 pages on 08-07 and 9,005 of 10,086 on 08-08. With the flag extended
// to all 1,722, per-page causal wording would be a false explanation replacing a false zero.
{
  const note = (src.match(/if\(FAC_UNAVAILABLE\)\{([\s\S]*?)return;\s*\}/) || [])[1] || '';
  if (!note) {
    failures.push('could not locate the FAC_UNAVAILABLE note block — the wording guard did not run, '
      + 'which is not the same as passing');
  } else if (/last updated?/i.test(note)) {
    failures.push('the unavailable note makes a claim about this page\'s last update; only "FRS is '
      + 'unreachable now, so the count cannot be confirmed" is true of all 1,722 flagged pages');
  }
}

// THE REJECTED INFERENCE: nothing may conclude "outage" from a zero count.
if (/FAC_UNAVAILABLE\s*=\s*[^;]*facilities\s*===?\s*0/.test(src)
    || /FAC_UNAVAILABLE\s*=\s*[^;]*facCount\s*===?\s*0/.test(src)) {
  failures.push('FAC_UNAVAILABLE is being inferred from a zero count — explicitly rejected, because '
    + 'genuinely-empty rural ZIPs (84022 Dugway, 84034 Ibapah, 84083 Wendover, 84313 Grouse Creek) '
    + 'are CORRECT zeros and must keep rendering 0');
}

// COMMUNITY ZIP STRIP — same honesty rule as Map 1. The tile used to print the
// materializer's component score even when the overlay was unknown, so a refused
// EPA read with no stored markers read as "0 Regulated facilities".
if (!/var facTotal = metaCount\('regulated facilities', facilities\.length\);/.test(community)) {
  failures.push('community-page no longer computes facTotal from the facility plane');
}
if (!/cov\.facilities_unavailable === true/.test(community)
    || !/cov\.regulatory_overlay_state === 'overlay_unknown'/.test(community)) {
  failures.push('community-page does not treat facilities_unavailable / overlay_unknown as unknown');
}
if (!/var facTile = facDated \? facTotal : \(facUnknown \? '\\u2014' : facTotal\)/.test(community)
    || !/statTile\(facTile, facLabel, ''\)/.test(community)
    || !/HS\.facilityCount\(\{ unavailable: true, count: facTotal, confirmedAt: cov\.facilities_refreshed_at \}\)/.test(community)) {
  failures.push('community-page strip does not render an em-dash when the EPA read failed');
}
if (/facUnknown\s*=\s*[^;]*facTotal\s*===?\s*0/.test(community)
    || /facUnknown\s*=\s*[^;]*facCount\s*===?\s*0/.test(community)) {
  failures.push('community-page infers unknown from a zero count — rural empties must keep 0');
}

// HS.facilityCount, behaviourally: run the shipped lib/templates.js.
{
  const vm = await import('node:vm');
  const win = {};
  const ctx = vm.createContext({ window: win, document: undefined, console });
  vm.runInContext(readFileSync(join(root, 'lib/templates.js'), 'utf8'), ctx);
  const fc = win.HS && win.HS.facilityCount;
  if (typeof fc !== 'function') {
    failures.push('HS.facilityCount is not defined by lib/templates.js — the behaviour checks did not run');
  } else {
    const at = '2026-09-14T12:00:00Z';
    const cases = [
      [{ unavailable: false, count: 7, confirmedAt: at }, 'known', 7],
      [{ unavailable: false, count: 0, confirmedAt: at }, 'known', 0],           // rural true zero
      [{ unavailable: true, count: 12, confirmedAt: at }, 'dated', 12],
      [{ unavailable: true, count: 0, confirmedAt: at }, 'unknown', null],       // never a confirmed zero
      [{ unavailable: true, count: 12, confirmedAt: null }, 'unknown', null],   // no clock, no date
      [{ unavailable: true, count: 12, confirmedAt: 'not a date' }, 'unknown', null],
    ];
    for (const [input, mode, count] of cases) {
      const r = fc(input);
      if (r.mode !== mode || r.count !== count) {
        failures.push(`HS.facilityCount(${JSON.stringify(input)}) -> ${JSON.stringify(r)}, want ${mode}/${count}`);
      }
    }
    const d = fc({ unavailable: true, count: 3, confirmedAt: at });
    if (!/Sep 14, 2026/.test(d.confirmedOn)) failures.push(`dated confirmedOn reads "${d.confirmedOn}"`);
  }
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('facilities-unavailable: em-dash + note driven by the server flag alone; '
  + 'zero-count inference absent; note takes precedence; community strip matches.');
