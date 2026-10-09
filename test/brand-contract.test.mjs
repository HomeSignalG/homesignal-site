// Jody migration, Step 1: the brand/domain contract foundation. Run: node test/brand-contract.test.mjs
//
// The contract is INERT: HomeSignal is the only active identity, and nothing shipped reads the
// contract. This suite proves (a) the validator fails closed, (b) the committed contract and its
// hash are valid, (c) the future identity reaches NO shipped byte, and (d) the surfaces that
// carry the production origin still say homesignal.net. Every negative check has a positive
// control, and every "nothing found" check proves its scan covered a non-empty set.
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateContract, canonicalJson, contractHash, checkPin, assertOrigin,
  BrandContractError, SUPPORTED_CONTRACT_VERSIONS,
} from './lib/brand-contract.mjs';

let failures = 0;
const check = (name, ok, why) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${why}`}`);
  if (!ok) failures++;
};
const rejects = (name, fn, re) => {
  try { fn(); check(name, false, 'was accepted'); }
  catch (e) { check(name, e instanceof BrandContractError && (!re || re.test(e.message)), `wrong error: ${e && e.message}`); }
};
const accepts = (name, fn) => {
  try { fn(); check(name, true); } catch (e) { check(name, false, e.message); }
};

const FILE = 'docs/brand/brand-contract.v1.json';
const raw = readFileSync(FILE, 'utf8');
const good = JSON.parse(raw);
const clone = () => JSON.parse(raw);
const mut = (f) => { const c = clone(); f(c); return c; };

// ---- 1. validator: positive control, then every rejection class -------------------------
accepts('1a committed contract is valid (positive control)', () => validateContract(good));
rejects('1b missing required top-level field', () => validateContract(mut((c) => { delete c.future_identity; })), /missing required field: future_identity/);
rejects('1c missing required identity field', () => validateContract(mut((c) => { delete c.identities.jody.origin; })), /jody: missing required field: origin/);
rejects('1d unknown field rejected', () => validateContract(mut((c) => { c.activate = true; })), /unknown field: activate/);
rejects('1e unknown identity field rejected', () => validateContract(mut((c) => { c.identities.jody.enabled = true; })), /unknown field/);
rejects('1f unsupported contract_version', () => validateContract(mut((c) => { c.contract_version = 2; })), /unsupported contract_version/);
rejects('1g unsupported schema_version', () => validateContract(mut((c) => { c.schema_version = 99; })), /unsupported schema_version/);
rejects('1h wrong contract name', () => validateContract(mut((c) => { c.contract = 'other'; })), /contract name/);
for (const [label, origin] of [
  ['http scheme', 'http://jodytracks.com'], ['trailing slash', 'https://jodytracks.com/'],
  ['path', 'https://jodytracks.com/x'], ['port', 'https://jodytracks.com:8443'],
  ['userinfo', 'https://u@jodytracks.com'], ['uppercase host', 'https://JodyTracks.com'],
  ['no TLD', 'https://jody'], ['not a URL', 'jodytracks.com'], ['empty', ''],
  ['query', 'https://jodytracks.com?a=1'], ['non-string', 7],
]) {
  rejects(`1i invalid origin rejected: ${label}`, () => validateContract(mut((c) => { c.identities.jody.origin = origin; })));
}
accepts('1j origin check has a positive control', () => assertOrigin('https://jodytracks.com', 'x'));
rejects('1k both identities on one origin', () => validateContract(mut((c) => { c.identities.jody.origin = c.identities.homesignal.origin; })), /distinct origins/);
rejects('1l current and future must differ', () => validateContract(mut((c) => { c.future_identity = 'homesignal'; })), /must differ|future_identity must be jody/);
rejects('1m bad state value', () => validateContract(mut((c) => { c.identities.jody.state = 'live'; })), /state must be/);
rejects('1n extra identity rejected', () => validateContract(mut((c) => { c.identities.other = { ...c.identities.jody, origin: 'https://example.com' }; })), /exactly 2 identities/);

// ---- 2. production identity unchanged; future identity inactive --------------------------
rejects('2a activating the future identity is rejected', () => validateContract(mut((c) => { c.identities.jody.state = 'active'; })), /must be inactive/);
rejects('2b swapping the current identity is rejected', () => validateContract(mut((c) => {
  c.current_identity = 'jody'; c.future_identity = 'homesignal';
  c.identities.jody.state = 'active'; c.identities.homesignal.state = 'inactive';
})), /v1:/);
rejects('2c deactivating HomeSignal is rejected', () => validateContract(mut((c) => { c.identities.homesignal.state = 'inactive'; })), /homesignal must be active/);
rejects('2d changing the production origin is rejected', () => validateContract(mut((c) => { c.identities.homesignal.origin = 'https://example.com'; })), /homesignal origin must be/);
check('2e committed contract: HomeSignal active at https://homesignal.net, Jody inactive',
  good.identities.homesignal.state === 'active' && good.identities.homesignal.origin === 'https://homesignal.net'
  && good.identities.jody.state === 'inactive' && good.identities.jody.origin === 'https://jodytracks.com', JSON.stringify(good));
const onlyHomesignalActive = Object.values(good.identities).filter((i) => i.state === 'active').length === 1;
check('2f exactly one identity is active', onlyHomesignalActive, 'active count != 1');

