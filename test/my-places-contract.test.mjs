// MY PLACES — the A-002 / A-010 / A-012 contract, and the A-011 / A-013 boundary.
//
// WHY THIS FILE EXISTS. Phase 4 turned properties.html into the single management
// container for two DIFFERENT Place types that live in two DIFFERENT stores:
//   Address  -> app_properties   (the Census-confirmed home writer)
//   ZIP Code -> app_follows      (HS.followedCommunities / myCommunities)
// The whole risk of this phase is that a later edit quietly collapses them — one blended
// card type, a generic "+ Add a Place", or a ZIP row written into app_properties. Each of
// those would look tidier and would silently destroy the type distinction A-002 locks.
//
// Every check below runs on a COMMENT-STRIPPED copy. Three separate assertions in this
// repo have already gone green off a code comment that mentioned the very string it
// forbids; a comment explaining why something is absent must not be able to satisfy a
// check that it is absent.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
  + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 200) : '')); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const props = strip(read('properties.html'));
const prop  = strip(read('property.html'));
const dash  = strip(read('dashboard.html'));
const shell = strip(read('shell.js'));
const shellHtml = strip(read('partials/shell.html'));
const cpage = strip(read('lib/community-page.js'));

// ---- A-002 vocabulary: Place / Address / ZIP Code on LOGGED-IN management surfaces ----
ok(/>My Places</.test(props) && /HomeSignal — My Places/.test(props),
  'A-002 properties.html is My Places (eyebrow/H1/title)');
for (const [f, body] of [['properties.html', props], ['property.html', prop],
                         ['dashboard.html', dash], ['partials/shell.html', shellHtml]])
  ok(!/Saved Place/.test(body), 'A-002 "Saved Place(s)" is gone from ' + f, (body.match(/.{0,40}Saved Place.{0,40}/) || [])[0]);
// Residents follow ZIP codes, not communities — the public ZIP page and the loc-modal
// use the same ZIP-code vocabulary as Dashboard / My Places.
ok(cpage.includes('＋ Follow this zip code') && /Your zip codes/.test(cpage),
  'A-002 public ZIP Follow copy and followed-list heading say zip code');
ok(/Your zip code/.test(shellHtml) && /Change your zip code/.test(shellHtml),
  'A-002 the loc-modal acquisition copy says zip code');
ok(!/Follow this community/.test(cpage) && !/Your communities/.test(cpage),
  'A-002 the public ZIP page no longer calls a ZIP a community');
ok(!/Change your community/.test(shellHtml) && !/Find my community/.test(shellHtml),
  'A-002 the loc-modal no longer calls a ZIP a community');
ok(/No zip codes yet\./.test(shell) && !/No communities yet\./.test(shell),
  'A-002 the ZIP follow-strip empty state says zip codes');

// ---- A-010: three views, two distinct primary actions, no generic add -------------------
for (const v of ['data-view="all"', 'data-view="addresses"', 'data-view="zips"'])
  ok(props.includes(v), 'A-010 My Places has view ' + v);
ok(/id="plAddAddress"[^>]*>\+ Add Address</.test(props), 'A-010 primary action "+ Add Address"');
ok(/id="plAddZip"[^>]*>\+ Add ZIP Code</.test(props), 'A-010 primary action "+ Add ZIP Code"');
ok(!/\+ Add a Place\b/.test(props) && !/\+ Add a Place\b/.test(dash) && !/\+ Add a Place\b/.test(shellHtml),
  'A-010 no generic "+ Add a Place"');
// the two adds must reuse the EXISTING workflows, not introduce second writers
ok(/plAddAddress'\)\.addEventListener\('click', function \(\) \{ HS\.addHome\(\); \}\)/.test(props),
  'A-010 "+ Add Address" reuses the existing HS.addHome Census flow');
ok(/plAddZip'\)\.addEventListener\('click', function \(\) \{ HS\.openLoc\(\); \}\)/.test(props),
  'A-010 "+ Add ZIP Code" reuses the existing HS.openLoc follow flow');
// the two TYPES must come from their two EXISTING stores
ok(/S\.properties/.test(props) && /HS\.followedCommunities/.test(props),
  'A-010 Addresses come from app_properties and ZIP Codes from followedCommunities');
ok(!/from\('app_properties'\)[\s\S]{0,200}?target_type/.test(shell),
  'A-010 a ZIP Code is never written into app_properties');

// ---- Viewing chip: the same two types, the same two adds, on every page --------
// The chip used to open an Address-only list titled "Switch zip code", so a
// resident with 3 ZIP Codes and 0 Addresses was told they follow 0 places.
ok(/id="switcherTitle">Switch place</.test(shellHtml),
  'A-010 Viewing chip title is Switch place');
ok(!/Switch zip code/.test(shellHtml) && !/Switch property/.test(shellHtml),
  'A-010 switcher title is not zip-only or property-only');
ok(/id="switcherAddAddress"[\s\S]{0,160}HS\.addHome\(\)/.test(shellHtml),
  'A-010 switcher "+ Add Address" reuses HS.addHome');
