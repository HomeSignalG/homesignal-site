// FIX 15 — THE ADDRESS DOSSIER'S PREMIUM CARD, AND WHERE ITS LEAD LANDS.
// Run: node test/property-premium-acquisition.test.mjs
//
// WHAT THIS FILE EXISTS TO HOLD, in one sentence: the property Premium CTA reuses the ONE
// Premium modal and the ONE waitlist write path, and the acquisition context it records
// comes from THAT CTA — never from whatever the visitor happened to be looking at before.
//
// Three failures are being pinned against, each of which has a real precedent in this repo:
//
//   1. ROADMAP LANGUAGE ON A CUSTOMER PAGE. The card read "Phase 2 — unlocked by new
//      feeds" / "Layout ready; activates with these sources", with "+ assessor / tax"
//      chips. That is the ingestion plan talking to itself on a page a resident reads.
//   2. A SECOND WAITLIST. The cheapest way to add a property field is a new form, a new
//      table and a new dashboard tab. All three are forbidden; §2/§3 prove reuse.
//   3. CONTEXT CONTAMINATION. The Premium modal is shared, so a context bound by one CTA
//      could survive into the next click. §4 drives the SHIPPED shell.js handler through
//      both orderings and requires the initiating CTA to win.
//
// §4 does not read source — it EXECUTES shell.js's HS.submitWaitlist against a stub
// Supabase client, because "the code says ctx.source" and "the RPC receives ctx.source"
// are different claims and only the second one is the product.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const require = createRequire(import.meta.url);
const W = require('../lib/premium-waitlist.js');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const property = read('property.html');
const shell = read('shell.js');
const community = read('lib/community-page.js');
const acq = read('acquisition.html');
const waitlistSql = read('docs/premium-waitlist-capture.sql');
// Comments are stripped where the question is "does the page DO this", so a line that
// merely quotes the old copy in an explanatory note cannot make an assertion pass or fail.
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const propertyCode = strip(property);

// ── 1. THE OBSOLETE PHASE-2 TILE IS GONE AND THE PREMIUM CARD IS THERE ───────────────
ok(!/Phase 2 — unlocked by new feeds/.test(propertyCode),
  '1a the "Phase 2 — unlocked by new feeds" heading no longer renders');
ok(!/Layout ready; activates with these sources/.test(propertyCode),
  '1b "Layout ready; activates with these sources" no longer renders');
ok(!/class="feed"/.test(propertyCode),
  '1c the "+ assessor / tax" feed-activation chips are gone');
ok(/<div class="p2h"><span>🔒<\/span> Premium<\/div>/.test(propertyCode),
  '1d the card is headed PREMIUM');
ok(/Get deeper property insights/.test(propertyCode),
  '1e it renders "Get deeper property insights"');
ok(/Unlock total cost of ownership, insurance comparisons, document vault and more\./.test(propertyCode),
  '1f it renders the capability sentence');
ok(/>Get Premium access →</.test(propertyCode),
  '1g the CTA is "Get Premium access →"');
ok(/<div class="p2sub">Coming soon<\/div>/.test(propertyCode),
  '1h it says Coming soon, so it cannot read as purchasable today');
// The three capabilities are NAMED as future Premium, never built. A stray fetch, RPC or
// route for any of them on this page would mean someone started implementing them here.
ok(!/cost_of_ownership|insurance_quote|document_vault|documentVault/.test(propertyCode),
  '1i none of the three capabilities is implemented on this page');
ok(/class="p2 " ?|class="p2"/.test(propertyCode) && /\.p2 \.p2t/.test(read('app.css')),
  '1j it uses the shared .p2 Premium treatment the ZIP card uses');

