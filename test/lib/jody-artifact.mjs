// Builds the JODY LAUNCH artifact exactly as pages.yml does (stage -> generate fixture ZIP documents -> brand overlay).
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ORIGIN = 'https://jodytracks.com';
export const LANDING = ORIGIN + '/homesignalmap.html';

export function buildJodyArtifact() {
  const out = mkdtempSync(join(tmpdir(), 'map-landing-seo-'));
  execFileSync('python3', ['scripts/stage_site.py', '--src', '.', '--out', out], { stdio: 'pipe' });
  execFileSync('python3', ['scripts/gen_zip_pages.py', '--fixture', 'test/fixtures/zip-pages.json', '--out', out,
    '--now', '2026-09-28T00:00:00'], { stdio: 'pipe' });
  execFileSync('python3', ['scripts/brand_stage.py', '--dir', out, '--identity', 'jody'], { stdio: 'pipe' });
  return out;
}

export const tagAll = (h, re) => [...h.matchAll(re)].map((m) => m[1]);
export const robotsOf = (h) => tagAll(h, /<meta\s+name="robots"\s+content="([^"]*)"/gi);
export const canonOf = (h) => tagAll(h, /<link\s+rel="canonical"\s+href="([^"]*)"/gi);
