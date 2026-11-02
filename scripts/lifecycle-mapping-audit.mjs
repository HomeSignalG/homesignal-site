#!/usr/bin/env node
// THE GENERATED STATUS-MAPPING AUDIT (release gate item 1, docs/lifecycle-classification-audit-2026-11-01.md §10).
//
// REPORT-ONLY. It reads supabase/functions/get-address-report/jurisdiction-registry.json and writes a PROPOSAL for
// review: for every registry entry and every verbatim status it maps today, the old bucket and column beside a
// proposed national stage, activity and column. Nothing reads its output; no registry value is changed.
//
// WHAT A ROW IS. A proposal from ordered wording rules (RULES below), each row naming the rule that fired, so a
// reviewer can see why. A rule is a LEAD, not a classification (claims rule 1): every row whose meaning depends on
// agency documentation (founder decisions D5, D8) or on the individual record (D1 pre-application identification, D3
// completed work type) is marked for adjudication, and its documentation receipt reads "none on file". The sandbox
// that wrote this cannot reach agency websites, so no receipt was gathered; none is implied.
//
// THE COLUMN RULE IS NOT RESTATED HERE. Columns come from lib/project-type.js HS.recordLifecycle.stageColumn, the
// one stage-to-column rule.
//
// FINGERPRINT (claims rules 7-9). The set of (registry_id, status) pairs in the output is fingerprinted against the
// same set read from the registry, sorted in JavaScript (codepoint order, no database collation involved). The run
// refuses to write if they differ.
//
// Usage:
//   node scripts/lifecycle-mapping-audit.mjs           write docs/lifecycle-mapping-audit/{mapping.csv,summary.md}
//   node scripts/lifecycle-mapping-audit.mjs --check   exit 1 if the committed files are not what this would write
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'supabase/functions/get-address-report/jurisdiction-registry.json';
const OUT_DIR = 'docs/lifecycle-mapping-audit';
const PLATFORMS = ['socrata', 'arcgis', 'ckan', 'csv', 'carto'];
const BUCKETS = ['proposed', 'approved', 'operating', 'denied', 'withdrawn', 'exclude'];

// The one vocabulary, loaded the way every test loads it.
function loadVocabulary() {
  const win = { HS: {} };
  new Function('window', 'document', readFileSync(join(root, 'lib/project-type.js'), 'utf8'))(win, undefined);
  if (!win.HS.recordLifecycle) throw new Error('lib/project-type.js did not define HS.recordLifecycle');
  return win.HS.recordLifecycle;
}

// ── Record class: a PROPOSAL from the registry id's own words, always marked for review ─────────
// Order matters: the most specific words first.
const CLASS_RULES = [
  ['preliminary_contact', /neighborhood-contact|prelim/],
  ['zoning_change', /zoning|rezon/],
  ['subdivision_plat', /subdivision|plat/],
  ['special_use_permit', /special-use|specific-use|conditional-use/],
  ['environmental_review', /sepa|environmental|ecology/],
  ['demolition_permit', /demolition|asbestos/],
  ['transport_project', /dot-|-dot\b|dot$|stip|\btip\b|tip-|highway|transport|road|construction-program|capital-projects|work-zone|bid-projects|project-locations|syip|ardot|mdot|vtrans|massdot|penndot|caltrans|kytc|kdot|nysdot|txdot|udot|nvdot|fdot|wsdot|adot|itd-|wydot|ncdot|nddot|okdot|mndot|ctdot|nhdot|akdot|aldot|hdot|georgia-dot|maine-dot|iowa-dot|oregon-dot|tennessee-dot|scdot|odot|wisdot|idot|mt-mdt|sd-stip|ndot/],
  ['land_use_application', /planning|land-use|land-dev|cases|site-plan|development-orders|projects|plan-review|board-actions|major-developments|act247|proposals|development-sites/],
  ['building_permit', /permit|building|construction|bldg/],
];
function proposeClass(id) {
  for (const [cls, re] of CLASS_RULES) if (re.test(id)) return { cls, basis: 'registry_id words: ' + re.source.slice(0, 40) };
  return { cls: 'unclassified', basis: 'no registry_id word matched' };
}

// ── Status wording rules, first match wins. Each returns {stage, activity, category?, flag?} ─────
// flag values: 'receipt' (needs agency documentation, D5/D8), 'per_record' (decided per record, D1/D3),
// 'review' (wording alone is not enough; a person decides).
const ENTITLEMENT = new Set(['preliminary_contact', 'land_use_application', 'zoning_change', 'subdivision_plat',
  'special_use_permit', 'environmental_review']);
