// Paddle website-review readiness (2026-10-09): Privacy, Terms and Refund Policy are three real,
// indexable pages, reachable from the ONE shared footer, and the Development Activity page
// publishes the plan. Each assertion reads the shipped files.
import { readFileSync, existsSync } from 'node:fs';
let fails = 0;
const ok = (c, m, d) => { if (c) console.log('PASS', m); else { fails++; console.log('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } };
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const pages = { 'privacy.html': 'HomeSignal Privacy Notice', 'terms.html': 'HomeSignal Terms of Service', 'refund-policy.html': 'HomeSignal Refund Policy' };
for (const [f, title] of Object.entries(pages)) {
  ok(existsSync(new URL('../' + f, import.meta.url)), f + ' exists');
  const h = read(f);
  ok(new RegExp('<title>' + title + '</title>').test(h), f + ' title is ' + title);
  ok(h.includes('<link rel="canonical" href="https://homesignal.net/' + f + '">'), f + ' canonical is its own URL');
  ok(!/noindex/i.test(h), f + ' is not noindex');
  ok(!/http-equiv="refresh"|location\.replace/.test(h), f + ' is not a redirect');
  ok(new RegExp('<h1>' + title + '</h1>').test(h), f + ' has the h1');
  // the Refund Policy sends money questions to Paddle, so it carries no HomeSignal contact line (founder, 2026-11-27); the footer still links Contact
  if (f !== 'refund-policy.html') ok(h.includes('hello@homesignal.net'), f + ' carries the contact address');
  ok(h.includes('<noscript>') && ['privacy.html', 'terms.html', 'refund-policy.html'].every((x) => h.includes('href="' + x + '"')), f + ' links the three policies without script');
  ok(!/Lemon\s*Squeezy|lemonsqueezy/i.test(h), f + ' does not name Lemon Squeezy');
  // Paddle (2026-10-12): accurate, conditional Merchant of Record disclosures are allowed; a claim that Paddle is approved or processing live payments is not.
  ok(!/Paddle\s+(is|has been|was)\s+(now\s+|currently\s+|already\s+)?(approved|active|live|processing)|\b(is|are)\s+(now\s+|currently\s+|already\s+)?processing\s+(live\s+)?payments|approved\s+by\s+Paddle|Paddle[- ]approved|now\s+live/i.test(text(h)), f + ' does not claim Paddle is approved or processing live payments');
  ok(!/9\.99/.test(text(h)), f + ' does not advertise the $9.99 ZIP alerts product');
  ok((f === 'refund-policy.html' ? (h.match(/571-601-9432/g) || []).length === 0 : (text(h).match(/571-601-9432/g) || []).length >= 1) && (h.match(/571-601-9432/g) || []).length === (h.match(/<a href="tel:\+15716019432">571-601-9432<\/a>/g) || []).length, f + ' shows 571-601-9432 only as a tel:+15716019432 link');
}
const terms = text(read('terms.html'));
const rp = text(read('refund-policy.html')), rph = read('refund-policy.html'), th = read('terms.html'), ph = read('privacy.html'), ch = read('contact.html');
// Paddle disclosures and links
ok(ph.includes('href="https://www.paddle.com/legal/privacy"') && /Paddle acts as the Merchant of Record/.test(text(ph)), 'Privacy links the Paddle Privacy Notice and discloses Merchant of Record');
ok(/When paid checkout is available/.test(text(ph)), 'Privacy payment text is conditional on paid checkout being available');
// Paid plans (founder, 2026-11-16: no free plan, no free trial; Paddle is the Merchant of Record; the customer agrees to the CURRENT terms before purchase)
const both = terms + ' ' + rp;
ok(/Last updated November 27, 2026/.test(terms) && /Last updated November 27, 2026/.test(rp), 'Terms and Refund Policy carry the current version date (November 27, 2026)');
{
  // the version the page asks a purchaser to agree to, the version the database accepts and the date these pages show are ONE value
  const pageV = /var TERMS_VERSION = '(\d{4}-\d{2}-\d{2})'/.exec(read('development-activity-reports.html'));
  const dbVs = [...read('docs/paddle-billing.sql').matchAll(/into public\.billing_terms_version \(version, effective_at\) values \('(\d{4}-\d{2}-\d{2})'/g)]; // the newest row is the current one
  const dbV = dbVs.length ? dbVs[dbVs.length - 1] : null;
  const shown = new Date(pageV[1] + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  ok(pageV && dbV && pageV[1] === dbV[1] && terms.includes('Last updated ' + shown) && rp.includes('Last updated ' + shown), 'the checkout page, the database and both legal pages name the SAME terms version', [pageV && pageV[1], dbV && dbV[1], shown]);
}
ok(/Paddle\.com is the Merchant of Record for all orders/.test(terms) && /Paddle\.com is the Merchant of Record for all orders/.test(rp), 'Terms and Refund Policy both identify Paddle.com as the Merchant of Record');
ok(/Professional: \$78 per month/.test(terms) && /renews automatically each month until you cancel/.test(terms), 'Terms: Professional is $78 per month, recurring, renews automatically until cancelled');
ok(/Private Partner Offer: \$234, paid once/.test(terms) && /Six months of Professional access/.test(terms) && /does not renew automatically/.test(terms), 'Terms: the Private Partner Offer is $234 once for six months and does not renew');
ok(/100 reports per monthly billing period/.test(terms) && /unused reports do not carry over/.test(terms), 'Terms: 100 reports per monthly period, no carry-over');
ok(/Cancelling stops future renewals and your access continues until the end of the period you have already paid for/.test(terms), 'Terms: cancellation keeps access to the end of the paid period');
ok(/ends automatically six months after purchase/.test(terms) && /ends automatically six months after purchase/.test(rp), 'Terms and Refund Policy: the partner offer expires after six months by itself');
ok(/every 30 days/.test(terms) && /every 30 days/.test(rp) && /late check does not end your access|If a check is late, we review it by hand and your access continues/.test(terms + ' ' + rp) && /confirm that you (were not or are no longer|are not) eligible/.test(terms + ' ' + rp), 'Terms and Refund Policy: 30-day eligibility re-checks, a late check never suspends, confirmed ineligibility does');
const href = (t, u) => t.includes('href="' + u + '"');
ok(/Cancel any time/.test(rp) && (rp.match(/All sales are final\. We do not offer refunds, including for a month you did not fully use or reports you did not use\./g) || []).length === 2 && !/We do not promise a refund/.test(rp)
   && /nothing in this policy limits it/.test(rp) && /Refunds and billing questions are handled by Paddle, not by HomeSignal/.test(rp) && /HomeSignal does not handle refunds or billing questions/.test(rp) && href(rph, 'https://www.paddle.com/legal/refund-policy') && href(th, 'https://www.paddle.com/legal/refund-policy')
   && /As our own rule, a full refund or a chargeback ends your access to the plan it refunds immediately/.test(rp) && /As our own rule, a full refund or chargeback ends access to the plan it refunded immediately/.test(terms),
  'Refund Policy: cancellation, all sales final, statutory rights still apply, Paddle handles refunds and billing questions, a link to Paddle\'s Refund Policy, and a full refund ending access as our own rule');
// founder 2026-11-27: customers contact Paddle for refunds and billing; neither page routes a money question to us, and neither offers a guarantee
ok(!/we will ask Paddle|ask Paddle|tell us|ask us|contact us|mailto:|tel:/i.test(rp) && !/we will ask Paddle|ask Paddle|tell us|ask us|money.back|guarantee/i.test(terms.replace(/as a guarantee/g, '')) && !/money.back|guarantee/i.test(rp),
  'neither the Terms nor the Refund Policy tells a customer to contact, tell or ask us about refunds or billing, says "we will ask Paddle", or offers a guarantee or money-back promise');
ok(/reports you (have )?already made stay available|Reports you made while your plan was active remain available/i.test(both), 'historical reports stay available after cancellation, expiry or suspension');
ok(/agree to these Terms and to the <?[^.]*Refund Policy before you pay|agree to these Terms and to the Refund Policy before you pay/.test(terms), 'Terms: the customer agrees to the Terms and Refund Policy before paying');
ok(/\$78/.test(both) && /\$234/.test(both), 'the two prices appear in the legal pages');
// no free plan, no free trial, no free-evaluation promise anywhere in the legal pages (a negation such as "no free plan" is the only mention allowed)
for (const [n, t] of [['terms.html', terms], ['refund-policy.html', rp]]) {
  const bad = [...t.matchAll(/\b(free|trial|evaluation|no payment is requested|nothing is sold|nothing to refund)\b/gi)].filter((m) => !/\b(no|not)\s+(free\s+)?$/i.test(t.slice(Math.max(0, m.index - 14), m.index)) && !/no free plan and no free trial/.test(t.slice(Math.max(0, m.index - 20), m.index + 30)));
  ok(bad.length === 0, n + ' carries no free-plan, free-trial or free-evaluation promise and no "nothing is charged" statement', bad.map((m) => t.slice(Math.max(0, m.index - 30), m.index + 30)));
}
// every customer-facing page: no obsolete free promise, and no Lemon Squeezy anywhere (visible text AND source)
{
  const pagesToScan = ['index.html', 'about.html', 'how-it-works.html', 'contact.html', 'privacy.html', 'terms.html', 'refund-policy.html', 'development-activity.html', 'development-activity-reports.html', 'reports.html', 'shared-report.html', 'dashboard.html', 'alerts.html'];
  for (const f of pagesToScan) {
    const raw = read(f), vis = text(raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, ' '));
    const lit = [...raw.replace(/<!--[\s\S]*?-->/g, '').matchAll(/(['"])((?:\\.|(?!\1).)*?)\1/g)].map((m) => m[2]).filter((x) => x.length > 8 && /[ ]/.test(x));
    const hits = (t) => [...t.matchAll(/\b(free (plan|trial|evaluation|for agents|during beta|reports?)|start free|free[- ]trial|during beta|public beta|trial (customer|period|ends?|is complete))\b/gi)].filter((m) => !/\bno (free )?$/i.test(t.slice(Math.max(0, m.index - 6), m.index)) && !/no free plan and no free trial/.test(t.slice(Math.max(0, m.index - 6), m.index + 40)));
    const bad = [...hits(vis), ...lit.flatMap((x) => hits(x))];
    ok(bad.length === 0, f + ' makes no free-plan, free-trial or beta promise in its visible text or its message strings', bad.map((m) => m[0]));
    ok(!/lemon\s*squeezy|lemonsqueezy/i.test(raw), f + ' does not mention Lemon Squeezy anywhere');
  }
  ok(!/lemonsqueezy|lemon\s*squeezy/i.test(read('supabase/functions/_shared/billing-switch.ts') + read('supabase/config.toml')), 'no Lemon Squeezy function or setting remains in the billing switch or the function config');
}
ok(!/personal, non-commercial/i.test(terms), 'Terms do not carry the personal, non-commercial clause');
ok(/HomeSignal/.test(terms), 'Terms name HomeSignal');
ok(!/\$79/.test(terms + rp) && !/9\.99/.test(terms + rp), 'Terms and Refund Policy carry no $79 and no $9.99 price');
ok(/href="refund-policy\.html"/.test(read('terms.html')), 'Terms link the Refund Policy');
ok(/share[^.]*reports[^.]*clients/i.test(terms), 'Terms allow sharing reports with clients');

const shell = read('partials/shell.html');
const foot = shell.slice(shell.indexOf('<footer class="hs-footer"'), shell.indexOf('</footer>'));
for (const h of ['privacy.html', 'terms.html', 'refund-policy.html']) ok(foot.includes('href="' + h + '"'), 'shared footer links ' + h);
ok(!/privacy\.html#terms/.test(shell), 'shared footer has no privacy.html#terms link');
ok(read('shell.js').includes("fetch('partials/shell.html'"), 'every page gets that footer through shell.js (one mechanism)');
ok(/href="\/refund-policy\.html"/.test(read('404.html')), '404 footer links the Refund Policy');
ok(read('scripts/stage_site.py').includes("'refund-policy.html'") && read('scripts/stage_site.py').includes("'terms.html'"), 'the Pages artifact includes terms and refund pages');
ok(/\/terms\.html/.test(read('scripts/gen_sitemap.py')) && /\/refund-policy\.html/.test(read('scripts/gen_sitemap.py')), 'sitemap generator lists terms and refund pages');

const da = read('development-activity.html');
const dat = text(da);
ok(/\$78\s*\/\s*month/.test(dat) && /Billed monthly and renews automatically/.test(dat) && !/beta|Paid plans coming/i.test(dat),
  'plan page shows Professional at $78/month with recurring billing disclosed and no beta wording (founder, 2026-11-14)');
ok(/100 Development Activity reports per month/.test(dat) && /Packages for brokerages, MLSs, and teams/.test(dat), 'plan page publishes the 100 monthly reports and the quote tier');
for (const h of ['privacy.html', 'terms.html', 'refund-policy.html']) ok(da.includes('href="' + h + '"'), 'plan page links ' + h + ' in its own content');
const customer = [read('development-activity.html'), read('development-activity-reports.html')].map(text).join(' ');
ok(!/Lemon\s*Squeezy/i.test(customer), 'visible plan pages do not name Lemon Squeezy as the provider');
ok(!/HomeSignal, Inc|\bLLC\b|Corporation/.test(terms + ' ' + read('404.html')), 'no unverified corporate-entity name is claimed');
ok(/sole proprietorship/.test(terms), 'Terms identify HomeSignal as a sole proprietorship');
for (const f of ['privacy.html', 'terms.html', 'refund-policy.html']) ok(/<body[^>]*data-page-type="legal"/.test(read(f)), f + ' declares data-page-type="legal"');
ok(/STATIC_PAGE_TYPES = \['legal', 'support'\]/.test(read('shell.js')) && /HS\.isStaticPage\(\)\) \{/.test(read('shell.js')), 'the shared where-line injector honors the page type');
process.exit(fails ? 1 : 0);
