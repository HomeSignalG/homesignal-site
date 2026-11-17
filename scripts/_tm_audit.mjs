const UA = 'HomeSignal-source-check/1.0 (+https://jodytracks.com)';
const get = async u => { const r = await fetch(u, { headers: { 'user-agent': UA } }); return [r, await r.text()]; };
let [r, t] = await get('https://www.neskowincac.org/robots.txt');
console.log('ROBOTS', r.status);
const blocks = t.split(/\n\s*\n/);
for (const b of blocks) if (/User-agent:\s*\*/i.test(b) || /Sitemap/i.test(b)) console.log(b);
console.log('ANY Disallow lines under * :', blocks.filter(b => /User-agent:\s*\*/i.test(b)).join('\n'));
for (const u of ['https://www.neskowincac.org/upcoming-events?format=ical', 'https://www.neskowincac.org/upcoming-events?format=json']) {
  [r, t] = await get(u);
  console.log('\n=====', u, r.status, r.headers.get('content-type'), 'bytes', t.length);
  if (/ical/.test(u)) {
    const ev = t.split('BEGIN:VEVENT').slice(1);
    console.log('events', ev.length);
    console.log('HEADER', t.slice(0, 400).replace(/\r?\n/g, ' | '));
    for (const e of ev) if (/campground/i.test(e)) console.log('VEVENT', e.replace(/\r?\n/g, ' | ').slice(0, 1500));
  } else console.log(t.slice(0, 300));
}
