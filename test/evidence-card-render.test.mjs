// PHASE 4 — evidence property card. Drives the SHIPPED renderer over payloads captured
// verbatim from the live public.ev_property_card() RPC.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Card = require(join(root, 'evidence-card.js'));
const fx = (n) => JSON.parse(readFileSync(join(root, 'fixtures/evidence-card', n), 'utf8'));
const travis = fx('travis-292354.json');
const denver = fx('denver-0015300060000.json');

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

const tHtml = Card.render(travis);
const dHtml = Card.render(denver);

ok(typeof Card.render === 'function' && tHtml.length > 500 && dHtml.length > 500,
  'renderer drives both live payloads (test is exercising shipped code)');

// ---- feature flag ----
ok(Card.render({ pilot_enabled: false }) === '', 'flag OFF renders nothing');
ok(Card.render({}) === '' && Card.render(null) === '', 'missing/absent payload renders nothing');
ok(Card.render({ pilot_enabled: true, found: false }) === '', 'pilot but no parcel renders nothing');

// ---- roles stay specific (§5) ----
ok(/Property owner of record/.test(tHtml), 'Travis shows the specific land role');
ok(/Project owner \(as filed\)/.test(tHtml), 'Travis shows the specific project role');
ok(/Grantor/.test(dHtml) && /Grantee/.test(dHtml), 'Denver shows grantor and grantee distinctly');
ok(!/>Owner</.test(tHtml) && !/>Owner</.test(dHtml), 'no bare generic "Owner" label anywhere');

// ---- the core product proof ----
ok(/River Bottoms Ranch LLC/.test(tHtml) && /Neuralink/.test(tHtml),
  'Travis renders landowner AND project filer');
const ownerIdx = tHtml.indexOf('Property owner of record');
const projIdx  = tHtml.indexOf('Project owner (as filed)');
ok(ownerIdx > -1 && projIdx > ownerIdx, 'landowner appears before/above project filer');

// ---- §6 Travis must NOT imply clerk verification ----
ok(!/Verified deed/i.test(tHtml), 'Travis never says "verified deed"');
ok(/not available through HomeSignal/i.test(tHtml), 'Travis explains the recorder gap');
ok(!/No deed records/i.test(tHtml) && !/no records/i.test(tHtml),
  'unavailable is never rendered as "no records" (§16)');
ok(/Parties not available from this source/.test(tHtml),
  'TCAD-reported references honestly show no parties');
ok(!/robots|ClaudeBot|403|Cloudflare/i.test(tHtml), 'no technical block details leak to the consumer');

// ---- §7/§17 Denver corroboration ----
ok(/Corroborated by independent county records/.test(dHtml), 'Denver shows corroboration');
ok(!/Corroborated/.test(tHtml), 'Travis does NOT claim corroboration');
ok(/Special Warranty Deed/.test(dHtml), 'document type is expanded to consumer language');
ok(/2026086843/.test(dHtml), 'reception number is shown');
ok(/Denver Health/i.test(dHtml) && /Green Valley Vistas/i.test(dHtml), 'both deed parties render');

// ---- §13 chronology must not overclaim ----
ok(/not a complete ownership history/i.test(dHtml), 'never claims a complete ownership chronology');
ok(!/owner from/i.test(dHtml), 'no invented ownership date ranges');

// ---- §8 no internal vocabulary leaks ----
for (const leak of ['authoritative_roll','official_secondary','source_reported','resolved_by_match',
                    'identifier_backed','property_owner_of_record','project_owner_as_filed',
                    'grantee_on_recorded_instrument','ev_claim','claim_id']) {
  ok(!tHtml.includes(leak) && !dHtml.includes(leak), `no internal token "${leak}" in rendered HTML`);
}
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
ok(!uuid.test(tHtml) && !uuid.test(dHtml), 'no UUID reaches the DOM');

// ---- §10 identifiers ----
ok(/TCAD Property ID/.test(tHtml) && /Denver Schedule Number/.test(dHtml),
  'each jurisdiction uses its own identifier term');
ok(!/\bAPN\b/.test(tHtml) && !/\bAPN\b/.test(dHtml), 'never labelled APN');
// secondary id is present but only inside the disclosure
const tMain = tHtml.split('<details')[0];
ok(!/0315600221/.test(tMain), 'secondary identifier stays out of the main card');

// ---- §11 acreage arbitration ----
ok(/36\.474/.test(tHtml), 'Travis shows the legal acreage');
ok(!tMain.includes('28.494'), 'the land-segment measurement never replaces it on the main card');
ok(/Other reported measurement/.test(tHtml), 'the alternate measurement is retained behind details');

// ---- §12 legal description behind disclosure ----
ok(!tMain.includes('ABS 18 NAVARRO'), 'legal description is not on the face of the card');
ok(/ABS 18 NAVARRO/.test(tHtml), 'legal description is still available in details');
const dMain = dHtml.split('<details')[0];
ok(!dMain.includes('S15/T3/R66'), "Denver's long metes-and-bounds never dominates the card");

// ---- §14 privacy ----
for (const p of ['3892 S GRAPE','PASEO PADRE','758-6679','@','mailing']) {
  ok(!tHtml.includes(p) && !dHtml.includes(p), `no private field "${p}" in rendered HTML`);
}

// ---- §18 disagreement contract ----
const disagree = JSON.parse(JSON.stringify(denver));
disagree.ownership.status = 'Records disagree';
disagree.ownership.status_kind = 'disagree';
const xHtml = Card.render(disagree);
ok(/Records disagree/.test(xHtml), 'disagreement state renders');
ok(/name different parties for the same period/.test(xHtml), 'disagreement is explained, not arbitrated');
ok(!/%|confidence|score/i.test(xHtml), 'no numeric confidence anywhere');
ok(/Green Valley Vistas/i.test(xHtml), 'competing records remain listed');

// ---- §24 accessibility ----
ok(/<details/.test(tHtml) && /<summary>/.test(tHtml), 'disclosures use native keyboard-accessible elements');
ok(/<h2/.test(tHtml) && /<h3/.test(tHtml), 'semantic heading order');
ok(/hs-ev-sr/.test(tHtml), 'status has a screen-reader label, not colour alone');
ok(/aria-hidden="true"/.test(tHtml), 'decorative icons are hidden from assistive tech');

// ---- §25 no source-logo clutter ----
ok(!/<img/.test(tHtml) && !/<img/.test(dHtml), 'no source logos on the card');

// ---- escaping ----
const xss = Card.render({ pilot_enabled: true, found: true,
  ownership: { owner: '<script>alert(1)</script>', role_label: 'Property owner of record', status: 'x', status_kind: 'reported' } });
ok(!/<script>alert/.test(xss), 'owner values are HTML-escaped');

process.exit(fails ? 1 : 0);
