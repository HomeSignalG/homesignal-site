const UA = 'HomeSignal-source-check/1.0 (+https://jodytracks.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
async function page(u, keys, full) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow' });
    const t = strip(await r.text());
    console.log(`\n===== ${u}\nSTATUS ${r.status} chars=${t.length}`);
    if (full) { console.log(t.slice(0, full)); return; }
    for (const k of keys) {
      let n = 0;
      for (const m of t.matchAll(new RegExp(k, 'gi'))) {
        console.log(`[${k}] ...${t.slice(Math.max(0, m.index - 250), m.index + 450)}...`);
        if (++n >= 3) break;
      }
      if (!n) console.log(`[${k}] NOT FOUND`);
    }
  } catch (e) { console.log(`\n===== ${u}\nERROR ${e.message}`); }
}
await page('https://www.neskowincac.org/upcoming-events', ['December 3', 'campground', 'hearing'], 0);
await sleep(10500);
await page('https://www.tillamookcounty.gov/1463/Data-Access', [], 6000);
await sleep(10500);
await page('https://www.tillamookcounty.gov/1098/Land-Use-Applications', ['851-26-000190', 'December 3', 'Sahhali', '851-25-000549'], 0);
await sleep(10500);
await page('https://www.tillamookcounty.gov/937/Meetings-Agendas-Minutes', ['Planning Commission', 'December', 'Neskowin'], 0);
