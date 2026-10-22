import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'bing-'));
const sm = join(dir, 'sm.xml');
const done = join(dir, 'done.txt');
const loc = (p) => `<url><loc>https://www.jodytracks.com${p}</loc></url>`;
writeFileSync(sm, '<urlset>' + [
  '/community/11111/', '/community/22222/', '/community/22222/', '/community/33333/projects/',
  '/homesignalmap.html?zip=44444', '/community/55555/', '/community/66666/',
].map(loc).join('') + '</urlset>');
writeFileSync(done, '# c\n11111\n  \nnot-a-zip\n');
const run = (...a) => execFileSync('python3', ['scripts/bing_next_batch.py', '--sitemap-file', sm, '--submitted', done, ...a], { encoding: 'utf8' });

const out = run('--count', '2');
const batch = out.split('----- BEGIN BATCH -----\n')[1].split('----- END BATCH -----')[0].trim().split('\n');
// only plain ZIP pages, once each, submitted ones skipped, capped by --count, sitemap order kept
assert.deepEqual(batch, ['https://www.jodytracks.com/community/22222/', 'https://www.jodytracks.com/community/55555/']);
assert.match(out, /sitemap ZIP pages 4 · already submitted 1 · still to submit 3 · this batch 2/);

// a sitemap with no ZIP pages is a failure, never "nothing left"
writeFileSync(sm, '<urlset></urlset>');
assert.throws(() => run(), /no \/community\/<zip>\/ URLs/);
console.log('bing-next-batch: ok');
