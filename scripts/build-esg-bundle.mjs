#!/usr/bin/env node
// build-esg-bundle.mjs — produce the deployable esg-refresh bundle.
//
// Why a build step: MCP edge-function deploys have a ~30 KB payload ceiling (CLAUDE.md §8
// standing answer), and company-aliases.json is mostly _receipts prose — essential in the
// repo (it is the evidence for every match decision), dead weight in the runtime. This
// strips the doc-only keys, bundles with esbuild, and prints the byte count so the ceiling
// is checked rather than assumed.
//
// Usage: node scripts/build-esg-bundle.mjs
// Output: supabase/functions/esg-refresh/dist/esg-refresh.bundle.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fnDir = join(root, 'supabase/functions/esg-refresh');
const registry = JSON.parse(readFileSync(join(fnDir, 'company-aliases.json'), 'utf8'));

// Runtime needs exactly these keys. Everything else (_readme, _receipts, _section, _note,
// _verified) is documentation and stays in the repo copy only.
const RUNTIME_KEYS = ['company_key', 'canonical_name', 'wikirate_name', 'parent_key', 'site_patterns', 'deny_patterns'];
const slim = {
  companies: registry.companies
    .filter((c) => c && c.company_key)          // drops the _section marker objects
    .map((c) => Object.fromEntries(RUNTIME_KEYS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]))),
};
// The strip must not lose a matching rule — assert the behavioural fields survived intact.
for (const c of registry.companies.filter((c) => c && c.company_key)) {
  const out = slim.companies.find((s) => s.company_key === c.company_key);
  if (!out) throw new Error(`build: dropped company ${c.company_key}`);
  if (JSON.stringify(out.site_patterns) !== JSON.stringify(c.site_patterns)) throw new Error(`build: site_patterns changed for ${c.company_key}`);
  if (JSON.stringify(out.deny_patterns ?? undefined) !== JSON.stringify(c.deny_patterns ?? undefined)) throw new Error(`build: deny_patterns changed for ${c.company_key}`);
  if (out.parent_key !== c.parent_key) throw new Error(`build: parent_key changed for ${c.company_key}`);
}

const tmp = join(fnDir, '.aliases.slim.json');
writeFileSync(tmp, JSON.stringify(slim));
const entry = join(fnDir, '.index.build.ts');
writeFileSync(entry, readFileSync(join(fnDir, 'index.ts'), 'utf8')
  .replace('./company-aliases.json', './.aliases.slim.json'));

const outFile = join(fnDir, 'dist/esg-refresh.bundle.mjs');
mkdirSync(join(fnDir, 'dist'), { recursive: true });
try {
  execFileSync('npx', ['--yes', 'esbuild@0.23.0', entry, '--bundle', '--format=esm',
    '--external:jsr:*', '--minify', `--outfile=${outFile}`], { stdio: 'inherit' });
} finally {
  rmSync(tmp, { force: true });
  rmSync(entry, { force: true });
}

const bytes = readFileSync(outFile).length;
console.log(`bundle: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
if (bytes > 30000) {
  console.error('FAIL: over the ~30 KB MCP deploy ceiling — split or trim before deploying.');
  process.exit(1);
}
console.log('under the 30 KB MCP deploy ceiling — safe to deploy.');
