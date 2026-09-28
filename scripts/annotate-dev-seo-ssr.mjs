#!/usr/bin/env node
// Build-time adapter: attach SSR Type / lifecycle labels using the ONE site authority.
//
// Does not classify. Does not copy rules. Loads lib/project-type.js and calls:
//
//   const typeInfo = HS.canonicalProjectType(row)
//   const lifecycle = HS.canonicalLifecycle(row)
//
// Render typeInfo.label and lifecycle.label. That is the canonical Development
// Type for an app_projects row and deliberately does NOT read type_raw, because
// it must match the Map 1 projection.
//
// Do NOT render HS.classifyProjectType(row) as the public SSR Type.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function arg(name, argv = process.argv) {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] || '') : '';
}

export function loadAuthority(authoritySrc) {
  const src = authoritySrc == null
    ? readFileSync(join(root, 'lib/project-type.js'), 'utf8')
    : authoritySrc;
  const window = { HS: {} };
  new Function('window', src)(window);
  const HS = window.HS;
  if (typeof HS.canonicalProjectType !== 'function'
      || typeof HS.canonicalLifecycle !== 'function') {
    throw new Error(
      'lib/project-type.js did not attach HS.canonicalProjectType / '
      + 'HS.canonicalLifecycle',
    );
  }
  return HS;
}

export function annotateEntity(HS, e) {
  const row = e && typeof e === 'object' ? e : {};
  const typeInfo = HS.canonicalProjectType(row);
  const lifecycle = HS.canonicalLifecycle(row);
  const out = { ...row, lifecycle_label: lifecycle.label };
  if (typeInfo && typeInfo.label) out.type_label = typeInfo.label;
  return out;
}

// City pages (SEO plan step 9). The ingest plane carries every city entity as a RAW
// fact [type, name, status, n]; the Type and lifecycle MIX is the same two calls above,
// counted. A Type the authority does not give (null) is counted as "Type not stated",
// never guessed. The facts are dropped from the output: the page renders the mix.
export const TYPE_NOT_STATED = 'Type not stated';

function mixOf(counts) {
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([label, n]) => ({ label, n }));
}

export function annotateCity(HS, city) {
  const types = new Map();
  const lifecycles = new Map();
  let total = 0;
  for (const f of (city && city.facts) || []) {
    if (!Array.isArray(f) || f.length !== 4) continue;
    const [type, name, status, n] = f;
    if (!Number.isInteger(n) || n < 1) continue;
    const t = HS.canonicalProjectType({ type, name });
    const tl = (t && t.label) || TYPE_NOT_STATED;
    const ll = HS.canonicalLifecycle({ status }).label;
    types.set(tl, (types.get(tl) || 0) + n);
    lifecycles.set(ll, (lifecycles.get(ll) || 0) + n);
    total += n;
  }
  const { facts, ...rest } = city || {};
  return {
    ...rest,
    facts_total: total,
    type_mix: mixOf(types),
    lifecycle_mix: mixOf(lifecycles),
    representative_entities: ((city && city.representative_entities) || [])
      .map((e) => annotateEntity(HS, e)),
  };
}

export function annotatePlane(plane, HS) {
  const out = { ...plane, zips: { ...(plane.zips || {}) } };
  for (const [zip, rec] of Object.entries(out.zips)) {
    if (!rec || !Array.isArray(rec.representative_entities)) continue;
    out.zips[zip] = {
      ...rec,
      representative_entities: rec.representative_entities.map((e) => annotateEntity(HS, e)),
    };
  }
  if (plane.cities && typeof plane.cities === 'object') {
    out.cities = {};
    for (const [key, city] of Object.entries(plane.cities)) {
      out.cities[key] = annotateCity(HS, city);
    }
  }
  out.ssr_authority = 'lib/project-type.js';
  return out;
}

function main() {
  const inPath = arg('--in');
  const outPath = arg('--out');
  if (!inPath || !outPath) {
    throw new Error('usage: annotate-dev-seo-ssr.mjs --in plane.json --out annotated.json');
  }
  const HS = loadAuthority();
  const plane = JSON.parse(readFileSync(inPath, 'utf8'));
  writeFileSync(outPath, `${JSON.stringify(annotatePlane(plane, HS))}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
