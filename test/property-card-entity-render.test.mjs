// THE POPULATED ENTITY TRACK RECORD PATH, rendered in a real browser.
//
// WHY THIS SUITE EXISTS. Every other property-card test reads source text or calls HS.card
// directly. Neither can catch the failure that actually matters here: a parent company's
// enforcement action appearing under the project LLC ON THE PAGE. Attribution is a property of
// the rendered document — which group a record physically sits inside — and the only way to
// assert it is to render the document and ask.
//
// It also exercises a path the pilot address cannot reach. Del Valle has no enforcement records
// and no confirmed parent, so the shipped card renders the empty states and nothing else; a
// populated hierarchy has therefore never been seen unless a fixture drives one. Every company
// and every matter below is INVENTED FOR THE FIXTURE and is reachable only through the page's
// localhost-gated override hook — no deployed flow can render it.
//
// Run: node test/property-card-entity-render.test.mjs   (needs playwright)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP property-card-entity-render.test.mjs — playwright not installed '
    + '(run: npx -p playwright node test/property-card-entity-render.test.mjs)');
  process.exit(0);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      const fp = path.join(root, decodeURIComponent(p === '/' ? '/property-card.html' : p));
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// ── THE FIXTURE ────────────────────────────────────────────────────────────────────
// The brief's own example, made concrete: a project LLC with nothing on its record, a VERIFIED
// parent that has three FinCEN matters, one verified related operator, and two companies the
// gate must hold back — an unconfirmed parent candidate and a corporate affiliate with no role
// in this project.
const PROJECT = 'Greenland Energy LLC';
const PARENT = 'XYZ Holdings Inc';
const OPERATOR = 'Greenland Operations Services LLC';
const CANDIDATE = 'Possible Parent Group LLC';
const AFFILIATE = 'Greenland Energy Midwest LLC';

const fixture = {
  address: '1 FIXTURE WAY, TEST CITY, TX 78617',
  zip: '78617', county: 'Travis', state: 'TX',
  sites: [], sources_checked: [],
  entity_track_read: 'ok',
  entities: [
    { id: 'ent-1', name: PROJECT, role: 'project_entity',
      relationship_to_property: 'Named as the project owner on a permit filed at this address',
      relationship_verification: 'not_yet_asked', evidence_class: 'authoritative_filing',
      relationship_source: 'Permit TABS2026011928',
      formed_date: '2026-02-10',
      track: { fincen: { state: 'checked_empty', found_n: 0 },
        epa_echo: { state: 'checked_empty', found_n: 0 } } },
    { id: 'ent-2', name: PARENT, role: 'parent',
      relationship_kind: 'parent_company', relationship_verification: 'verified',
      relationship_source: 'SEC EX-21.01 to the FY2025 Form 10-K',
      relationship_source_url: 'https://www.sec.gov/example',
      evidence_class: 'published_statement',
      track: { fincen: { state: 'verified', found_n: 3 } } },
    { id: 'ent-3', name: OPERATOR, role: 'related',
      relationship_kind: 'operator', relationship_verification: 'verified',
      relationship_source: 'TCEQ Central Registry',
      material_role: 'Operates the facility on this parcel' },
    // HELD BACK: a parent we have not confirmed. Rendering its history would attach a stranger's
    // record to this property on the strength of a suspicion.
    { id: 'ent-4', name: CANDIDATE, role: 'parent',
      relationship_kind: 'parent_company', relationship_verification: 'unverified_candidate',
      relationship_source: 'Address co-occurrence' },
    // HELD BACK: a corporate relative with no part in this project.
    { id: 'ent-5', name: AFFILIATE, role: 'related',
      relationship_kind: 'affiliate', relationship_verification: 'verified',
      relationship_source: 'SEC EX-21.01 to the FY2025 Form 10-K' }
  ],
  enforcement_records: [
    { source_agency: 'fincen', source_name: 'FinCEN', record_type: 'Enforcement Action',
      entity_name: PARENT, matched_entity_id: 'ent-2',
      parent_or_subsidiary_relationship: 'Parent company',
      action_date: '2026-03-06', matter_number: '2026-01',
      violation_category: 'Bank Secrecy Act / AML compliance',
      violation_summary: 'Failure to maintain an effective anti-money-laundering programme.',
      penalty_amount: 1500000, action_status: 'Final',
      source_url: 'https://www.fincen.gov/example',
      source_document_url: 'https://www.fincen.gov/example.pdf',
      source_document_title: 'FinCEN consent order 2026-01',
      verification_status: 'verified', confidence_score: 0.92,
      retrieved_at: '2026-08-12T00:00:00Z' },
    { source_agency: 'fincen', source_name: 'FinCEN', record_type: 'Enforcement Action',
      entity_name: PARENT, matched_entity_id: 'ent-2',
      action_date: '2025-07-14', matter_number: '2025-11',
      violation_category: 'Bank Secrecy Act / AML compliance',
      // NO penalty stated. It must render as "the record doesn't say", never as $0.
      action_status: 'Final', verification_status: 'verified' },
    { source_agency: 'fincen', source_name: 'FinCEN', record_type: 'Enforcement Action',
      entity_name: PARENT, matched_entity_id: 'ent-2',
      action_date: '2024-02-02', matter_number: '2024-03',
      action_status: 'Final', verification_status: 'verified' },
    // Held but unverified: counted apart, never folded into the verified total.
    { source_agency: 'doj', source_name: 'DOJ', record_type: 'Settlement',
      entity_name: PARENT, matched_entity_id: 'ent-2',
      action_date: '2023-05-01', verification_status: 'unverified' }
  ]
};