const RULES = [
  // Values that are bucket names, not publisher terms (status_const "approved", "operating", "proposed").
  ['R00 bucket name used as a dataset-wide constant, no publisher term', (s, raw, cls, isConst) => isConst && /^(approved|operating|proposed)$/.test(raw),
    () => ({ stage: 'not_established', activity: 'active', flag: 'review' })],
  ['R01 documented data error (self-describing)', (s) => /issued in error|duplicate|\btest\b|template|deleted|not required|exempt|out of jurisdiction|never completed application|saved application|different permit type required|screened out|0\. not submitted/.test(s),
    () => ({ stage: 'invalid_record', activity: 'active' })],
  // Only true codes: digits, a single letter, or an underscore / slash code. A short WORD ("On Hold", "Revoked",
  // "Adopted") is not a code and goes to the wording rules below.
  ['R02 opaque code (D8)', (s, raw) => /^\d+$/.test(raw) || /^[a-z]$/.test(raw) || /^[a-z0-9]+(_[a-z0-9]+)+$/.test(raw) && !/^\d+_[a-z]/.test(raw) || /^[a-z]{1,3}\/[a-z]+$/.test(raw),
    () => ({ stage: 'not_established', activity: 'undetermined', flag: 'receipt' })],
  ['R02b negated wording ("Not Issued", "Not Applicable")', (s) => /\bnot\b|\bnon-|\bunk\b/.test(s),
    () => ({ stage: 'not_established', activity: 'undetermined', flag: 'review' })],
  ['R03 withdrawn', (s) => /withdr/.test(s) && !/void/.test(s), () => ({ stage: null, activity: 'inactive', category: 'withdrawn' })],
  ['R04 denied / disapproved', (s) => /\bdenied\b|disapprov|\brefused\b|\brejected\b/.test(s), () => ({ stage: null, activity: 'inactive', category: 'denied' })],
  ['R05 expired / lapsed', (s) => /expir|\blapsed\b/.test(s), () => ({ stage: null, activity: 'inactive', category: 'expired' })],
  ['R06 cancelled', (s) => /cancel/.test(s), () => ({ stage: null, activity: 'inactive', category: 'cancelled' })],
  ['R07 void / revoked / aborted / abandoned / terminated / rescinded / vacated / dismissed (D8)',
    (s) => /\bvoid|revok|abort|abandon|terminat|rescind|vacat|dismiss|replaced|transferred|no show|not eligible|disabled|deferred|retired/.test(s),
    () => ({ stage: null, activity: 'undetermined', flag: 'receipt' })],
  ['R08 paused: hold / suspended / stop work / dormant (D6)', (s) => /\bhold\b|suspend|stop work|stopped|paused|dormant|referred to legal|violation|enforcement/.test(s),
    () => ({ stage: null, activity: 'paused' })],
  ['R09 closed / inactive / archived without a stated reason (D5)',
    (s) => /\bclosed?\b|inactive|archive|historical import|legacy projects|unknown|\bother\b|annex|refund|monitoring|annual/.test(s) && !/complete|final|finaled|\bc of o\b|\bco\b|occupancy|denied|warranty/.test(s),
    () => ({ stage: 'closed_unspecified', activity: 'undetermined', flag: 'receipt' })],
  ['R09b decision issued, outcome not stated', (s) => /decision issued|board action|decision rendered/.test(s),
    () => ({ stage: 'not_established', activity: 'undetermined', flag: 'review' })],
  // Completion words on an ENTITLEMENT record mean the case is finished, not that anything was built (D5).
  ['R09c case completed on a land-use record (D5)', (s, raw, cls) => ENTITLEMENT.has(cls)
      && /complet|final|finaled|done/.test(s) && !/incomplete|completeness|pending|awaiting|review/.test(s),
    () => ({ stage: 'closed_unspecified', activity: 'undetermined', flag: 'receipt' })],
  ['R10 pre-application / consultation (D1)', (s) => /pre-?app|consultation|neighborhood contact|pre-?screen|pre-development|preliminary plan|applicant contacted|meeting (required|scheduled)/.test(s) && !/precon/.test(s),
    () => ({ stage: 'preliminary_identified|preliminary_unidentified', activity: 'active', flag: 'per_record' })],
  ['R11 recommendation, not a decision', (s) => /recommend/.test(s), () => ({ stage: 'under_review', activity: 'active' })],
  ['R12 programmed / planned / funded transport or capital work',
    (s) => /program|stip\b|\btip\b|funding|planned|planning|long range|scoping|concept|^pe$|ps&e|design|initiate|procurement|ready to let|letting|not yet advertised|proposed improvement|region review|central review/.test(s),
    () => ({ stage: 'programmed', activity: 'active' })],
  ['R13 completion (operation vs completed work decided per record, D3)',
    (s) => !/incomplete|completeness|application|review|submittal|billing|staff report|finalization|pending|awaiting|administratively|technically complete/.test(s) && /final|complet|compl\b|temporary co\b|cofo|\bc of o\b|\bco issued|\bco final|cond\. co|certificate of|\btco\b|signed-off|\bdone\b|in service|operations and maint|operationally complete|warranty|close ?out|closed out|substantially|constructed|demolished|in compliance|meter release|project closed|ready to close|waiting financial closure|monitoring funds|\bc of c\b|\bcc issued|\btcc\b|bu complete|record complete|final release/.test(s),
    () => ({ stage: 'operation_established|work_completed', activity: 'active', flag: 'per_record' })],
  ['R14 construction under way / inspections / awarded or advertised contract',
    (s) => /under construction|construction started|construction phase|^construction|05_construction|phased construction|inspection (in progress|phase)|inspections?$|inspecting|inspection followup|site inspection|work in progress|underway|under way|awarded|advertised|execute|\bactive\b.*issued|issued.*\bactive\b|open-active|permit issued \/ construction/.test(s) && !/review|program/.test(s),
    () => ({ stage: 'under_construction', activity: 'active' })],
  ['R14b inspection pending or required (issued, work not shown to have started)',
    (s) => /inspect/.test(s), () => ({ stage: 'under_construction', activity: 'active', flag: 'review' })],
  ['R15 permit approved or issued', (s, raw, cls) => !ENTITLEMENT.has(cls)
      && (/^issued/.test(s) || !/pending|waiting|awaiting|\bin for\b|pre-|delayed/.test(s))
      && /issued|issuance|ready to issue|to be issued|approv|released to permitting|precon|plan review complete|review complete|co pending/.test(s),
    () => ({ stage: 'permitted', activity: 'active' })],
  ['R16 entitlement approved / recorded / in force', (s, raw, cls) => ENTITLEMENT.has(cls) && !/pending|waiting|awaiting|\bin for\b|pre-/.test(s) && /approv|granted|recorded|adopted|in force|permanent|exercised|conforming|released|action form completed/.test(s),
    () => ({ stage: 'entitled', activity: 'active' })],
  ['R17 filed / submitted / received / intake', (s) => /submitted|intake|received|applied|application|filed|check-in|saved/.test(s),
    () => ({ stage: 'filed', activity: 'active' })],
  ['R18 under review / pending / scheduled / hearing', (s) => /review|pending|scheduled|hearing|notice|notification|assigned|process|incomplete|awaiting|waiting|out to applicant|postponed|routing|re-?submit|revision|additional info|request for info|rfai|action needed|changes required|submittal required|correction|fees due|active planning|plan check|case|reading|update|draft|screening|findings|continued|approval pending|in for approval|pending/.test(s),
    () => ({ stage: 'under_review', activity: 'active' })],
  ['R19 bare "Active" / "Open" on a permit (stage not stated)', (s) => /^(active|open)$/.test(s),
    () => ({ stage: 'not_established', activity: 'active', flag: 'review' })],
];
function proposeStatus(raw, cls, isConst) {
  // A leading phase number ("05_Construction", "4. READY") is removed first, as national-report.ts normaliseStage does.
  const s = String(raw).toLowerCase().replace(/\s+/g, ' ').trim().replace(/^\d+\s*[._)-]\s*/, '').trim();
  for (const [id, test, out] of RULES) {
    if (test(s, String(raw).trim().toLowerCase(), cls, isConst)) return { rule: id, ...out() };
  }
  return { rule: 'R99 no rule matched', stage: 'not_established', activity: 'undetermined', flag: 'review' };
}

