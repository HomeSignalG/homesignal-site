// Drift-detection test: topics.js::UNIVERSAL_TOPICS (and pipeline keys) must
// match the vendored canon (topics.canon.json), which is generated from the
// ingest repo's authored topics/canon.yaml.
//
// READ-ONLY. No network, no DB. Phase 1A guardrail: detects drift only; it does
// not change subscription writes or matching. Run: node test/topic-canon.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const sameSet = (a, b) => a.length === b.length && new Set(a).size === new Set(b).size &&
  a.every(x => b.includes(x));

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const canon = JSON.parse(fs.readFileSync(path.join(root, 'topics.canon.json'), 'utf8'));

// Load topics.js in a minimal window shim (no DOM).
global.window = { HS: {} };
require('../topics.js');
const HS = global.window.HS;

ok(Array.isArray(HS.universalTopics), 'topics.js exposes HS.universalTopics');
ok(sameSet(HS.universalTopics, canon.news_subtopics),
   'UNIVERSAL_TOPICS matches canon news_subtopics (no drift)');

const pipeKeys = (HS.pipelines || []).map(p => p.key);
ok(pipeKeys.every(k => canon.pipeline_types.includes(k)),
   'every topics.js pipeline key is a canonical pipeline_type');

process.exit(fails ? 1 : 0);