const { srv, port } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// The page loads supabase-js from jsDelivr. Stubbed so this suite proves the RENDERER, offline,
// without a CDN round trip deciding whether it passes.
// Every builder method returns the same thenable proxy, so any query shape the shell happens to
// build resolves to an empty result instead of throwing and being mistaken for a page defect.
const SB_STUB = `
  window.supabase = { createClient: function () {
    function q() {
      var p = new Proxy(function () { return p; }, {
        get: function (t, k) {
          if (k === 'then') return function (res) { return Promise.resolve({ data: [], error: null }).then(res); };
          return p;
        },
        apply: function () { return p; }
      });
      return p;
    }
    return {
      from: q, rpc: async function () { return { data: null, error: { code: 'PGRST202', message: 'not found' } }; },
      auth: { getSession: async function () { return { data: { session: null } }; },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; } }
    };
  } };`;
await page.route('**/cdn.jsdelivr.net/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/javascript', body: SB_STUB }));
await page.addInitScript((f) => { window.__HS_CARD_OVERRIDE = f; }, fixture);
await page.goto(`http://127.0.0.1:${port}/property-card.html?zip=78617&addr=`
  + encodeURIComponent(fixture.address), { waitUntil: 'networkidle' });
await page.waitForSelector('[data-sec="entity-track-record"]', { timeout: 10000 });

const sec = page.locator('[data-sec="entity-track-record"]');

// ── 1. the hierarchy renders as GROUPS, in order ───────────────────────────────────
const headings = await sec.locator('.pceSection').allTextContents();
ok(headings.join(' | ') === 'Project entity | Parent / controlling entity | Related entity',
  'the three entity groups render in the hierarchy order — got: ' + headings.join(' | '));

const groups = sec.locator('.pceGroup');
ok(await groups.count() === 3,
  'exactly the three gated entities render — got ' + (await groups.count()));
const names = await sec.locator('.pceHead h3').allTextContents();
ok(names[0] === PROJECT && names[1] === PARENT && names[2] === OPERATOR,
  'the groups hold the right companies — got: ' + names.join(' | '));

// ── 2. the gate holds back what it must, and DISCLOSES that it did ─────────────────
const body = await sec.innerText();
ok(!body.includes(CANDIDATE),
  'an unconfirmed parent candidate is rendered as a parent, turning a suspicion into a record');