// What the old engine did with a bucket, as a column (or a drop).
function oldColumn(bucket) {
  if (bucket === 'proposed' || bucket === 'approved' || bucket === 'operating') return bucket;
  if (bucket === 'denied' || bucket === 'withdrawn') return 'proposed (decision notation)';
  if (bucket === 'exclude') return 'dropped';
  return 'unmapped';
}

// The new column: an active stage maps through the one rule; a per-record split lists both outcomes; a non-active
// record keeps its historical column, which is decided per record by the evidence ladder (§4.4 item 2).
function newColumn(L, cls, p) {
  if (p.stage === 'invalid_record') return 'not shown';
  // D5: an undefined "Closed" is Lifecycle unknown outright (plan §4.4 item 3b), never a kept historical column.
  if (p.stage === 'closed_unspecified') return L.stageColumn(cls, p.stage, null) || 'not shown';
  if (p.activity !== 'active') return 'historical column (per record: observed > term > class_entry, else unknown)';
  if (String(p.stage).includes('|')) {
    const outs = [...new Set(p.stage.split('|').map((st) => L.stageColumn(cls, st, null) || 'not shown'))];
    return outs.join(' or ') + (p.stage.startsWith('operation') ? ' (work_completed keeps an observed column)' : '');
  }
  return L.stageColumn(cls, p.stage, null) || 'not shown';
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function build() {
  const L = loadVocabulary();
  const reg = JSON.parse(readFileSync(join(root, REGISTRY), 'utf8'));
  const entries = [];
  for (const p of PLATFORMS) for (const e of reg[p] || []) entries.push({ platform: p, e });
  entries.sort((a, b) => (a.e.registry_id < b.e.registry_id ? -1 : a.e.registry_id > b.e.registry_id ? 1 : 0));

  const rows = [];
  const sourcePairs = [];
  const entrySummaries = [];
  for (const { platform, e } of entries) {
    const id = e.registry_id;
    const { cls, basis } = proposeClass(id);
    const values = [];
    for (const b of BUCKETS) for (const v of (e.status_to_bucket || {})[b] || []) values.push([v, b]);
    // A constant that is not itself in the map is still the status every record carries.
    if (e.status_const && !values.some(([v]) => v.toLowerCase() === String(e.status_const).toLowerCase())) {
      values.push([e.status_const, e.platform === 'socrata' || ['proposed', 'approved', 'operating'].includes(e.status_const) ? e.status_const : 'UNMAPPED']);
    }
    // Entry stage proposal (class_entry rung): only where the registry itself already documents the dataset as an
    // issuance ledger (status_const + file_date_kind "issued", the §7.12a basis). Every other entry needs a receipt.
    const issuance = !!e.status_const && e.file_date_kind === 'issued';
    const entryStage = issuance ? 'permitted' : '';
    const entryBasis = issuance ? 'registry: status_const + file_date_kind=issued (issuance ledger)' : 'none on file';
    let changed = 0;
    for (const [status, bucket] of values) {
      sourcePairs.push(id + '\t' + status);
      const isConst = !!e.status_const && String(e.status_const) === String(status);
      const p = proposeStatus(status, cls, isConst);
      // A bucket-name constant on a registry-declared issuance ledger is the founder's §7.12a ruling (an issued
      // permit is Approved): the dataset's own definition guarantees the stage, so it is not a guess.
      if (p.rule.startsWith('R00') && issuance) {
        p.rule = 'R00a issuance-ledger constant (registry: file_date_kind=issued, §7.12a)'; p.stage = 'permitted'; delete p.flag;
      }
      const oc = oldColumn(bucket);
      const nc = newColumn(L, cls, p);
      const moves = oc !== nc && !(oc.startsWith('proposed (decision') && p.activity === 'inactive');
      // Any value that would move a record to an EARLIER column is flagged for review whatever rule fired.
      const ORDER = { proposed: 1, approved: 2, operating: 3 };
      if (p.activity === 'active' && ORDER[oc] && ORDER[nc] && ORDER[nc] < ORDER[oc] && !p.flag) p.flag = 'review';
      if (moves) changed++;
      rows.push({
        registry_id: id, platform, record_class_proposed: cls, class_basis: basis,
        status, old_bucket: bucket, old_column: oc,
        proposed_stage: p.stage || '', proposed_activity: p.activity, inactive_category: p.category || '',
        proposed_column: nc, column_changes: moves ? 'yes' : 'no',
        rule: p.rule, needs: p.flag || '',
        documentation_receipt: p.flag === 'receipt' ? 'none on file' : '',
        entry_stage_proposed: entryStage, entry_stage_basis: entryBasis,
      });
    }
    entrySummaries.push({ id, cls, values: values.length, changed });
  }

  // Fingerprint the pairs: output vs registry, codepoint-sorted on both sides.
  const outPairs = rows.map((r) => r.registry_id + '\t' + r.status);
  const fp = (arr) => createHash('md5').update([...arr].sort().join('\n')).digest('hex');
  const fpOut = fp(outPairs), fpSrc = fp(sourcePairs);
  if (fpOut !== fpSrc || outPairs.length !== sourcePairs.length) {
    throw new Error(`fingerprint mismatch: output ${outPairs.length}/${fpOut} vs registry ${sourcePairs.length}/${fpSrc}`);
  }

  const cols = Object.keys(rows[0]);
  const csv = cols.join(',') + '\n' + rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n') + '\n';

  // Summary counts.
  const count = (f) => { const m = new Map(); for (const r of rows) { const k = f(r); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
  const tbl = (pairs, h1, h2) => `| ${h1} | ${h2} |\n|---|---:|\n` + pairs.map(([k, v]) => `| ${k} | ${v} |`).join('\n');
  const transitions = count((r) => `${r.old_column} → ${r.proposed_column}`);
  const needs = count((r) => r.needs || '(none)');
  const rules = count((r) => r.rule);
  const classes = count((r) => r.record_class_proposed);
  const opToOther = rows.filter((r) => r.old_column === 'operating' && !/operating/.test(r.proposed_column));
  const droppedNowShown = rows.filter((r) => r.old_column === 'dropped' && r.proposed_column !== 'not shown');
  const summary = `# Generated status-mapping audit (release gate item 1)

Generated by \`scripts/lifecycle-mapping-audit.mjs\` from \`${REGISTRY}\`. **A proposal for review: nothing reads
it, and no registry value has changed.** Plan: \`docs/lifecycle-classification-audit-2026-11-01.md\` §10.

**What this is not:** a record count. These are registry status VALUES (one row per source and verbatim status). How
many records each value carries, and the before/after counts per ZIP, are gate item 2, measured separately on a
replica of production.

## Integrity

- Registry entries: ${entries.length}
- (registry_id, status) pairs: ${rows.length}, fingerprint \`${fpOut}\` (md5 over the codepoint-sorted pairs), equal
  on the registry side and the output side, so no value was lost or invented.
- Values whose column would change: ${rows.filter((r) => r.column_changes === 'yes').length}

## What needs a decision before anything is enabled

${tbl(needs, 'needs', 'values')}

- **receipt**: the meaning depends on the agency's own documentation (founder decisions D5, D8). No receipt is on
  file for any of them: this audit was generated without access to agency websites. Until a receipt exists, the
  value maps to Lifecycle unknown / undetermined.
- **per_record**: decided record by record (D1 pre-application identification; D3 completed work vs operation, from
  the record's own work type).
- **review**: the wording alone does not establish a stage.

## Old column → proposed column

${tbl(transitions, 'transition', 'values')}

Of the ${rows.filter((r) => r.old_column === 'operating').length} values that reach Operating now today,
${opToOther.length} no longer reach it on wording alone. Of the ${rows.filter((r) => r.old_column === 'dropped').length}
values dropped today, ${droppedNowShown.length} would be kept (inactive, paused or undetermined).

## Proposed record class (from registry id words; every one needs review)

${tbl(classes, 'class', 'values')}

## Rules that fired

${tbl(rules, 'rule', 'values')}

## Entry stage (the class_entry rung)

${entries.filter(({ e }) => !!e.status_const && e.file_date_kind === 'issued').length} entries are issuance ledgers by the
registry's own declaration (status_const with file_date_kind "issued"), so an inactive record from them can be placed
in Approved. Every other entry has no entry stage on file; founder rule: generic dataset membership never establishes
an earlier stage.
`;
  return { csv, summary, fp: fpOut, rows: rows.length, entries: entries.length };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { csv, summary, fp, rows, entries } = build();
  const files = [[join(OUT_DIR, 'mapping.csv'), csv], [join(OUT_DIR, 'summary.md'), summary]];
  if (process.argv.includes('--check')) {
    let bad = 0;
    for (const [p, want] of files) {
      const have = existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null;
      if (have !== want) { console.error('STALE: ' + p + ' is not what the generator writes'); bad++; }
    }
    if (bad) process.exit(1);
    console.log(`OK: ${rows} values from ${entries} entries, fingerprint ${fp}`);
  } else {
    mkdirSync(join(root, OUT_DIR), { recursive: true });
    for (const [p, c] of files) writeFileSync(join(root, p), c);
    console.log(`wrote ${OUT_DIR}: ${rows} values from ${entries} entries, fingerprint ${fp}`);
  }
}
