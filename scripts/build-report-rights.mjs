#!/usr/bin/env node
// THE PAID-REPORT SOURCE LIST, GENERATED — never typed.
//
// supabase/functions/_shared/report-rights.json lists the source families a customer report may draw on. Under founder ruling R7
// (2026-10-04, docs/development-activity-founder-ruling-r7-2026-10-04.md) that is EVERY source in
// supabase/functions/get-address-report/jurisdiction-registry.json. A list of 240 ids that somebody typed is a list that can silently
// lose one (the ingest repo's rule 7 records a 188-uuid list that lost five), so this script derives both the JSON file and the
// "sources covered" block of the ruling from the registry, and `--check` (the default) fails if either differs by a byte.
//
//   node scripts/build-report-rights.mjs            check: exit 1 if the JSON file or the ruling's block differs from what the registry yields
//   node scripts/build-report-rights.mjs --write    rewrite both from the registry
//
// It reads two files and writes two: it makes no network call and touches no database.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RIGHTS_PATH = 'supabase/functions/_shared/report-rights.json';
export const REGISTRY_PATH = 'supabase/functions/get-address-report/jurisdiction-registry.json';
export const RULING_PATH = 'docs/development-activity-founder-ruling-r7-2026-10-04.md';
export const RULING_SECTION = 2;
export const CLEARED_ON = '2026-10-04';
export const VERSION = 2;
export const BEGIN = '<!-- BEGIN GENERATED SOURCES (scripts/build-report-rights.mjs) -->';
export const END = '<!-- END GENERATED SOURCES -->';

// The only credit lines HomeSignal knows a publisher REQUIRES, each from that publisher's own recorded terms. Every other source carries "" (no credit
// required that anyone has recorded; each record still links to its official source). Adding a line here needs the evidence file to say so.
export const PUBLISHER_ATTRIBUTION = {
  'nyc-dob-permit-issuance': {
    text: 'New York City Department of Buildings, via NYC Open Data (dataset ipu4-2q9a). HomeSignal selected and renamed fields.',
    evidence: 'docs/corporate-output-nyc-dob-permits-2026-09-27.md', dataset: 'ipu4-2q9a',
  },
  'nyc-dobnow-approved-permits': {
    text: 'New York City Department of Buildings, via NYC Open Data (dataset rbx6-tga4). HomeSignal selected and renamed fields.',
    evidence: 'docs/corporate-output-nyc-dob-permits-2026-09-27.md', dataset: 'rbx6-tga4',
  },
  'seattle-building-permits': {
    text: 'City of Seattle, Seattle Department of Construction & Inspections (data.seattle.gov, dataset 76t5-zqzr).',
    evidence: 'docs/corporate-output-seattle-building-permits-2026-09-27.md', dataset: '76t5-zqzr',
  },
};

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Every registry_id in the jurisdiction registry, sorted by code point (what Postgres `collate "C"` does), with a count so a lost entry is visible. */
export function registryIds() {
  const jr = JSON.parse(read(REGISTRY_PATH));
  const ids = [];
  for (const v of Object.values(jr)) if (Array.isArray(v)) for (const e of v) if (e && typeof e === 'object' && typeof e.registry_id === 'string') ids.push(e.registry_id);
  const unique = [...new Set(ids)].sort();
  if (unique.length !== ids.length) throw new Error('the jurisdiction registry repeats a registry_id (' + (ids.length - unique.length) + ' repeats)');
  return unique;
}

export const fingerprint = (ids) => createHash('md5').update(ids.join(',')).digest('hex');

export function build() {
  const ids = registryIds();
  const cleared = ids.map((id) => ({
    registry_id: id, cleared_on: CLEARED_ON, audit_ref: RULING_PATH + ' §' + RULING_SECTION,
    attribution: PUBLISHER_ATTRIBUTION[id] ? PUBLISHER_ATTRIBUTION[id].text : '',
  }));
  const head = {
    version: VERSION,
    authority: 'docs/corporate-output-source-rights-audit-2026-09-27.md',
    decision: RULING_PATH,
    rule: 'A source family (registry_id) may appear in a customer report only if it is listed under `cleared` with an audit reference. Unlisted means excluded. '
      + 'Founder ruling R7 (2026-10-04) lists EVERY source in jurisdiction-registry.json: that is the founder accepting the risk, NOT a publisher grant, and it does not change '
      + 'any classification in the rights audit (a HOLD finding stays a HOLD finding). Adding a source later is a recorded decision, never a default.',
    entry_shape: {
      registry_id: 'the source family exactly as app_projects.registry_id spells it; no wildcard',
      cleared_on: 'YYYY-MM-DD of the recorded clearance',
      audit_ref: 'where the clearance is recorded (file and section)',
      attribution: 'the credit line the report must carry, or an empty string if none is required',
    },
  };
  // the header is pretty-printed; each entry is ONE line, so a diff of this file reads one source per line
  const headText = JSON.stringify(head, null, 2).replace(/\n}$/, ',\n  "cleared": [\n');
  const lines = cleared.map((e) => '    ' + JSON.stringify(e).replace(/^\{"/, '{ "').replace(/,"/g, ', "').replace(/":"/g, '": "').replace(/":(\d)/g, '": $1').replace(/"\}$/, '" }'));
  const jsonText = headText + lines.join(',\n') + '\n  ]\n}\n';
  const block = [BEGIN, '',
    '`' + ids.length + '` sources, `' + RIGHTS_PATH + '` version ' + VERSION + ', cleared on ' + CLEARED_ON + '. Fingerprint: md5 of the ids joined with "," in code-point order = `' + fingerprint(ids) + '`.', '',
    ...ids.map((id) => '- `' + id + '`' + (PUBLISHER_ATTRIBUTION[id] ? ' — a publisher credit is required and carried: "' + PUBLISHER_ATTRIBUTION[id].text + '" (' + PUBLISHER_ATTRIBUTION[id].evidence + ')' : '')),
    '', END].join('\n');
  return { ids, cleared, jsonText, block };
}

/** The ruling file with its generated block replaced by `block` (the markers must each appear exactly once). */
export function withBlock(md, block) {
  const a = md.indexOf(BEGIN), b = md.indexOf(END);
  if (a < 0 || b < 0 || md.indexOf(BEGIN, a + 1) >= 0 || md.indexOf(END, b + 1) >= 0 || b < a) throw new Error('the ruling file must hold the generated-block markers exactly once, in order');
  return md.slice(0, a) + block + md.slice(b + END.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const write = process.argv.includes('--write');
  const { ids, jsonText, block } = build();
  const wantDoc = withBlock(read(RULING_PATH), block);
  const haveJson = read(RIGHTS_PATH), haveDoc = read(RULING_PATH);
  const same = haveJson === jsonText && haveDoc === wantDoc;
  if (write) {
    writeFileSync(join(ROOT, RIGHTS_PATH), jsonText); writeFileSync(join(ROOT, RULING_PATH), wantDoc);
    console.log('wrote ' + RIGHTS_PATH + ' and the generated block of ' + RULING_PATH + ': ' + ids.length + ' sources, md5 ' + fingerprint(ids));
  } else if (same) {
    console.log('OK — ' + RIGHTS_PATH + ' and the ruling\'s generated block equal what the registry yields: ' + ids.length + ' sources, md5 ' + fingerprint(ids));
  } else {
    console.error('DIFFERS — ' + (haveJson !== jsonText ? RIGHTS_PATH + ' ' : '') + (haveDoc !== wantDoc ? RULING_PATH + ' (generated block) ' : '') + 'is not what the registry yields. Run: node scripts/build-report-rights.mjs --write');
    process.exit(1);
  }
}