ok(!body.includes(AFFILIATE),
  'a corporate affiliate with no role in this project is rendered — sharing an owner is not a role');
ok(/only when a public document shows what part it plays in this project/i.test(body),
  'a corporate relative was dropped with no explanation, so the exclusion reads as a gap in our '
  + 'research rather than as a deliberate one');

// ── 3. THE REQUIRED CONTRAST — the project entity's line vs the parent's ───────────
const projectText = await groups.nth(0).innerText();
const parentText = await groups.nth(1).innerText();
ok(/No verified enforcement records found in currently connected HomeSignal sources\./.test(projectText),
  'the project entity does not render the required empty state');
ok(/3 verified enforcement records found\./.test(parentText),
  'the parent does not state how many verified records it has');
ok(/1 further record names this company/.test(parentText),
  'a record we hold but have not verified is folded into the verified count, or dropped');
// A newly formed company must not read like a thirty-year clean record.
ok(/formed/i.test(projectText), 'a known formation date is not rendered');

// ── 4. ATTRIBUTION — the record is INSIDE the parent's group and nowhere else ──────
ok(/Parent company \u2014 FinCEN Enforcement Action/.test(parentText),
  'the record heading does not lead with the relationship');
ok(!/FinCEN Enforcement Action/.test(projectText),
  'THE DEFECT THIS MODULE EXISTS TO PREVENT: the parent’s FinCEN action renders under the '
  + 'project entity');
ok(!/2026-01/.test(projectText), 'the parent’s matter number appears under the project entity');
ok(/2026-01/.test(parentText) && /Bank Secrecy Act \/ AML compliance/.test(parentText),
  'the record renders without its matter number or its issue');
ok(/\$1,500,000/.test(parentText), 'the stated penalty is not rendered');
ok(/Final/.test(parentText), 'the action status is not rendered');
ok(/These are the parent company[’']s own records/.test(parentText),
  'nothing says the parent’s conduct is not the company at this address’s');

// A record with NO stated penalty must say so — never $0, the same rule metricText enforces.
ok(!/\$0\b/.test(parentText), 'an unstated penalty rendered as $0');
ok((parentText.match(/The record doesn[’']t say\./g) || []).length >= 1,
  'a field the source document does not state is dropped rather than declared');

// The source document is reachable: every claim on this card is checkable.
ok(await sec.locator('a[href="https://www.fincen.gov/example.pdf"]').count() === 1,
  'the source document is not linked, so the claim cannot be checked');
// Carried in the contract, never on the page (architecture doc Q8).
ok(!/0\.92/.test(body) && !/confidence/i.test(body), 'a confidence score reached the page');

// ── 5. the relationship shows its own evidence ─────────────────────────────────────
ok(/Relationship: ?Parent company/.test(parentText.replace(/\n/g, ' ')),
  'the parent is not labelled with its relationship kind');
ok(/verified/i.test(parentText) && /SEC EX-21\.01/.test(parentText),
  'the parent relationship renders without its verification status and source');
ok(/Operates the facility on this parcel/.test(await groups.nth(2).innerText())
  || /Operator/.test(await groups.nth(2).innerText()),
  'the related company does not state what part it plays here');

// ── 6. no unchecked source printed a number, on the live DOM ───────────────────────
const metrics = await page.evaluate(() => (window.__HS_CARD || {}).metrics || []);
const leaked = metrics.filter((m) => /Not checked|Not available|Restricted|In progress/i.test(m.state)
  && m.values.some((v) => /\d/.test(v)));
ok(leaked.length === 0,
  'a source that was not read printed a number: ' + JSON.stringify(leaked.slice(0, 3)));
ok(errors.length === 0, 'the page threw: ' + errors.join(' | '));

await browser.close();
srv.close();
if (fails) { console.error(`\n${fails} assertion(s) failed`); process.exit(1); }
console.log('\nentity track record renders the hierarchy, the gate holds back what it must and '
  + 'says so, and the parent’s enforcement action is inside the parent’s group and nowhere else.');
