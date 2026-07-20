#!/usr/bin/env node
// Production identity audit for maps.html / app_changes.
// Checks representative ZIPs for duplicate source_ref rows and honest card counts.
//
//   node scripts/audit-map-identity.mjs
import { readFileSync } from 'node:fs';

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const url = cfg.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const key = cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)[1];
const hdrs = { apikey: key, Authorization: `Bearer ${key}` };

const ZIPS = [
  { zip: '78617', label: 'Del Valle TX (Travis)' },
  { zip: '84302', label: 'Brigham City UT' },
  { zip: '60601', label: 'Chicago IL' },
  { zip: '02138', label: 'Cambridge MA' },
  { zip: '80202', label: 'Denver CO' },
  { zip: '98101', label: 'Seattle WA' },
  { zip: '48226', label: 'Detroit MI' },
  { zip: '59718', label: 'Bozeman MT (sparse rural)' }
];

async function q(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: hdrs });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + msg); if (!c) fails++; };

console.log('Map identity production audit\n');

for (const { zip, label } of ZIPS) {
  const changes = await q(
    `app_changes?zip=eq.${zip}&select=id,title,source_ref,window_closes_at,occurred_at&order=occurred_at.desc`
  );
  const byRef = {};
  changes.forEach((c) => {
    const k = c.source_ref || c.id;
    byRef[k] = (byRef[k] || 0) + 1;
  });
  const dupRefs = Object.entries(byRef).filter(([, n]) => n > 1);
  const titles = {};
  changes.forEach((c) => {
    const t = (c.title || '').replace(/^public meeting\s*[—–-]\s*/i, '').trim();
    titles[t] = (titles[t] || 0) + 1;
  });
  const sameTitleMulti = Object.entries(titles).filter(([, n]) => n > 1);

  console.log(`\n${zip} ${label}`);
  console.log(`  app_changes rows: ${changes.length}`);
  console.log(`  duplicate source_ref: ${dupRefs.length}`);
  if (sameTitleMulti.length) {
    console.log(`  same-title occurrences (expected for recurring bodies): ${sameTitleMulti.map(([t, n]) => `${n}× ${t.slice(0, 40)}`).join('; ')}`);
  }
  ok(dupRefs.length === 0, `${zip}: no duplicate source_ref rows in app_changes`);
}

console.log('\n' + (fails ? `FAILED (${fails})` : 'All ZIPs passed source_ref uniqueness'));
process.exit(fails ? 1 : 0);
