import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const UA = 'HomeSignal-source-check/1.0 (+https://jodytracks.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const r = await fetch('https://www.tillamookcounty.gov/2612/851-26-000190-PLNG', { headers: { 'user-agent': UA } });
const t = strip(await r.text());
const i = t.indexOf('Land Use Application Status');
console.log('CASE PAGE', r.status, t.slice(i, i + 1400));
const docs = [['notice', 'https://www.tillamookcounty.gov/DocumentCenter/View/16045/Notice-of-Public-Hearing'], ['packet', 'https://www.tillamookcounty.gov/DocumentCenter/View/16839/November-12-2026-Hearing-Packet---Published-November-5-2026']];
for (const [n, u] of docs) {
  await sleep(10500);
  const d = await fetch(u, { headers: { 'user-agent': UA } });
  const f = `/tmp/${n}.pdf`; writeFileSync(f, Buffer.from(await d.arrayBuffer()));
  try {
    const tx = execFileSync('pdftotext', ['-l', '4', '-layout', f, '-'], { maxBuffer: 1 << 26 }).toString().replace(/\s+/g, ' ');
    console.log(`\nPDF ${n} status=${d.status} first-pages:`, tx.slice(0, 1800));
    for (const m of tx.matchAll(/December\s+\d+|continu\w+|second (public )?hearing/gi)) console.log(`  [${m[0]}] ...${tx.slice(Math.max(0, m.index - 120), m.index + 200)}`);
  } catch (e) { console.log(`PDF ${n} text extraction failed: ${e.message}`); }
}
