// Fail CI when the ingest copy of Video Producer JS drifts from the site asset.
// Run sync: node scripts/sync-video-producer-ingest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const siteJs = path.join(root, 'assets/acquisition-video-producer.js');
const shimJs = path.join(root, 'scripts/video-producer-ingest-shim.js');
const ingestRoot = process.env.HOMESIGNAL_INGEST_ROOT
  ? path.resolve(process.env.HOMESIGNAL_INGEST_ROOT)
  : path.resolve(root, '../homesignal-ingest');
const ingestJs = path.join(ingestRoot, 'dashboard/video_producer.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

if (!fs.existsSync(ingestJs)) {
  console.log('SKIP video-producer-ingest-sync — ingest repo not present at ' + ingestJs);
  process.exit(0);
}

const expected = fs.readFileSync(siteJs, 'utf8').trimEnd() + '\n\n' + fs.readFileSync(shimJs, 'utf8').trimEnd() + '\n';
const actual = fs.readFileSync(ingestJs, 'utf8');

ok(actual === expected, 'ingest video_producer.js matches site asset + shim');
ok(actual.includes('HomeSignalVideoProducer'), 'ingest copy exposes HomeSignalVideoProducer');
ok(actual.includes('initVideoProducer'), 'ingest copy exposes initVideoProducer shim');
ok(actual.includes('sanitizeStoryboard'), 'ingest copy includes persistence fixes from #388');

if (fails) { console.error('\n' + fails + ' assertion(s) failed — run: node scripts/sync-video-producer-ingest.mjs'); process.exit(1); }
console.log('\nAll video-producer-ingest-sync assertions passed.');
