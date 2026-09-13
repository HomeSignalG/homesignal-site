// FIX 8 — the Dashboard Quality-of-Life Premium card, and the lead it creates.
//
// TWO THINGS THIS FILE PROTECTS, and they fail in opposite directions.
//
// 1. NO QUALITY-OF-LIFE CLAIM MAY RENDER. Phase 1 proved there is no authoritative impact
//    plane: app_changes.impacts is NULL on all 180,595 rows, app_projects.impact_dimensions on
//    all 3,207,251, and impact_score holds exactly FOUR values across the corpus, each constant
//    within its (status, record_kind) pair — so "High impact" would resolve to "status =
//    Proposed" on 357,857 records. The card is a ROADMAP STATEMENT standing in for a capability
//    that does not exist, and it must never become a way to show one anyway.
//
// 2. IT MUST NOT BECOME A SECOND LEAD SYSTEM. The Premium modal, its submit handler, its
//    idempotency and its Acquisition Dashboard path already exist and already work. The
//    Dashboard is the THIRD caller of one flow, not a fourth implementation — and its lead is
//    FEATURE-level, so it must carry no ZIP, no address and no record context.
//
// Run: node test/dashboard-premium-acquisition.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const A = require('../lib/dashboard-aggregate.js');
const W = require('../lib/premium-waitlist.js');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 240) : ''));
  if (!c) fails++;
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(join(root, f), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');

const dashRaw = read('dashboard.html');
const dash = strip(dashRaw);
const shellHtml = read('partials/shell.html');
const shell = read('shell.js');
const acq = read('acquisition.html');
const cpage = read('lib/community-page.js');
const prop = read('property.html');
const css = read('app.css');

// =====================================================================================
console.log('\n--- §1 NO Quality-of-Life claim renders (acceptance 27-28) ----------------');
// =====================================================================================

for (const claim of ['High Impact', 'Medium Impact', 'Low Impact', 'High impact',
                     'Quality-of-Life score', 'QoL score', 'Impact score', 'impact_score',
                     'impactRating', 'impact_dimensions', 'Potential impact'])
  ok(!dash.includes(claim), '1a no "' + claim + '" anywhere on the Dashboard',
    (dash.match(new RegExp('.{0,50}' + claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.{0,50}')) || [])[0]);
ok(!/lib\/impact\.js/.test(dashRaw),
  '1b the Dashboard does not even load the impact-line module');
// No fake locked results, no blurred teaser, no invented counts.
// Word-boundary, not substring: "a blocked history write" legitimately contains "locked",
// and a check that fires on prose is a check nobody can keep green honestly.
for (const fake of [/blur\s*\(/, /\blocked\b/i, /\bUnlock\b/i, /See your score/i,
                    /Join the waitlist/i, /Upgrade now/i, /Early access/i, /AI-powered/i, /\bBeta\b/])
  ok(!fake.test(dash), '1c no ' + fake + ' teaser/upsell pattern',
    (dash.match(new RegExp('.{0,40}' + fake.source + '.{0,40}')) || [])[0]);

// =====================================================================================
console.log('\n--- §2 The approved card copy, in the approved position (29-30) -----------');
// =====================================================================================

const P = A.premiumQolModuleState();
ok(P.label === 'QUALITY-OF-LIFE IMPACT · PREMIUM', '2a section label is the approved string', P.label);
ok(P.availability === 'Coming soon', '2b availability line is exactly "Coming soon"');
ok(P.title === 'Get deeper local insights', '2c card title is the approved string');
ok(P.body === 'See added context around major development, infrastructure, and civic activity across the places you monitor.',
  '2d body copy is the approved sentence', P.body);
ok(P.cta === 'Get Premium access →', '2e CTA is exactly "Get Premium access →"');

// The page renders that copy. The label is written in title case and UPPERCASED BY THE SHARED
// COMPONENT (.p2h carries text-transform:uppercase), which is how the Community card already
// does it — matching the component is the point, not re-implementing its casing inline.
ok(/id="dashQolLabel"[^>]*>Quality-of-Life Impact · Premium</.test(dashRaw),
  '2f the page renders the section label through the shared .p2h element');
ok(/\.p2 \.p2h\{[^}]*text-transform:uppercase/.test(css),
  '2g ...and .p2h is what uppercases it, so the rendered text matches the approved copy');
ok(dashRaw.includes('>Coming soon<') && dashRaw.includes('>Get deeper local insights<')
   && dashRaw.includes('See added context around major development, infrastructure, and civic activity across the places you monitor.'),
  '2h the availability line, title and body render verbatim');
ok(dashRaw.includes('Get Premium access &rarr;'), '2i the CTA renders with the approved arrow');

// Position: main column, between What's Changing and Official Dates.
ok(dash.indexOf('What&rsquo;s Changing?') < dash.indexOf('dashQolPremium')
   && dash.indexOf('dashQolPremium') < dash.indexOf('Official Dates to Know'),
  '2j the Premium card sits in the approved Quality-of-Life section position');

// =====================================================================================
console.log('\n--- §3 The SHARED Premium component is reused, not reinvented (31) --------');
// =====================================================================================

ok(/class="p2"/.test(dashRaw) && /class="p2h"/.test(dashRaw) && /class="p2t"/.test(dashRaw)
   && /class="p2sub"/.test(dashRaw) && /class="inlinebtn"/.test(dashRaw),
  '3a the card is built from the existing .p2 / .p2h / .p2t / .p2sub / .inlinebtn component');
ok(/class="p2"/.test(cpage) && /class="inlinebtn"/.test(cpage),
  '3b ...the same component the Community Premium card uses');
ok(/class="p2"/.test(prop) && /inlinebtn/.test(prop),
  '3c ...and the Property Premium card');
ok(/\.p2\{[^}]*repeating-linear-gradient/.test(css),
  '3d the existing pale striped Premium panel treatment is what renders');
// No Dashboard-only Premium styling was invented.
ok(!/dashPremium\w*\s*\{|\.qol-card|premium-dash/.test(dashRaw),
  '3e no Dashboard-specific Premium CSS class was created');

// =====================================================================================
console.log('\n--- §4 The CTA opens the EXISTING shared modal (32-33) --------------------');
// =====================================================================================

ok(/HS\.openPremiumModal\(/.test(dash), '4a the Dashboard CTA calls the shared opener');
ok(/HS\.openPremiumModal = function/.test(shell), '4b ...which is defined once, in shell.js');
ok(/HS\.openPremiumModal\(\{source:\\?'ZIP Community Profile/.test(cpage),
  '4c the Community CTA still opens the same shared modal');
ok(/HS\.openPremiumModal\(\{/.test(prop) && /'Property Insights'/.test(prop),
  '4d the Property CTA still opens the same shared modal');
ok(!/id="[a-zA-Z]*[Pp]remium[A-Za-z]*Modal"/.test(dashRaw) || !/<div class="overlay"/.test(dashRaw),
  '4e the Dashboard declares no modal of its own');

// The shared modal's own contract is unchanged — asserted on partials/shell.html, so a
// Dashboard change that edited it would fail here rather than pass quietly.
ok(/id="premiumModal"/.test(shellHtml), '4f the shared modal still lives in the shell');
ok(/◆ Coming soon/.test(shellHtml), '4g modal COMING SOON badge intact');
ok(/<h3 id="premiumTitle">Premium is being built<\/h3>/.test(shellHtml), '4h modal title intact');
ok(/Deep property reports, unlimited watched addresses/.test(shellHtml), '4i modal body intact');
ok(/id="premiumEmail"/.test(shellHtml) && /type="email"/.test(shellHtml), '4j modal email input intact');
ok(/id="premiumSubmit"[^>]*onclick="HS\.submitWaitlist\(\)"[^>]*>Notify me</.test(shellHtml),
  '4k modal "Notify me" CTA still calls the shared submit handler');
ok(/We'll only email you about Premium availability/.test(shellHtml)
   && /No spam — unsubscribe anytime/.test(shellHtml), '4l modal privacy copy intact');
ok(/id="premiumError"[^>]*role="alert"[^>]*aria-live="polite"/.test(shellHtml),
  '4m modal error state stays announced to assistive technology');
ok(/id="premiumDone"/.test(shellHtml) && /You're on the list/.test(shellHtml),
  '4n modal success state intact');
ok(/aria-modal="true"/.test(shellHtml.slice(shellHtml.indexOf('id="premiumModal"'),
   shellHtml.indexOf('id="premiumModal"') + 400)),
  '4o modal is a real dialog with aria-modal');
ok(/class="mclose"[^>]*type="button"[^>]*onclick="HS\.closeModal\('premiumModal'\)"/.test(shellHtml),
  '4p modal close control is a keyboard-reachable button');

// =====================================================================================
console.log('\n--- §5 The lead is FEATURE-level (20, 29) ---------------------------------');
// =====================================================================================

const ctx = A.premiumLeadContext();
ok(ctx.source === 'Dashboard Quality-of-Life',
  '5a source is the approved canonical value', ctx);
ok(!('zip' in ctx), '5b the context has NO zip key — there is no field for a place to arrive in');
ok(!('address' in ctx), '5c the context has NO address key either');
ok(Object.keys(ctx).length === 1, '5d the context is a source and nothing else', Object.keys(ctx));

// Normalized through the shipped waitlist module the way shell.js does it.
ok(W.normalizeSource(ctx.source) === 'Dashboard Quality-of-Life',
  '5e the source survives the shipped normalizer unchanged');
ok(W.normalizeZip(ctx.zip) === null && W.normalizeAddress(ctx.address) === null,
  '5f an absent zip/address normalizes to null, never to a guess');

// The page must not hand any place context to the opener.
const ctaBlock = (dash.match(/dashQolCta'\)\.addEventListener[\s\S]*?\n  \}\);/) || [''])[0];
ok(/premiumLeadContext\(\)/.test(ctaBlock),
  '5g the page passes the view-model\'s feature-level context, not a literal it built itself');
ok(!/zip|address|place/i.test(ctaBlock.replace('premiumLeadContext', '')),
  '5h ...and names no place field at the call site', ctaBlock);

// ⛔ ACCEPTANCE 29: none of this may ever ride along on the lead.
for (const forbidden of ['dashboard_zip', 'dashboard_address', 'dashboard_place_id',
                         'source_surface', 'source_feature', 'interest_type',
                         'last_interested_at', 'updated_at'])
  ok(!dash.includes(forbidden) && !read('lib/dashboard-aggregate.js').includes(forbidden),
    '5i no invented lead field "' + forbidden + '"');

// =====================================================================================
console.log('\n--- §6 ONE canonical write path, ONE canonical read path (21-23, 30) -----');
// =====================================================================================

ok(W.RPC === 'hs_premium_waitlist_join',
  '6a the shipped module writes through the existing trusted server-side procedure');
ok(/hs_premium_waitlist_join/.test(read('lib/premium-waitlist.js')),
  '6b ...and names no other write path');
ok(/rpc\('hs_premium_waitlist'\)/.test(acq),
  '6c the Acquisition Dashboard reads the canonical store through its existing RPC');
ok(/app_premium_waitlist/.test(acq),
  '6d ...over public.app_premium_waitlist, the canonical table');
ok(/data-tab="premium"/.test(acq) && /Premium Waitlist/.test(acq),
  '6e the Premium Waitlist tab exists for an authorized operator to find the lead in');
ok(/<th>Source<\/th>/.test(acq),
  '6f ...and it renders a Source column, which is where "Dashboard Quality-of-Life" appears');
ok(/r\.source\?esc\(r\.source\)/.test(acq),
  '6g the Source column renders the stored value verbatim — no mapping to maintain');

// ACCEPTANCE 30 + 34: nothing new was created.
ok(!/supabase[\s\S]{0,40}\.from\('app_premium_waitlist'\)/.test(dash),
  '6h the Dashboard never writes the waitlist table directly');
// The <script src="lib/premium-waitlist.js"> tag is the REUSE and must stay; what is forbidden
// is a Dashboard-OWNED one. So the haystack excludes shipped module script tags.
const dashNoTags = dash.replace(/<script[^>]*><\/script>/g, '');
for (const invented of ['waitlist', 'checkout', 'subscription', 'entitlement', 'stripe',
                        'localStorage.setItem', 'sessionStorage.setItem'])
  ok(!dashNoTags.toLowerCase().includes(invented.toLowerCase()),
    '6i no Dashboard-specific "' + invented + '" was introduced',
    (dashNoTags.match(new RegExp('.{0,40}' + invented.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.{0,40}', 'i')) || [])[0]);
ok(/<script src="lib\/premium-waitlist\.js/.test(dashRaw),
  '6i2 ...while the SHARED waitlist module IS loaded, which is the reuse this requires');
ok(!/<form|<input/.test(dash), '6j the Dashboard declares no email form of its own');

// =====================================================================================
console.log('\n--- §7 Idempotency stays SERVER-side (25-26) ------------------------------');
// =====================================================================================

// The interest identity is computed by a BEFORE INSERT trigger and arbitrated by
// `on conflict (email, interest_key) do nothing` — so a repeat submission of the SAME
// interest writes nothing, while a different feature/place context is legitimately distinct.
// Nothing client-side may duplicate, weaken or pre-empt that.
ok(!/interest_key/.test(read('lib/premium-waitlist.js')),
  '7a the client never computes or submits an interest key');
ok(!/interest_key/.test(dash), '7b ...and neither does the Dashboard');
ok(!/alreadySubmitted|hasJoined|premiumSubmitted/.test(dash + shell),
  '7c no client-side duplicate-prevention shadows the server contract');
// The response shape is deliberately uniform, so a repeat cannot be detected from the client.
ok(/The RPC answers \{ ok: true, email \} for a new lead AND for a repeat/.test(read('lib/premium-waitlist.js')),
  '7d the module documents the uniform response — a repeat is indistinguishable by design');

// =====================================================================================
console.log('\n--- §8 The card is NOT a data-quality fallback (37) -----------------------');
// =====================================================================================

// It renders identically in every state, because it reports on nothing. If it were ever
// conditional on a read succeeding, it would be hiding an outage behind a roadmap promise.
ok(!/if\s*\([^)]*avail[^)]*\)[\s\S]{0,200}dashQolPremium/.test(dash),
  '8a the Premium card is never gated on source availability');
ok(!/dashQolPremium[\s\S]{0,200}(innerHTML|hidden|style\.display)/.test(dash),
  '8b ...and nothing rewrites or hides it at runtime');
const qolBlock = (dashRaw.match(/<div class="p2" id="dashQolPremium">[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
ok(qolBlock.length > 200 && !/\$\{|'\s*\+\s*/.test(qolBlock),
  '8c the card is static markup — no data is interpolated into it at all', qolBlock.length);
// The sentence wraps across comment lines, so match the distinctive clause, not the whole line.
ok(/constant: it renders identically whether every source succeeded or every source failed/
    .test(read('lib/dashboard-aggregate.js')),
  '8d the view-model states the constancy rule where the next reader will see it');

// ACCEPTANCE 35-36: it gates nothing and changes nothing.
ok(!/premium[\s\S]{0,120}(dashChanging|dashDates|dashPlaces)/i.test(dash),
  '8e the Premium card gates none of the live sections');
ok(!/openPremiumModal[\s\S]{0,200}(state\.zip|myZip|location\.href|reload)/.test(dash),
  '8f opening the modal alters no Dashboard or global state');

console.log(fails ? '\n' + fails + ' assertion(s) failed' : '\nAll Fix 8 Premium/Acquisition assertions passed.');
process.exit(fails ? 1 : 0);
