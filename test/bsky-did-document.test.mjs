// The Bluesky feed generator's DID document, served at https://homesignal.net/.well-known/did.json.
//
// WHY THIS FILE EXISTS. HomeSignal's Bluesky custom feeds (by TYPE and by ZIP) are records on the
// @homesignal-tracker.bsky.social account whose `did` is did:web:homesignal.net. The Bluesky
// AppView resolves that DID by fetching this file, reads the `#bsky_fg` service, and sends every
// getFeedSkeleton request to its serviceEndpoint — the `xrpc` Edge Function in
// homesignal-ingest. If this file drifts, every subscriber's feed shows as offline, and nothing
// on this site would notice. The producer of record is homesignal-ingest
// bluesky/lib/feed-contract.mjs::didDocument(); its fixture fixtures/bsky/did.json is asserted
// equal to that function there, and the registration workflow refuses to register a feed unless
// the DEPLOYED copy of this file matches it. This test pins the committed copy.
//
// Run: node test/bsky-did-document.test.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let failures = 0;
const check = (name, ok, why) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${why}`}`);
  if (!ok) failures++;
};

const raw = readFileSync('.well-known/did.json', 'utf8');
let doc = null;
try { doc = JSON.parse(raw); } catch (e) { /* reported below */ }
check('1 did.json is valid JSON', doc !== null, 'parse failed');

const EXPECTED = {
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: 'did:web:homesignal.net',
  service: [{
    id: '#bsky_fg',
    type: 'BskyFeedGenerator',
    serviceEndpoint: 'https://qwnnmljucajnexpxdgxr.functions.supabase.co',
  }],
};
check('2 did.json is exactly the feed-generator document', JSON.stringify(doc) === JSON.stringify(EXPECTED),
  `got ${raw}`);

// The AppView builds the request URL with new URL('/xrpc/<nsid>', serviceEndpoint), which
// REPLACES any path. An endpoint carrying a path (e.g. /functions/v1) would silently route
// every request to the wrong place.
const ep = doc && doc.service && doc.service[0] && doc.service[0].serviceEndpoint;
check('3 serviceEndpoint is a bare https origin', typeof ep === 'string' && new URL(ep).pathname === '/' && ep.startsWith('https://') && !ep.endsWith('/'),
  `endpoint ${ep}`);

// It must actually SHIP. The Pages artifact is an allowlist (scripts/stage_site.py); a file
// committed here but absent from the allowlist 404s in production with every check green.
const shipped = JSON.parse(execFileSync('python3', ['-c',
  'import json,sys; sys.path.insert(0,"scripts"); import stage_site; print(json.dumps(stage_site.staged_paths(".")))'],
  { encoding: 'utf8' }));
check('4 .well-known/did.json is in the Pages artifact', shipped.includes('.well-known/did.json'),
  'stage_site.py does not ship it');
check('4z control: the artifact read is real (index.html ships)', shipped.includes('index.html'),
  'staged_paths returned an artifact without index.html, so the check above proves nothing');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall checks passed');
