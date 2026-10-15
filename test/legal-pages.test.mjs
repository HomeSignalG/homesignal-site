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
  ok(h.includes('hello@homesignal.net'), f + ' carries the contact address');
  ok(h.includes('<noscript>') && ['privacy.html', 'terms.html', 'refund-policy.html'].every((x) => h.includes('href="' + x + '"')), f + ' links the three policies without script');
  ok(!/Lemon\s*Squeezy|lemonsqueezy/i.test(h), f + ' does not name Lemon Squeezy');
  // Paddle (2026-10-12): accurate, conditional Merchant of Record disclosures are allowed; a claim that Paddle is approved or processing live payments is not.
  ok(!/Paddle\s+(is|has been|was)\s+(now\s+|currently\s+|already\s+)?(approved|active|live|processing)|\b(is|are)\s+(now\s+|currently\s+|already\s+)?processing\s+(live\s+)?payments|approved\s+by\s+Paddle|Paddle[- ]approved|now\s+live/i.test(text(h)), f + ' does not claim Paddle is approved or processing live payments');
  ok(!/9\.99/.test(text(h)), f + ' does not advertise the $9.99 ZIP alerts product');
  ok((text(h).match(/571-601-9432/g) || []).length >= 1 && (h.match(/571-601-9432/g) || []).length === (h.match(/<a href="tel:\+15716019432">571-601-9432<\/a>/g) || []).length, f + ' shows 571-601-9432 only as a tel:+15716019432 link');
}
const terms = text(read('terms.html'));
const rp = text(read('refund-policy.html')), rph = read('refund-policy.html'), th = read('terms.html'), ph = read('privacy.html'), ch = read('contact.html');
// Paddle disclosures and links
ok(/Paddle acts as the online reseller and Merchant of Record/.test(terms), 'Terms disclose Paddle as Merchant of Record for Paddle-processed orders');
ok(/The payment provider and applicable terms are identified during checkout/.test(terms), 'Terms say the provider is identified at checkout');
ok(th.includes('href="https://www.paddle.com/legal/refund-policy"') && rph.includes('href="https://www.paddle.com/legal/refund-policy"'), 'Terms and Refund Policy link the Paddle Refund Policy');
ok(th.includes('href="https://paddle.net"') && rph.includes('href="https://paddle.net"'), 'Terms and Refund Policy link Paddle buyer support (paddle.net)');
ok(ph.includes('href="https://www.paddle.com/legal/privacy"') && /Paddle acts as the Merchant of Record/.test(text(ph)), 'Privacy links the Paddle Privacy Notice and discloses Merchant of Record');
ok(/When paid checkout is available/.test(text(ph)), 'Privacy payment text is conditional on paid checkout being available');
// Plan facts, eligibility, free evaluation
ok(/currently offered as a free evaluation/.test(terms) && /Paid plans are not yet available/.test(terms) && !/\$\d/.test(terms), 'Terms: free evaluation, paid plans not yet available, no price');
ok(/10 free evaluation reports\. No purchase is required/.test(terms), 'Terms: 10 reports are a free evaluation');
ok(/custom quote/.test(terms), 'Terms: brokerage/team/enterprise by custom quote');
ok(/paid plans are not yet available/i.test(rp) && !/\$\d/.test(rp) && /free evaluation reports do not require payment/i.test(rp), 'Refund Policy: no price, paid plans not yet available, free evaluation needs no payment');
// Cancellation and refund are consistent across Terms and Refund Policy
ok(/Cancellation prevents future renewal charges\. It does not automatically refund payments already made/.test(terms) && /Cancellation does not automatically refund previous charges/.test(rp) && /does not automatically refund a payment already made/.test(rp), 'Terms and Refund Policy keep cancellation separate from refunds');
ok(!/\b\d+[- ]day\b|money-back|guaranteed refund/i.test(rp), 'Refund Policy promises no window or guarantee');
// Phone on all four pages
for (const [n, h] of Object.entries({ 'terms.html': th, 'privacy.html': ph, 'refund-policy.html': rph, 'contact.html': ch })) ok(h.includes('<a href="tel:+15716019432"') && text(h).includes('571-601-9432'), n + ' carries the support phone as a tel:+15716019432 link');
ok(!/\b(hours|business hours|within \d+|response time)\b/i.test(text(ch).slice(text(ch).indexOf('Other ways to reach us'))), 'Contact page invents no hours or response-time promise');
ok(!/personal, non-commercial/i.test(terms), 'Terms do not carry the personal, non-commercial clause');
ok(/HomeSignal/.test(terms), 'Terms name HomeSignal');
ok(!/\$79|per month/.test(terms + rp), 'Terms and Refund Policy carry no $79 or monthly price');
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
ok(!/\$\d/.test(dat) && /Paid plans coming/.test(dat), 'plan page shows no price and says paid plans are coming (free-only, founder 2026-10-15)');
ok(/10 Development Activity reports free/.test(dat), 'plan page publishes the 10 free reports');
for (const h of ['privacy.html', 'terms.html', 'refund-policy.html']) ok(da.includes('href="' + h + '"'), 'plan page links ' + h + ' in its own content');
const customer = [read('development-activity.html'), read('development-activity-reports.html')].map(text).join(' ');
ok(!/Lemon\s*Squeezy/i.test(customer), 'visible plan pages do not name Lemon Squeezy as the provider');
ok(!/HomeSignal, Inc|\bLLC\b|Corporation/.test(terms + ' ' + read('404.html')), 'no unverified corporate-entity name is claimed');
ok(/sole proprietorship/.test(terms), 'Terms identify HomeSignal as a sole proprietorship');
ok(/prevents the next renewal charge/.test(terms) && /through the end of the billing period you have already paid/.test(terms) && /returns to the applicable free level/.test(terms) && /saved remain accessible/.test(terms), 'Terms carry the founder cancellation rule');
ok(!/\b\d+[- ]day\b/i.test(text(read('refund-policy.html'))), 'Refund Policy states no fixed refund window');
for (const f of ['privacy.html', 'terms.html', 'refund-policy.html']) ok(/<body[^>]*data-page-type="legal"/.test(read(f)), f + ' declares data-page-type="legal"');
ok(/STATIC_PAGE_TYPES = \['legal', 'support'\]/.test(read('shell.js')) && /HS\.isStaticPage\(\)\) \{/.test(read('shell.js')), 'the shared where-line injector honors the page type');
process.exit(fails ? 1 : 0);
