// TEMPORARY homepage Map 1 approval capture.
// Runs only on branch claude/dev-tracker-zip-scope via verify-dev-tracker.yml.
// It photographs the CURRENT shipped Map 1 product card against live Supabase + real OSM.
// No fixtures, no redrawing, no synthetic controls.
import { chromium } from 'playwright';
import fs from 'fs';

const ZIP = process.env.VERIFY_ZIP || '84336';
const URL = process.env.VERIFY_URL || ('http://localhost:8080/homesignalmap.html?embed=1&zip=' + ZIP);
const OUT_PNG = 'verify/dev-tracker-' + ZIP + '.png';
const OUT_JSON = 'verify/dev-tracker-' + ZIP + '-assertions.json';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Current Map 1 contract: the one product card contains all three filter families.
await page.waitForSelector('.card.mapcard', { timeout: 60000 });
await page.waitForSelector('#mapkey .stagechip', { timeout: 60000 });
await page.waitForSelector('#mapkeyShapes .typechip', { timeout: 60000 });
await page.waitForSelector('#mapkeyReg .regchip', { timeout: 60000 });
await page.waitForSelector('#map', { timeout: 60000 });

// Let live Supabase, Leaflet and OSM settle.
await page.waitForTimeout(5000);

const A = await page.evaluate(() => {
  const texts = (sel) => Array.from(document.querySelectorAll(sel)).map(x => (x.textContent || '').trim()).filter(Boolean);
  const card = document.querySelector('.card.mapcard');
  const map = document.querySelector('#map');
  const rect = card && card.getBoundingClientRect();
  const mrect = map && map.getBoundingClientRect();
  return {
    stage_labels: texts('#mapkey .stagechip .t'),
    type_labels: texts('#mapkeyShapes .typechip .t'),
    regulatory_labels: texts('#mapkeyReg .regchip .t'),
    headings: texts('.mapkey-hd'),
    map_key: (document.querySelector('#mapkeyNote')?.textContent || '').replace(/\s+/g, ' ').trim(),
    card_width: rect ? Math.round(rect.width) : 0,
    card_height: rect ? Math.round(rect.height) : 0,
    map_width: mrect ? Math.round(mrect.width) : 0,
    map_height: mrect ? Math.round(mrect.height) : 0,
  };
});

const requiredStages = ['Operating now','Approved','Proposed','Lifecycle unknown'];
const requiredTypes = ['Data center','Industrial','Residential','Roads & infrastructure','Commercial','Civic & public','Other project'];
const requiredReg = ['Regulatory facilities'];
function same(a,b){ return JSON.stringify(a) === JSON.stringify(b); }
if (!same(A.stage_labels, requiredStages)) throw new Error('STATUS controls mismatch: ' + JSON.stringify(A.stage_labels));
if (!same(A.type_labels, requiredTypes)) throw new Error('PROJECT TYPE controls mismatch: ' + JSON.stringify(A.type_labels));
if (!same(A.regulatory_labels, requiredReg)) throw new Error('REGULATORY controls mismatch: ' + JSON.stringify(A.regulatory_labels));
if (A.map_height < 250) throw new Error('Map is too short to approve: ' + A.map_height);

fs.mkdirSync('verify', { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify({ zip: ZIP, url: URL, at: new Date().toISOString(), assertions: A, consoleErrors }, null, 2));
await page.locator('.card.mapcard').screenshot({ path: OUT_PNG });
await browser.close();

console.log(JSON.stringify(A, null, 2));
console.log('Screenshot:', OUT_PNG);
