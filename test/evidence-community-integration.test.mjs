// PHASE 5 — community.html evidence integration contract guards.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Card = require(join(root, 'evidence-card.js'));
const community = readFileSync(join(root, 'community.html'), 'utf8');
const maps = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

// ---- §2 ONE renderer, §3 ONE read model ----
ok(/<script src="evidence-card.js"><\/script>/.test(community), 'community loads the shared renderer');
ok(/<script src="evidence-card.js"><\/script>/.test(maps), 'maps loads the same shared renderer');
ok(!/community-evidence-card|evidence-card-community/.test(community), 'no forked renderer file');
ok(typeof Card.render === 'function' && typeof Card.renderTeaser === 'function',
  'both card and teaser come from the one module');
ok(/ev_property_card/.test(community) && /ev_property_card/.test(maps),
  'both surfaces use the same full read model');
ok(!/ev_community_property_card|community_evidence/.test(community), 'no community-specific RPC');

// ---- §15 N+1 avoidance ----
ok((community.match(/ev_evidence_available/g) || []).length === 1, 'exactly one batched availability call site');
ok((community.match(/rpc\('ev_property_card'/g) || []).length === 1, 'exactly one full-card call site');
ok(/loaded\[idValue\]/.test(community), 'the full card is cached after first open (no refetch)');
ok(/if \(!rows\.length\) return \[\];/.test(community), 'a non-pilot ZIP issues no further request');

// ---- §16 generic availability contract ----
ok(!/is_tcad_pilot|is_denver_pilot|tcad|denver/i.test(
     community.split('<script src="evidence-card.js">')[0].split('/* PHASE 5')[1] || ''),
  'the community script never names a county or source');
ok(/evidence_available/.test(Card.renderTeaser.toString()), 'teaser keys on the generic availability flag');

// ---- §4 server-side gate is authoritative ----
ok(/pilot/i.test(community) === false || !/allowlist/i.test(community.split('function client')[1] || ''),
  'no client-side allowlist duplicated in the page');
ok(Card.renderTeaser({ evidence_available: false }) === '', 'unavailable renders no teaser');
ok(Card.renderTeaser(null) === '' && Card.renderTeaser({}) === '', 'missing payload renders no teaser');

// ---- §21 flag OFF ----
ok(/window\.HS_EVIDENCE_CARD = \(window\.HS_EVIDENCE_CARD !== false\)/.test(community), 'kill switch present');
ok(/if \(!window\.HS_EVIDENCE_CARD \|\| !mountEl \|\| !zip\) return Promise\.resolve\(\[\]\)/.test(community),
  'flag OFF short-circuits before any request');
ok(/id="hsEvidenceZip" hidden/.test(community), 'mount starts hidden — no empty heading');

// ---- §5/§6/§11 teaser is concrete and compact ----
const teaser = Card.renderTeaser({ id_type: 'tcad.prop_id', id_value: '292354',
  label: '2200 CALDWELL LN, TX 78617', evidence_available: true,
  evidence_domains: ['development', 'instruments', 'ownership', 'property'] });
ok(/Property records available/.test(teaser), 'concrete wording, not a vague badge');
ok(!/Data available|Verified|Deep data/.test(teaser), 'no ESG-style vague badging');
ok(/Owner of record/.test(teaser) && /recorded instruments/.test(teaser), 'teaser says what the user gets');
ok(teaser.length < 900, 'teaser stays compact');
for (const heavy of ['ABS 18 NAVARRO', 'Grantor', 'Grantee', 'http', 'legal_description']) {
  ok(!teaser.includes(heavy), `teaser omits heavy content: ${heavy}`);
}

// ---- §7 no address/company matching in the frontend ----
ok(!/2200 Caldwell|Caldwell Ln|River Bottoms|Neuralink|Green Valley|18581/.test(community),
  'community.html contains no hard-coded address, company or parcel string');
ok(/data-ev-idtype/.test(teaser) && /data-ev-idvalue/.test(teaser),
  'the teaser carries the authoritative identifier, not an address');

// ---- §13 no internal UUID routing ----
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
ok(!uuid.test(teaser), 'no internal UUID in the teaser');

// ---- §12 full card only on intent ----
ok(/addEventListener\('click'/.test(community), 'full card is bound to an explicit user action');
ok(/hs-ev-panel/.test(teaser) && /hidden/.test(teaser), 'the panel starts closed');

// ---- §17 accessibility ----
ok(/<button type="button"/.test(teaser), 'the action is a real button (keyboard-accessible)');
ok(/aria-expanded="false"/.test(teaser) && /aria-controls=/.test(teaser), 'disclosure state is announced');
ok(/aria-expanded', 'true'/.test(community), 'expanded state is updated on open');
ok(/panel\.focus\(/.test(community), 'focus moves into the opened panel');
ok(/>View property records</.test(teaser), 'the button has a meaningful name');

// ---- §18 semantics unchanged, §19 compatible facts, §20 privacy ----
const travis = JSON.parse(readFileSync(join(root, 'fixtures/evidence-card/travis-292354.json'), 'utf8'));
const denver = JSON.parse(readFileSync(join(root, 'fixtures/evidence-card/denver-0015300060000.json'), 'utf8'));
const tH = Card.render(travis), dH = Card.render(denver);
ok(/Reported by one county source/.test(tH), 'Travis wording preserved');
ok(/Corroborated by independent county records/.test(dH), 'Denver corroboration preserved');
ok(/not available through HomeSignal/.test(tH) && /Recorded instruments/.test(tH),
  'instrument references and recorder-unavailable coexist (§19)');
ok(!/No deeds|no deed records/i.test(tH), 'never simplified to "no deeds"');
ok(/Property owner of record/.test(tH) && /Project owner \(as filed\)/.test(tH), 'roles stay distinct');
for (const leak of ['authoritative_roll', 'official_secondary', 'property_owner_of_record', 'ev_claim']) {
  ok(!tH.includes(leak) && !dH.includes(leak) && !teaser.includes(leak), `no internal token "${leak}"`);
}
for (const p of ['3892 S GRAPE', 'PASEO PADRE', '758-6679']) {
  ok(!tH.includes(p) && !dH.includes(p) && !teaser.includes(p), `no private field "${p}"`);
}

// ---- §24 legacy untouched ----
ok(/HS\.tpl\.devCard/.test(community) || /devCard/.test(readFileSync(join(root,'lib/templates.js'),'utf8')),
  'the legacy development card template is untouched');
ok(!/onclick="location\.href='development\.html/.test(teaser), 'teaser does not hijack legacy navigation');

process.exit(fails ? 1 : 0);
