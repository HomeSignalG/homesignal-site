import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'bingd-'));
const loc = (p) => `<url><loc>https://www.jodytracks.com${p}</loc></url>`;
const cm = join(dir, 'c.xml'), mm = join(dir, 'm.xml'), sent = join(dir, 's.txt'), sentm = join(dir, 'sm.txt');
writeFileSync(cm, '<urlset>' + ['11111', '22222', '33333', '44444'].map((z) => loc(`/community/${z}/`)).join('') + loc('/community/55555/projects/') + '</urlset>');
writeFileSync(mm, '<urlset>' + ['11111', '22222', '33333', '77777'].map((z) => loc(`/map/${z}/`)).join('') + '</urlset>');
writeFileSync(sent, '# c\n11111\n22222\n');
writeFileSync(sentm, '# m\n22222\n');
const run = (env, ...a) => spawnSync('python3', ['scripts/bing_daily_submit.py', '--community-sitemap', cm, '--map-sitemap', mm,
  '--sent', sent, '--sent-maps', sentm, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
const batch = (o) => o.split('----- BEGIN BATCH -----\n')[1].split('----- END BATCH -----')[0].trim().split('\n').filter(Boolean);
const U = 'https://www.jodytracks.com';

// order: maps for sent ZIPs not yet sent as maps (11111), then unsent community pages (33333, 44444), then the other maps (33333, 77777)
const all = batch(run({}, '--day', '0', '--count', '10').stdout);
assert.deepEqual(all, [`${U}/map/11111/`, `${U}/community/33333/`, `${U}/community/44444/`, `${U}/map/33333/`, `${U}/map/77777/`]);
// a ZIP is offered once per kind; a map already sent (22222) and non-ZIP paths are never offered
assert.ok(!all.includes(`${U}/map/22222/`) && !all.some((u) => u.includes('projects')));
// the slice is chosen by day and never overlaps the next
assert.deepEqual(batch(run({}, '--day', '1', '--count', '2').stdout), [`${U}/community/44444/`, `${U}/map/33333/`]);
assert.deepEqual(batch(run({}, '--day', '0', '--count', '2').stdout), [`${U}/map/11111/`, `${U}/community/33333/`]);
// past the end: nothing to send, still success
const done = run({}, '--day', '9', '--count', '2');
assert.equal(done.status, 0); assert.match(done.stdout, /queue finished/);
// no key: nothing is sent, exit 0, and it says so
const nokey = run({}, '--day', '0');
assert.equal(nokey.status, 0); assert.match(nokey.stdout, /NOT SUBMITTED: BING_WEBMASTER_API_KEY is not set/);
// an empty sitemap is a failure, never "nothing left"
writeFileSync(mm, '<urlset></urlset>');
assert.notEqual(run({}, '--day', '0').status, 0);
assert.notEqual(run({}, '--day', '0', '--count', '101').status, 0);
// the key is read from the environment only, never printed, and the workflow never puts it on a command line
const wf = readFileSync('.github/workflows/bing-daily-submit.yml', 'utf8');
assert.ok(/BING_WEBMASTER_API_KEY: \$\{\{ secrets\.BING_WEBMASTER_API_KEY \}\}/.test(wf) && (wf.match(/secrets\./g) || []).length === 1);
assert.ok(!/run:[^\n]*BING_WEBMASTER_API_KEY/.test(wf));
assert.ok(/schedule:/.test(wf) && /permissions:\n  contents: read/.test(wf));
console.log('bing-daily-submit: ok');
