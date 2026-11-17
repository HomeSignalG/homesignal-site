const UA = 'HomeSignal-source-check/1.0 (+https://jodytracks.com)';
const BASE = 'https://www.neskowincac.org';
const rb = await (await fetch(BASE + '/robots.txt', { headers: { 'user-agent': UA } })).text();
const star = rb.split(/\n\s*\n/).filter(b => /User-agent:\s*\*/i.test(b)).join('\n');
const dis = [...star.matchAll(/^\s*Disallow:\s*(\S*)/gim)].map(m => m[1]).filter(Boolean);
const toRe = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\?/g, '\\?'));
const allowed = path => !dis.some(p => toRe(p).test(path));
console.log('disallow count', dis.length, 'sample', dis.slice(0, 12).join(' '));
console.log('allowed /upcoming-events ?', allowed('/upcoming-events'));
if (!allowed('/upcoming-events')) process.exit(0);
const h = await (await fetch(BASE + '/upcoming-events', { headers: { 'user-agent': UA } })).text();
const i = h.indexOf('Campground Application Hearing');
const j = h.lastIndexOf('<article', i);
console.log('ARTICLE START', j, 'MARKUP:\n' + h.slice(j, h.indexOf('</article>', i) + 10).replace(/\s+/g, ' ').slice(0, 5000));
const link = (h.slice(j, i + 3000).match(/href="(\/upcoming-events\/[^"?#]+)"/) || [])[1];
console.log('EVENT LINK', link, 'allowed?', link && allowed(link));
if (link && allowed(link)) {
  await new Promise(r => setTimeout(r, 10500));
  const e = await (await fetch(BASE + link, { headers: { 'user-agent': UA } })).text();
  const ld = [...e.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim().slice(0, 2500));
  console.log('LD-JSON blocks', ld.length, ld.join('\n---\n'));
  const t = e.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const k = t.indexOf('Campground');
  console.log('EVENT TEXT', t.slice(Math.max(0, k - 300), k + 1800));
}
