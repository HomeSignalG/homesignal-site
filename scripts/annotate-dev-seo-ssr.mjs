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

export function annotatePlane(plane, HS) {
  const out = { ...plane, zips: { ...(plane.zips || {}) } };
  for (const [zip, rec] of Object.entries(out.zips)) {
    if (!rec || !Array.isArray(rec.representative_entities)) continue;
    out.zips[zip] = {
      ...rec,
      representative_entities: rec.representative_entities.map((e) => annotateEntity(HS, e)),
    };
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
