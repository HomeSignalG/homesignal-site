// scratch: read-only fetch of public Tillamook County pages, 10 s apart (robots crawl delay).
const UA = 'HomeSignal-source-check/1.0 (+https://jodytracks.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
async function get(u) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    const b = await r.text();
    console.log(`\n===== ${u}\nSTATUS ${r.status} final=${r.url} type=${ct} bytes=${b.length} last-modified=${r.headers.get('last-modified')}`);
    return { r, b, ct };
  } catch (e) { console.log(`\n===== ${u}\nERROR ${e.message}`); return null; }
}
const urls = [
  'https://www.tillamookcounty.gov/commdev/project/851-25-000549-plng851-25-000548-plng',
  'https://www.tillamookcounty.gov/1139/851-25-000549-plng851-25-000548-plng',
  'https://www.tillamookcounty.gov/2612/851-26-000190-PLNG',
  'https://www.tillamookcounty.gov/commdev/project/851-26-000190-plng',
  'https://www.tillamookcounty.gov/commdev/project/851-24-000192-plng',
  'https://www.tillamookcounty.gov/1098/Land-Use-Applications',
  'https://www.tillamookcounty.gov/commdev/project',
];
const seen = new Set();
for (const u of urls) {
  const x = await get(u);
  if (x && /html/.test(x.ct)) {
    console.log('TEXT:', strip(x.b).slice(0, 5000));
    const links = [...x.b.matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(h => /\.pdf|DocumentCenter|ViewFile|order|notice|decision|minutes|agenda/i.test(h));
    console.log('LINKS:', [...new Set(links)].slice(0, 40).join('\n  '));
    for (const l of links) if (/DocumentCenter|\.pdf/i.test(l)) seen.add(new URL(l, x.r.url).href);
  }
  await sleep(10500);
}
console.log('\n##### PDFs found:', seen.size);
for (const u of [...seen].slice(0, 12)) {
  const x = await get(u);
  if (x) console.log('TEXT:', strip(x.b).slice(0, 1500));
  await sleep(10500);
}
