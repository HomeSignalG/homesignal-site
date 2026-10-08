// WHERE A CARD OPENS AND WHAT KIND OF PAGE IT IS (founder, 2026-10-08). Run: node test/card-link-kinds.test.mjs
// Executes the SHIPPED lib/templates.js (not a regex over it) on real stored shapes and hostile inputs.
//  1. A dataset / data-feed link carries the "Source data" label, decided ONLY by the engine's own
//     provenance.url_precision. Absent or unknown precision = no label; nothing is guessed from the URL.
//  2. A weather-alert card never opens the raw api.weather.gov URL: it opens the NWS forecast page for its
//     ZIP, worded as that page; with no valid ZIP it is not a link at all.
//  3. The crawlable HTML (scripts/gen_zip_pages.py) uses the SAME host, page and wording.
import fs from 'node:fs';
import vm from 'node:vm';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' \u2014 ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const TPL = read('lib/templates.js');
const ctx = { URL, console }; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(TPL, ctx);
const T = ctx.HS.tpl;
const NWS = 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.08321fd30b417d90603e7decb34d3ae7044dfcf9.001.1';
const PAGE = 'https://forecast.weather.gov/zipcity.php?inputstring=';

// ── 1. recordHref ───────────────────────────────────────────────────────────────────────────
ok(T.recordHref({ source_ref: NWS, zip: '90620' }) === PAGE + '90620', '1a a stored NWS alert URL opens the NWS forecast page for the card\'s ZIP');
ok(T.recordHref({ source_ref: NWS }) === '', '1b no ZIP -> no link (never the raw API URL)');
ok(T.recordHref({ source_ref: NWS, zip: '9062' }) === '' && T.recordHref({ source_ref: NWS, zip: '90620&x=1' }) === ''
  && T.recordHref({ source_ref: NWS, zip: '../..' }) === '' && T.recordHref({ source_ref: NWS, zip: ' 906200' }) === '', '1c a malformed or injected ZIP never reaches the URL');
ok(T.recordHref({ source_ref: 'HTTPS://API.WEATHER.GOV/alerts/x', zip: '90620' }) === PAGE + '90620'
  && T.recordHref({ source_ref: 'https://user:pw@api.weather.gov/alerts/x', zip: '90620' }) === PAGE + '90620', '1d the host test is on the parsed host (case and credentials do not slip past it)');
ok(T.recordHref({ source_ref: 'https://api.weather.gov.evil.example/alerts/x', zip: '90620' }) === 'https://api.weather.gov.evil.example/alerts/x'
  && T.recordHref({ source_ref: 'https://evil.example/?u=api.weather.gov', zip: '90620' }) === 'https://evil.example/?u=api.weather.gov', '1e a look-alike host is NOT treated as weather (and is not rewritten)');