ok(/id="switcherAddZip"[\s\S]{0,160}HS\.openLoc\(\)/.test(shellHtml),
  'A-010 switcher "+ Add ZIP Code" reuses HS.openLoc');
ok(!/\+ Add a Place\b/.test(shellHtml) && !/\+ Add a Place\b/.test(shell),
  'A-010 switcher has no generic "+ Add a Place"');
const switcherFn = (shell.match(/HS\.openSwitcher = function \(\) \{[\s\S]*?\n  \};/) || [''])[0];
ok(switcherFn.length > 200, 'A-010 openSwitcher body was found for contract pins');
ok(/followedCommunities/.test(switcherFn) && /state\.properties/.test(switcherFn),
  'A-010 openSwitcher reads Addresses AND followed ZIP Codes');
ok(/Addresses \(/.test(switcherFn) && /ZIP Codes \(/.test(switcherFn),
  'A-010 switcher lists the two types in labeled sections');
ok(!/You're following/.test(switcherFn),
  'A-010 switcher does not count Addresses as "followed" places');
ok(/HS\.switchZip = function/.test(shell), 'A-010 HS.switchZip focuses a followed ZIP');
ok(!/from\('app_properties'\)/.test((shell.match(/HS\.switchZip = function[\s\S]*?\n  \};/) || ['x'])[0]),
  'A-010 switchZip never writes an Address row');

// ---- A-012: Remove Address exists, is scoped, and takes nothing else --------------------
ok(/HS\.removeAddress = async function/.test(shell), 'A-012 HS.removeAddress exists');
ok(/from\('app_properties'\)\s*\n?\s*\.delete\(\)\s*\n?\s*\.match\(\{ id: id, user_id: state\.session\.user\.id \}\)/.test(shell),
  'A-012 the delete is scoped to BOTH the row id and the owning user_id');
for (const t of ['alerts', 'app_changes', 'app_projects', 'app_follows']) {
  const re = new RegExp("removeAddress[\\s\\S]{0,1200}?from\\('" + t + "'\\)[\\s\\S]{0,80}?delete");
  ok(!re.test(shell), 'A-012 removeAddress never deletes ' + t);
}
ok(/state\.session\.demo\) return false/.test(shell), 'A-012 a DEMO session is refused — sample homes are nobody\'s saved relationship');
ok(/data-act="remove-address"/.test(props) && /window\.confirm\(/.test(props),
  'A-012 Remove Address is a real control on My Places and requires confirmation');
ok(/data-act="unfollow-zip"/.test(props) && /HS\.unfollowCommunity/.test(props),
  'A-012 ZIP Unfollow is surfaced on My Places using the EXISTING unfollow');
ok(!/Remove Address/.test(prop), 'A-012 the property dossier did NOT get Remove Address bolted onto Watch');
ok(/Watch this property/.test(read('property.html')) && /Generate property report/.test(read('property.html')),
  'A-012 "Watch this property" and "Generate property report" are untouched');

// ---- A-011 / A-013 / DF boundary: absence, proven on stripped code ----------------------
const A013 = /text\/csv|\.csv\b|paste|bulk|mass[- ]add|<textarea/i;
const A011 = /quiet[- ]hours|per-place|manage monitoring|monitoring settings|cadence/i;
const DFX  = /folder|portfolio|add tag|tag[- ]edit|group[- ]by/i;
for (const [f, body] of [['properties.html', props], ['dashboard.html', dash], ['property.html', prop]]) {
  ok(!A013.test(body), 'A-013/DF-001 no bulk import surface in ' + f, (body.match(A013) || [])[0]);
  ok(!A011.test(body), 'A-011/DF-004 no per-Place monitoring surface in ' + f, (body.match(A011) || [])[0]);
  ok(!DFX.test(body),  'DEFERRED no folders/portfolios/tag editing in ' + f, (body.match(DFX) || [])[0]);
}
ok(!/type="search"|id="[^"]*[Ss]earch"|placeholder="[^"]*[Ss]earch/.test(props),
  'A-010 no search was invented on My Places');
ok(!/data-act="remove-address"|data-view="zips"|Add ZIP Code/.test(dash),
  'Dashboard stays a SUMMARY — no My Places management controls were added to it');

// ---- routes and identifiers are NOT renamed for terminology -----------------------------
ok(fs.existsSync(new URL('../properties.html', import.meta.url)), 'properties.html IS My Places — no my-places.html was created');
ok(!fs.existsSync(new URL('../my-places.html', import.meta.url)), 'no my-places.html route was created');
ok(/data-nav="props"/.test(read('partials/shell.html')), 'data-nav="props" is unchanged');
ok(/href="properties\.html"/.test(read('partials/shell.html')), 'the nav still points at properties.html');

console.log(fails ? '\n' + fails + ' failed' : '\nAll My Places contract assertions passed.');
process.exit(fails ? 1 : 0);
