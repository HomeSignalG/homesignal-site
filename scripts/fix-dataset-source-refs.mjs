#!/usr/bin/env node
// One-time production fix: stamp per-record source_ref on dataset-precision app_changes.
// Uses development_reports case_number + Detroit Accela eLAPS URL pattern.
// Safe to re-run (idempotent).
//
//   node scripts/fix-dataset-source-refs.mjs [--zip=48226] [--dry-run]
import { readFileSync } from 'node:fs';

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const url = cfg.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const key = cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)[1];
const hdrs = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };

const zipArg = process.argv.find((a) => a.startsWith('--zip='));
const ZIP = zipArg ? zipArg.split('=')[1] : null;
const DRY = process.argv.includes('--dry-run');

function sourceRef(el) {
  if (el.source_registry_id?.startsWith('detroit-') && el.case_number) {
    return `https://aca-prod.accela.com/DETROIT/Cap/CapHome.aspx?module=Permits&TabName=Permits&RecordNumber=${el.case_number}`;
  }
  if (el.record_url_precision === 'dataset' && el.case_number) {
    return `${el.record_url || el.url}#case=${el.case_number}`;
  }
  return el.record_url || el.url || '';
}

async function q(path, opts = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: hdrs,
    ...opts,
    body: opts.body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  const zips = ZIP ? [ZIP] : ['48226'];
  let fixed = 0;
  for (const zip of zips) {
    const dr = await q(`development_reports?zip=eq.${zip}&select=sites`);
    const sites = (dr[0]?.sites || [])
      .filter((s) => ['development', 'civic'].includes(s.relevance))
      .map((s) => ({ title: s.label || s.title, ref: sourceRef(s) }))
      .filter((s) => s.title && s.ref);
    const changes = await q(`app_changes?zip=eq.${zip}&select=id,title,source_ref`);
    for (const c of changes) {
      const match = sites.find((s) => s.title === c.title);
      if (!match || match.ref === c.source_ref) continue;
      console.log(`${zip} ${c.id.slice(0, 8)}… ${c.source_ref.slice(-40)} → ${match.ref.slice(-60)}`);
      if (!DRY) {
        const patched = await q(`app_changes?id=eq.${c.id}`, {
          method: 'PATCH',
          headers: { ...hdrs, Prefer: 'return=representation' },
          body: JSON.stringify({ source_ref: match.ref }),
        });
        if (!patched?.length) {
          console.error(`PATCH returned 0 rows for ${c.id} — anon RLS may block writes; use db-sql migration instead`);
          process.exit(2);
        }
      }
      fixed++;
    }
  }
  console.log(DRY ? `Would fix ${fixed} row(s)` : `Fixed ${fixed} row(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