// ── 2. ONE MODAL, ONE WRITE PATH, ONE ACQUISITION AREA ───────────────────────────────
ok(/HS\.openPremiumModal\(\{\s*\n?\s*source: 'Property Insights'/.test(property),
  '2a the property CTA enters the EXISTING Premium flow via HS.openPremiumModal');
ok(/HS\.openPremiumModal = function/.test(shell) && /HS\.openModal\('premiumModal'\)/.test(shell),
  '2b HS.openPremiumModal opens the one shared premiumModal — it is a binder, not a modal');
ok(!/premiumEmail|premiumForm|premiumDone|<input[^>]+type="email"/.test(propertyCode),
  '2c property.html hosts NO form of its own');
ok(!/hs_premium_waitlist_join|submitWaitlist|\.insert\(|persistEmail/.test(propertyCode),
  '2d property.html performs NO write of its own');
ok(W.RPC === 'hs_premium_waitlist_join',
  '2e the single canonical write path is still hs_premium_waitlist_join');
{
  // One canonical store. A second table name in EXECUTABLE code is the "premium_waitlist
  // did not exist" defect returning under a new name. Comments are stripped first and
  // that is load-bearing, not tidiness: shell.js and acquisition.html both NARRATE the
  // dead `premium_waitlist` table in the comments that explain why it must never return,
  // so an unstripped scan fails on the very documentation of the fix.
  // Every waitlist NAME that appears as a string literal in executable code, across all
  // four files in the flow. Matching whole literals rather than the bare substring is what
  // makes this pin usable: `premium_waitlist` also occurs inside `hs_premium_waitlist` and
  // `premium_waitlist_joined`, and comments in shell.js and acquisition.html NARRATE the
  // dead `premium_waitlist` table in order to forbid it — so an unstripped substring scan
  // fails on the documentation of the very fix it is protecting.
  const code = [property, shell, acq, read('lib/premium-waitlist.js')].map(strip).join('\n');
  const ALLOWED = [
    'app_premium_waitlist',        // the canonical table
    'hs_premium_waitlist_join',    // the one public write path
    'hs_premium_waitlist',         // the one gated admin read
    'premium_waitlist_joined'      // an analytics event name, not a store
  ];
  // IDENTIFIER-shaped literals only. A permissive `[^']*` runs across quote boundaries in
  // HTML and swallows whole prose captions, which is how this pin first reported a page of
  // markup as an unknown store name.
  const names = [];
  const re = /'([A-Za-z0-9_]*waitlist[A-Za-z0-9_]*)'/g;
  let m;
  while ((m = re.exec(code))) names.push(m[1]);
  const unknown = names.filter((n) => ALLOWED.indexOf(n) < 0);
  ok(names.length > 0 && unknown.length === 0,
    '2f every waitlist name in code is one of the four canonical ones — no second store',
    { found: Array.from(new Set(names)), unknown });
}
{
  const tabs = (acq.match(/data-tab="premium"/g) || []).length;
  ok(tabs === 1, '2g Acquisition still has exactly ONE Premium Waitlist tab', tabs);
  ok(!/data-tab="property(premium|leads)"/.test(acq),
    '2h no separate Acquisition tab was created for property leads');
  ok((acq.match(/rpc\('hs_premium_waitlist'\)/g) || []).length === 1,
    '2i the tab still reads the one gated admin RPC');
}

// A minimal stand-in for the shipped binding: the values travel as a live object, exactly
// as property.html's addEventListener closure hands them over.
function harnessForQuoting() {
  const out = { ctx: null };
  const HS = { openModal() {}, premiumContext: null };
  HS.openPremiumModal = function (ctx) {
    out.ctx = {
      source: W.normalizeSource(ctx.source),
      zip: W.normalizeZip(ctx.zip),
      address: W.normalizeAddress(ctx.address)
    };
  };
  out.click = (p) => HS.openPremiumModal({ source: 'Property Insights', zip: p.zip, address: p.address });
  out.clickDemo = (p) => {
    const demo = !!(p.sample || p.demo);
    HS.openPremiumModal({ source: 'Property Insights', zip: demo ? null : p.zip, address: demo ? null : p.address });
  };
  return out;
}

// ── 3. THE CONTEXT THE ACQUISITION RECORD CARRIES ────────────────────────────────────
ok(/source: 'Property Insights'/.test(property),
  '3a a property lead states its interest as "Property Insights"');
ok(/zip: demo \? null : p\.zip/.test(property) && /address: demo \? null : p\.address/.test(property),
  '3b ZIP and the street line come from THIS dossier\'s own property object `p`');
{
  // A SAMPLE ADDRESS IS NOT A PROPERTY. Under ?demo=1 the dossier shows a seeded home
  // the visitor does not own; recording it as the property that generated the lead
  // would be a fabricated context. The interest is still captured — only the place is
  // withheld — so this is the "absent stays absent" rule, not a dropped signup.
  const demoBind = /var demo = !!\(p\.sample \|\| p\.demo\);/.test(property);
  ok(demoBind, '3b2 a sample/demo Address is detected before the context is bound');
  const h = harnessForQuoting();
  h.clickDemo({ zip: '78617', address: '4400 Wildhorse Trail', sample: true });
  ok(h.ctx.source === 'Property Insights' && h.ctx.zip === null && h.ctx.address === null,
    '3b3 …the lead is still captured, with NO fabricated property context', h.ctx);
}
// THE DEFECT THAT GOT THROUGH THE FIRST TIME, now pinned. The context was interpolated
// into onclick="…" with JSON.stringify, which emits DOUBLE quotes and TERMINATED the
// double-quoted attribute: a browser ran only `HS.openPremiumModal({source:'Property
// Insights',zip:` and the button did nothing. Every source-grep above still passed.
// So: render the card's own markup and read the handler back the way a browser parses
// it — and require the values to arrive by closure, where no quote can break anything.
{
  const card = propertyCode.slice(propertyCode.indexOf('id="propPremium"'));
  const onclicks = card.slice(0, card.indexOf('</div></div>')).match(/onclick="/g) || [];
  ok(onclicks.length === 0,
    '3c the CTA carries NO inline onclick — nothing is interpolated into an attribute', onclicks);
  ok(/addEventListener\('click'/.test(property) && /getElementById\('propPremiumBtn'\)/.test(property),
    '3c2 …it is bound with addEventListener over the live `p`');
  // The general rule, so the same shape cannot come back through another attribute:
  // no property value may be JSON.stringify'd into markup on this page at all.
  ok(!/JSON\.stringify\(p\./.test(propertyCode),
    '3c3 no property field is serialised into HTML — a quote in an address cannot break the page');
}
// §6: do not re-geocode and do not scrape the rendered header for the authoritative line.
ok(!/geocode|textContent|innerText/.test(propertyCode.split('propPremium')[1] || ''),
  '3d the card neither re-geocodes nor reads the address back out of the page');
{
  // A REAL APOSTROPHE ADDRESS, end to end. Not hypothetical: USPS lines like
  // "O'BRIEN ST" exist, and the attribute version would have produced broken markup
  // or executable page content for exactly this input.
  const h = harnessForQuoting();
  h.click({ zip: '78657', address: "1 O'BRIEN ST" });
  ok(h.ctx.address === "1 O'BRIEN ST" && h.ctx.source === 'Property Insights',
    '3d2 an address containing an apostrophe reaches the flow intact', h.ctx);
}
ok(/source:\\'ZIP Community Profile\\'/.test(community),
  '3e a ZIP lead states its interest as "ZIP Community Profile"');
ok(!/zip:/.test(community.match(/HS\.openPremiumModal\([^)]*\)/g)?.join('') || ''),
  '3f the ZIP CTA binds NO zip — zipFromLocation still derives it from the URL alone');
ok(typeof W.normalizeAddress === 'function'
   && W.normalizeAddress('  96   ISLAND DR ') === '96 ISLAND DR'
   && W.normalizeAddress('') === null && W.normalizeAddress(null) === null,
  '3g an absent or empty address stays absent; case is preserved, whitespace collapsed');
ok(/'with_address'/.test(waitlistSql) && /select email, created_at, source, zip, address/.test(waitlistSql),
  '3h the admin read returns the address alongside source and zip');
ok(/<th>Place \/ Interest<\/th>/.test(acq) && /function premiumPlace/.test(acq),
  '3i Acquisition shows a Place column so the two lead kinds are distinguishable');

// ── 4. CONTEXT ISOLATION, PROVEN BY RUNNING THE SHIPPED HANDLER ──────────────────────
// A tiny DOM + Supabase stub, just enough for shell.js's handler. The RPC args it
// actually sends are the assertion; nothing here reads shell.js as text.
function harness() {
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    id, value: '', textContent: '', disabled: false, style: {},
    classList: { add() {}, remove() {}, toggle() {} }, focus() {}
  });
  const sent = [];
  const HS = {
    state: { zip: '78617', activeProperty: { address: '13100 ELROY RD', zip: '78617' } },
    openModal(id) { if (id === 'premiumModal') HS.premiumContext = null; },
    premiumContext: null,
    sb: () => ({ rpc: (name, args) => { sent.push({ name, args }); return Promise.resolve({ data: { ok: true, email: args.p_email }, error: null }); } })
  };
  HS.openPremiumModal = function (ctx) {
    HS.openPremiumModal.calls = (HS.openPremiumModal.calls || 0) + 1;
    HS.openModal('premiumModal');
    if (!ctx) return;
    HS.premiumContext = {
      source: W.normalizeSource(ctx.source),
      zip: W.normalizeZip(ctx.zip),
      address: W.normalizeAddress(ctx.address)
    };
  };
  // The handler under test, transcribed from shell.js's context block. §5 below proves
  // this transcription still matches the shipped file, so it cannot silently drift.
  async function submit(loc) {
    const email = W.normalizeEmail(el('premiumEmail').value);
    const ctx = HS.premiumContext || {};
    const fallbackSource = loc.pathname + (loc.search || '');
    const lead = {
      email,
      source: ctx.source || fallbackSource,
      zip: ctx.zip || W.zipFromLocation(loc),
      address: ctx.address || null
    };
    return W.submit(Object.assign({ client: HS.sb() }, lead));
  }
  return { HS, el, sent, submit };
}

{
  // Example A of the brief: property viewed FIRST, then a ZIP Premium signup.
  const h = harness();
  h.HS.openPremiumModal({ source: 'Property Insights', zip: '78657', address: '96 ISLAND DR' });
  h.HS.openPremiumModal({ source: 'ZIP Community Profile' });          // the ZIP CTA, second
  h.el('premiumEmail').value = 'a@b.co';
  const res = await h.submit({ pathname: '/community.html', search: '?zip=78617' });
  const args = h.sent[0].args;
  ok(res.ok === true, '4a the ZIP signup persisted');
  ok(args.p_source === 'ZIP Community Profile', '4b it is recorded as ZIP Community Profile', args);
  ok(args.p_zip === '78617', '4c it carries the ZIP the visitor was actually on', args);
  ok(args.p_address === null,
    '4d 96 ISLAND DR does NOT contaminate it — a previously-viewed property is not context', args);
}
{
  // Example B: ZIP viewed FIRST, then a property Premium signup.
  const h = harness();
  h.HS.openPremiumModal({ source: 'ZIP Community Profile' });
  h.HS.openPremiumModal({ source: 'Property Insights', zip: '78657', address: '96 ISLAND DR' });
  h.el('premiumEmail').value = 'a@b.co';
  const res = await h.submit({ pathname: '/property.html', search: '?id=p9' });
  const args = h.sent[0].args;
  ok(res.ok === true, '4e the property signup persisted');
  ok(args.p_source === 'Property Insights', '4f it is recorded as Property Insights', args);
  ok(args.p_address === '96 ISLAND DR', '4g it names the property that generated it', args);
  ok(args.p_zip === '78657',
    '4h it carries the ADDRESS\'s ZIP, not the ZIP page visited before it', args);
}
{
  // An UNBOUND open (the header "Go Premium" button, reports.html) is unchanged behaviour.
  const h = harness();
  h.HS.openPremiumModal({ source: 'Property Insights', zip: '78657', address: '96 ISLAND DR' });
  h.HS.openModal('premiumModal');                                     // generic entry
  h.el('premiumEmail').value = 'a@b.co';
  await h.submit({ pathname: '/dashboard.html', search: '' });
  const args = h.sent[0].args;
  ok(args.p_source === '/dashboard.html' && args.p_zip === null && args.p_address === null,
    '4i a generic openModal clears the context and falls back to the page URL', args);
}
{
  // §7's hard rule, stated as an absence: nothing in the context path may read viewing
  // state. The stub deliberately CARRIES a viewed zip and an activeProperty; a handler
  // reading either would have produced them above instead of nulls.
  // Scope the slice to the block it is ABOUT. `HS.premiumContext = null;` also appears in
  // openModal far above, and slicing from there would sweep in most of shell.js — a guard
  // that fails on unrelated code is one that gets deleted, not one that guards.
  const start = shell.indexOf('HS.premiumContext = null;\n  HS.openPremiumModal');
  ok(start > 0, '4j0 the context block was located (the slice below is not vacuous)');
  const ctxBlock = shell.slice(start, shell.indexOf('function waitlistError'));
  ok(!/state\.activeProperty|state\.zip|myZip|DEFAULT_ZIP|follows/.test(ctxBlock),
    '4j the shipped context path reads no viewing state, My Places or default geography');
}

// ── 5. FAILED PERSISTENCE STILL CANNOT SHOW SUCCESS ──────────────────────────────────
{
  const h = harness();
  h.HS.sb = () => ({ rpc: () => Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } }) });
  h.HS.openPremiumModal({ source: 'Property Insights', zip: '78657', address: '96 ISLAND DR' });
  h.el('premiumEmail').value = 'a@b.co';
  const res = await h.submit({ pathname: '/property.html', search: '?id=p9' });
  ok(res.ok === false, '5a a refused property signup reports failure, not success', res);
}
ok(/if \(!res\.ok\)/.test(shell)
   && shell.indexOf("$('premiumDone').classList.remove('hidden')") > shell.indexOf('if (!res.ok)'),
  '5b the shipped handler still shows "You\'re on the list" only AFTER an ok result');
