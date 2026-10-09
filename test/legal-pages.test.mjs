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
  ok(!/Paddle/i.test(h), f + ' does not announce Paddle before it is approved and live');
}
const terms = text(read('terms.html'));
ok(!/personal, non-commercial/i.test(terms), 'Terms do not carry the personal, non-commercial clause');
ok(/HomeSignal/.test(terms), 'Terms name HomeSignal');
ok(/\$79 per month/.test(terms) && /100 new Development Activity reports/.test(terms), 'Terms state the $79/month, 100-report plan');
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
ok(da.includes('<div class="da-price">$79<small>/month</small></div>'), 'plan page publishes $79/month in the pricing card');
ok(/100 new Development Activity reports each month/.test(dat), 'plan page publishes 100 reports/month');
for (const h of ['privacy.html', 'terms.html', 'refund-policy.html']) ok(da.includes('href="' + h + '"'), 'plan page links ' + h + ' in its own content');
const customer = [read('development-activity.html'), read('development-activity-reports.html')].map(text).join(' ');
ok(!/Lemon\s*Squeezy/i.test(customer), 'visible plan pages do not name Lemon Squeezy as the provider');
ok(!/HomeSignal, Inc|\bLLC\b|Corporation/.test(terms + ' ' + read('404.html')), 'no unverified corporate-entity name is claimed');
ok(/sole proprietorship/.test(terms), 'Terms identify HomeSignal as a sole proprietorship');
ok(/prevents the next renewal charge/.test(terms) && /through the end of the billing period you have already paid/.test(terms) && /returns to the applicable free level/.test(terms) && /saved remain accessible/.test(terms), 'Terms carry the founder cancellation rule');
ok(!/\b\d+[- ]day\b/i.test(text(read('refund-policy.html'))), 'Refund Policy states no fixed refund window');
process.exit(fails ? 1 : 0);