// ---- 3. hash and cross-repository pin -----------------------------------------------------
const reverseKeys = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys(v[k])])) : v;
const pinned = readFileSync('docs/brand/brand-contract.v1.sha256', 'utf8').trim();
check('3a committed hash file is well-formed', /^[0-9a-f]{64}$/.test(pinned), pinned);
check('3b committed contract hashes to the committed hash', contractHash(good) === pinned, `${contractHash(good)} vs ${pinned}`);
check('3c hash ignores whitespace and key order (canonical form)',
  contractHash(JSON.parse(JSON.stringify(reverseKeys(good), null, 4))) === pinned
  && JSON.stringify(Object.keys(reverseKeys(good))) !== JSON.stringify(Object.keys(good))
  && canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }) === '{"a":[2,{"c":2,"d":1}],"b":1}', 'canonicalization unstable');
check('3d hash changes when any value changes', contractHash(mut((c) => { c.identities.jody.display_name = 'Jody2'; })) !== pinned, 'collision');
const pin = { contract_version: good.contract_version, sha256: pinned };
accepts('3e matching pin accepted (positive control)', () => checkPin(good, pin));
rejects('3f hash mismatch rejected', () => checkPin(mut((c) => { c.identities.jody.display_name = 'Changed'; }), pin), /hash mismatch/);
rejects('3g cross-repository version mismatch rejected', () => checkPin(good, { ...pin, contract_version: 2 }), /version mismatch/);
rejects('3h malformed pin rejected', () => checkPin(good, { contract_version: 1, sha256: 'abc' }), /malformed/);
rejects('3i pin cannot launder an invalid contract', () => checkPin(mut((c) => { c.identities.jody.state = 'active'; }), pin), /must be inactive/);
check('3j supported versions list is exactly [1]', JSON.stringify(SUPPORTED_CONTRACT_VERSIONS) === '[1]', JSON.stringify(SUPPORTED_CONTRACT_VERSIONS));

// ---- 4. the public artifact: contract and Jody never ship ---------------------------------
const out = mkdtempSync(join(tmpdir(), 'brand-artifact-'));
let files = [];
try {
  execFileSync('python3', ['scripts/stage_site.py', '--out', out], { stdio: 'pipe' });
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  files = walk(out).map((p) => p.slice(out.length + 1));
  check('4a staged artifact is non-empty (scan has a denominator)', files.length > 50, `files=${files.length}`);
  const bad = files.filter((f) => /brand|jody/i.test(f));
  check('4b no brand/jody path ships', bad.length === 0, bad.join(','));
  const hits = []; let withHome = 0;
  for (const f of files) {
    if (!/\.(html|js|json|xml|txt|css|svg|md)$|^CNAME$/.test(f)) continue;
    const t = readFileSync(join(out, f), 'utf8');
    if (/homesignal\.net/.test(t)) withHome++;
    if (/jodytracks|brand-contract/i.test(t) || /\bJody\b/.test(t)) hits.push(f);
  }
  check('4c positive control: shipped text files carry homesignal.net', withHome > 20, `withHome=${withHome}`);
  check('4d no shipped file references jodytracks / brand-contract / Jody', hits.length === 0, hits.join(','));
  check('4e artifact CNAME is homesignal.net', readFileSync(join(out, 'CNAME'), 'utf8').trim() === 'homesignal.net', 'CNAME');
} finally { rmSync(out, { recursive: true, force: true }); }

// ---- 5. surfaces that carry the production origin still do -------------------------------
const origin = good.identities.homesignal.origin;
check('5a CNAME == current identity host', readFileSync('CNAME', 'utf8').trim() === new URL(origin).host, 'CNAME');
const locs = [...readFileSync('sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('5b sitemap has a non-empty URL set', locs.length > 1000, `locs=${locs.length}`);
check('5c every sitemap URL is on the production origin', locs.every((u) => u.startsWith(origin + '/')), locs.find((u) => !u.startsWith(origin + '/')));
const robotsMaps = [...readFileSync('robots.txt', 'utf8').matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
check('5d robots.txt Sitemap lines non-empty and on the production origin', robotsMaps.length >= 1 && robotsMaps.every((u) => u.startsWith(origin + '/')), robotsMaps.join(','));
check('5e Bluesky DID is still did:web:homesignal.net', JSON.parse(readFileSync('.well-known/did.json', 'utf8')).id === 'did:web:' + new URL(origin).host, 'did');
check('5f index.html canonical is the production origin', readFileSync('index.html', 'utf8').includes(`rel="canonical" href="${origin}/"`), 'canonical');
const cfg = readFileSync('config.js', 'utf8');
check('5g browser runtime config (config.js) is untouched by the contract', !/jody|brand|jodytracks/i.test(cfg) && cfg.includes("DEFAULT_ZIP: '78617'"), 'config.js');

// ---- 6. the contract cannot reach a deploy or the browser by location --------------------
const pages = readFileSync('.github/workflows/pages.yml', 'utf8');
const pushBlock = pages.split(/\n  pull_request:/)[0].split('\n  push:')[1] || '';
check('6a pages.yml push filter still excludes docs/** and test/** (contract + validator live there)',
  /- '!docs\/\*\*'/.test(pushBlock) && /- '!test\/\*\*'/.test(pushBlock), 'filter changed');
check('6b contract lives under docs/brand/ and validator under test/lib/', FILE.startsWith('docs/brand/') && statSync('test/lib/brand-contract.mjs').isFile(), 'location');
const stage = readFileSync('scripts/stage_site.py', 'utf8');
check('6c stage_site.py allowlist does not name docs/ or test/ (shipping them needs a deliberate edit)',
  !/^\s*'docs\//m.test(stage) && !/^\s*'test\//m.test(stage) && !/brand/i.test(stage.split('#: Directory trees')[0]), 'allowlist drifted');

if (failures) { console.error(`\n${failures} brand-contract check(s) FAILED`); process.exit(1); }
console.log('\nbrand-contract: all checks passed');