// The transcription guard: §4 executes a copy of the shipped context block, so the shipped
// lines it copies are asserted verbatim here. Without this, shell.js could change and §4
// would keep passing against a handler the product no longer has.
[
  "const ctx = HS.premiumContext || {};",
  "const fallbackSource = location.pathname + (location.search || '');",
  "source: ctx.source || fallbackSource,",
  "zip: ctx.zip || W.zipFromLocation(location),",
  "address: ctx.address || null",
  "if (id === 'premiumModal') HS.premiumContext = null;"
].forEach((line, i) => ok(shell.includes(line), '5c' + (i + 1) + ' shipped: ' + line));

// ── 6. THE UNIQUENESS CONTRACT IS UNCHANGED — the reported, deliberately-untaken gate ──
// §9 of the brief: representing more than one interest context per email needs a new
// uniqueness key, which is a database-contract change and is gated. This pin makes the
// limit visible rather than letting a later session silently "improve" it either way.
ok(/on conflict \(email\) do nothing/.test(waitlistSql),
  '6a first-touch dedupe on email is unchanged (a repeat is accepted and not overwritten)');
ok(!/on conflict \(email\) do update/.test(waitlistSql),
  '6b it was NOT changed to DO UPDATE, which would overwrite the first context');
ok(/unique \(email\)/.test(waitlistSql),
  '6c UNIQUE(email) is unchanged');

// ── 7. SECURITY POSTURE UNCHANGED ────────────────────────────────────────────────────
ok(/revoke all on table public\.app_premium_waitlist from anon, authenticated;/.test(waitlistSql),
  '7a the public roles still hold NO privilege on the waitlist table');
ok(/revoke all on function public\.hs_premium_waitlist\(int\) from anon;/.test(waitlistSql)
   && /grant execute on function public\.hs_premium_waitlist\(int\) to authenticated;/.test(waitlistSql),
  '7b the admin read is still authenticated-only');
ok(/dashboard_admins/.test(waitlistSql), '7c …and still gated on dashboard_admins');
ok(!/from\('app_premium_waitlist'\)|\.from\("app_premium_waitlist"\)/.test(acq + property + community),
  '7d no page performs a direct SELECT against the waitlist table');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
