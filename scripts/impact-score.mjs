#!/usr/bin/env node
// Stage-2 batch scorer for the Development impact system — applies the ONE
// canonical resolver (lib/impact-resolver.js) to development_impact_analyses
// rows and stores the deterministic results. The stored score is the BASE
// (distance weight 1.0); pages re-apply distance decay per selected home.
//
// Modes:
//   node scripts/impact-score.mjs --in rows.json --out scored.json
//       Offline/pure: rows.json = [{source_ref, extracted_facts, extraction_status,
//       project?}] → writes the scored field set per row. Used by the sandboxed
//       pilot (data bridged via MCP) and by tests.
//   node scripts/impact-score.mjs --supabase [--limit N]
//       CI mode: reads rows needing scoring via PostgREST (extraction done and
//       scoring_version stale/absent, or extracted_at > scored_at; plus
//       fetch-failed/unreadable rows, scored as metadata fallback from their
//       app_projects metadata), writes results back. Requires SUPABASE_URL +
//       SUPABASE_SERVICE_ROLE_KEY. Never bulk-runs beyond --limit (default 50).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || { HS: {} };
const resolver = require('../lib/impact-resolver.js');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const flag = (name) => args.includes(name);

function scoreRow(row) {
  const failed = row.extraction_status !== 'extracted' || !row.extracted_facts;
  const res = resolver.resolveProjectImpact({
    extractedFacts: failed ? null : row.extracted_facts,
    projectMetadata: row.project || {},
    distanceMiles: null            // base score — pages apply distance decay
  });
  return {
    source_ref: row.source_ref,
    impact_score: res.score,
    impact_level: res.level,
    impact_direction: res.direction,
    impact_sentence: res.sentence,
    impact_confidence: res.confidence,
    impact_categories: res.categoryScores.map((c) => c.category),
    category_scores: res.categoryScores,
    impact_evidence: res.evidence,
    scoring_version: res.version,
    analysis_basis: res.basis
  };
}

async function pg(path, init) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }
  const r = await fetch(url + '/rest/v1/' + path, Object.assign({
    headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      (init && init.headers) || {})
  }, init));
  if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.status === 204 ? null : r.json();
}

async function runSupabase() {
  const limit = parseInt(opt('--limit') || '50', 10);
  const V = resolver.IMPACT_RESOLVER_VERSION;
  const rows = await pg('development_impact_analyses'
    + '?or=(and(extraction_status.eq.extracted,or(scoring_version.is.null,scoring_version.neq.' + V + ',scored_at.lt.extracted_at)),'
    + 'and(extraction_status.in.(fetch_failed,unreadable),scoring_version.is.null))'
    + '&limit=' + limit);
  let n = 0;
  for (const row of rows) {
    if (row.extraction_status !== 'extracted') {
      // metadata fallback — pull the record's own metadata for a conservative result
      const projs = await pg('app_projects?source_ref=eq.' + encodeURIComponent(row.source_ref) + '&limit=1');
      row.project = projs[0] || {};
    }
    const upd = scoreRow(row);
    delete upd.source_ref;
    upd.scored_at = new Date().toISOString();
    upd.updated_at = upd.scored_at;
    await pg('development_impact_analyses?source_ref=eq.' + encodeURIComponent(row.source_ref), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(upd)
    });
    n++;
    console.log('scored', row.source_ref, '→', upd.impact_score, upd.impact_level, upd.impact_direction, 'conf', upd.impact_confidence);
  }
  console.log(n + ' row(s) scored at ' + V);
}

if (flag('--supabase')) {
  runSupabase().catch((e) => { console.error(e); process.exit(1); });
} else {
  const inFile = opt('--in'), outFile = opt('--out');
  if (!inFile) { console.error('usage: impact-score.mjs --in rows.json --out scored.json | --supabase'); process.exit(1); }
  const rows = JSON.parse(readFileSync(inFile, 'utf8'));
  const scored = rows.map(scoreRow);
  const out = JSON.stringify(scored, null, 2);
  if (outFile) writeFileSync(outFile, out); else console.log(out);
}