ok(T.recordHref({ source_ref: 'https://www.austintexas.gov/devscreen/Case/C14-2026-0061', zip: '78617' }) === 'https://www.austintexas.gov/devscreen/Case/C14-2026-0061', '1f an ordinary record link is returned unchanged');
const HOSTILE = ['javascript:alert(1)', 'data:text/html,<b>x</b>', '//api.weather.gov/alerts/x', 'ftp://api.weather.gov/x', '', '   ', null, undefined, 'not a url', 'https://', 'http:\\\\api.weather.gov'];
ok(HOSTILE.every((u) => { const h = T.recordHref({ source_ref: u, zip: '90620' }); return h === '' || /^https?:\/\//i.test(h); }), '1g no hostile scheme ever becomes a link');
// PROPERTY: no input, in any of the four URL fields, can put the raw weather API host in an href.
const FIELDS = ['source_ref', 'record_url', 'url', 'source_url'];
ok(FIELDS.every((f) => ['', '90620', 'abc'].every((z) => !/api\.weather\.gov/i.test(T.recordHref({ [f]: NWS, zip: z })))), '1h the raw api.weather.gov URL is never returned, from any URL field');

// ── 2. linkKind / linkNote ──────────────────────────────────────────────────────────────────────────
const DATA = 'https://apps-secure.phoenix.gov/pdd/search/permits';
const dataset = { source_ref: DATA, provenance: { url_precision: 'dataset' } };
const record = { source_ref: 'https://www.austintexas.gov/devscreen/Case/C14-2026-0061', provenance: { url_precision: 'record' } };
const undeclared = { source_ref: 'https://tabs.example.gov/TABS2023006483', provenance: null };
ok(T.linkKind(dataset, T.recordHref(dataset)) === 'dataset', '2a engine-declared dataset precision -> dataset');
ok(T.linkKind(record, T.recordHref(record)) === 'record' && T.linkNote(record, T.recordHref(record)) === '', '2b record precision -> record, and NO label');
ok(T.linkNote(undeclared, T.recordHref(undeclared)) === '', '2c undeclared precision (a real TABS shape) -> no label: the card claims nothing it cannot source');
ok(['Dataset', 'DATASET', 'feed', true, 1, {}, ''].every((v) => T.linkNote({ source_ref: DATA, provenance: { url_precision: v } }, DATA) === ''), '2d only the exact value "dataset" labels - unknown vocabulary never does');
ok(T.linkNote({ source_ref: DATA, provenance: 'dataset' }, DATA) === '' && T.linkNote({ source_ref: DATA }, DATA) === '', '2e a provenance that is not an object, or missing, never labels');
ok(T.linkNote(dataset, '') === '' && T.linkKind(dataset, '') === '', '2f no link -> no label');
ok(!/phoenix|FeatureServer|arcgis|\/api\/v2\/sql/i.test(TPL.replace(/\/\/[^\n]*/g, '')), '2g the dataset rule names no host, registry id or URL pattern (the engine decides; the browser has no second list)');
const dn = T.linkNote(dataset, DATA);
ok(/Source data/.test(dn) && !/<a[\s>]/i.test(dn) && /new tab/.test(dn), '2h the label says "Source data", is not a nested link, and tells a screen reader it opens a new tab');
const wn = T.linkNote({ source_ref: NWS, zip: '90620' }, PAGE + '90620');
ok(/Weather\.gov forecast for this ZIP/.test(wn) && /ZIP 90620/.test(wn) && /not this alert/.test(wn) && !/<a[\s>]/i.test(wn), '2i the weather label names the page it opens, never claims to be the alert');

// ── 3. the whole card ────────────────────────────────────────────────────────────────────────────────
const wcard = T.miniCardLink({ title: 'Coastal Flood Advisory issued October 8', category: 'Local News', source_ref: NWS, zip: '90620' }, 'Local News', T.recordHref({ source_ref: NWS, zip: '90620' }));
ok(wcard.includes('href="' + PAGE + '90620"') && !/api\.weather\.gov/i.test(wcard) && /target="_blank" rel="noopener noreferrer"/.test(wcard) && /srclabel/.test(wcard), '3a a weather card opens the NWS ZIP page, carries the label, and the raw API URL appears nowhere in it');
const nolink = T.miniCardLink({ title: 'Alert', source_ref: NWS }, 'Local News', T.recordHref({ source_ref: NWS }));
ok(!/<a[\s>]/i.test(nolink) && !/srclabel/.test(nolink) && !/api\.weather\.gov/i.test(nolink), '3b a weather card with no ZIP is a plain card: no link, no label, no raw URL');
const dcard = T.miniCardLink({ title: 'Permit', source_ref: DATA, provenance: { url_precision: 'dataset' } }, 'Development', DATA);
ok(/srclabel[^>]*>Source data/.test(dcard) && dcard.indexOf('srclabel') > dcard.indexOf('class="impacts"') && dcard.trim().endsWith('</a>'), '3c a dataset card carries the label inside the card, after its content');
ok(!/srclabel/.test(T.miniCardLink({ title: 'Case', source_ref: record.source_ref, provenance: { url_precision: 'record' } }, 'Development', record.source_ref)), '3d a record card is unchanged: no label');

// ── 3e. the Alerts page's story-card "Read" button follows the same rule ────────────────────────────────
const wAct = T.cardActions({ id: 'c1', source_ref: NWS, zip: '90620' });
ok(wAct.includes("window.open('" + PAGE + "90620'") && /Weather\.gov forecast/.test(wAct) && /not this alert/.test(wAct) && !/api\.weather\.gov/i.test(wAct), '3e a weather story card\'s button opens the NWS ZIP page, worded as such');
ok(!/Read|window\.open/.test(T.cardActions({ id: 'c2', source_ref: NWS })), '3f a weather story card with no ZIP has no Read button (never the raw API)');
ok(T.cardActions({ id: 'c3', source_ref: 'https://gov.example.test/n1', zip: '01001' }).includes("window.open('https://gov.example.test/n1'") && />Read →</.test(T.cardActions({ id: 'c3', source_ref: 'https://gov.example.test/n1' })), '3g an ordinary story card still reads "Read →" and opens its own URL');
ok(!/window\.open/.test(T.cardActions({ id: 'c4', source_ref: 'javascript:alert(1)' })), '3h a non-http(s) source never becomes a button');

// ── 4. every card type goes through the one helper ─────────────────────────────────────────────────────
const CP = read('lib/community-page.js');
ok(/HS\.tpl\.linkNote\(p, ph\)/.test(CP), '4a the Development card appends the label from the one helper');
ok(!/weather\.gov|FeatureServer|url_precision|api\.weather/i.test(CP.replace(/\/\/[^\n]*/g, '')), '4b community-page.js decides nothing about URL kinds (templates.js is the one place)');
ok(/\.srclabel\{/.test(read('app.css')) && /\.sr-only\{/.test(read('app.css')), '4c app.css carries the label styles');

// ── 5. the crawlable HTML uses the SAME rule ───────────────────────────────────────────────────────────
const GEN = read('scripts/gen_zip_pages.py');
const jsPage = (TPL.match(/const WEATHER_ZIP_PAGE = '([^']+)'/) || [])[1];
const pyPage = (GEN.match(/^WEATHER_ZIP_PAGE = "([^"]+)"/m) || [])[1];
ok(!!jsPage && jsPage === pyPage && jsPage === PAGE, '5a the JS and the generator point at the identical NWS page');
ok((TPL.match(/const WEATHER_API_HOST = '([^']+)'/) || [])[1] === (GEN.match(/^WEATHER_AGENCY = "([^"]+)"/m) || [])[1], '5b the JS host test and the generator\'s weather agency are the same host');
ok((TPL.match(/const WEATHER_LABEL = '([^']+)'/) || [])[1] === (GEN.match(/^WEATHER_NOTE = "([^"]+)"/m) || [])[1], '5c the label wording matches');
ok(/_items\(wx, "Weather alerts", "", "wx", z\)/.test(GEN) && /if kind == "wx":/.test(GEN), '5d the generated weather list is built through the swap, with the page\'s own ZIP');
const swap = GEN.slice(GEN.indexOf('def _items('), GEN.indexOf('OG_IMAGE = '));
ok(/re\.fullmatch\(r"\\d\{5\}", zip_code or ""\)/.test(swap) && !/safe_url\(it\.get\("url"\)\)[\s\S]{0,200}kind == "wx"[\s\S]{0,60}u = u/.test(swap), '5e the swap needs a valid 5-digit ZIP and never falls back to the raw URL');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);
