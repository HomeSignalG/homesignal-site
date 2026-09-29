// Runs the Development Activity scenario corpus through ONE entry point of the report
// engine and prints what came out, as JSON, on stdout.
//
//   node test/lib/fsr-engine-runner.mjs browser [--root <checkout>]
//   node test/lib/fsr-engine-runner.mjs api     [--root <checkout>]
//
// `browser` is the entry the page uses (HSNycV1Soda.loadReport from lib/). `api` is the
// entry the edge function uses (loadReport exported by allowlist.ts). Each surface runs in
// its own process because both register their engine on globalThis: two engines loaded
// into one process would overwrite each other and could not be told apart.
//
// `--root` points the run at a different checkout, which is how a change is compared with
// the tree it started from. Time is frozen, so identical code gives identical bytes.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED, SCENARIOS, makeFetch } from './fsr-engine-corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const surface = args[0];
const rootIx = args.indexOf('--root');
const root = rootIx >= 0 ? resolve(args[rootIx + 1]) : join(here, '..', '..');

if (surface !== 'browser' && surface !== 'api') {
  console.error('usage: fsr-engine-runner.mjs <browser|api> [--root <checkout>]');
  process.exit(2);
}

const RealDate = Date;
const FIXED_MS = RealDate.parse(FIXED);
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED_MS); else super(...a); }
  static now() { return FIXED_MS; }
};

let load;
if (surface === 'browser') {
  const require = createRequire(join(root, 'package-stub.js'));
  require(join(root, 'lib/nyc-v1-report.js'));
  const Soda = require(join(root, 'lib/nyc-v1-soda.js'));
  load = (address, zip, radius) => Soda.loadReport(address, zip, radius);
} else {
  const api = await import(pathToFileURL(join(root, 'supabase/functions/get-future-surroundings-report/allowlist.ts')).href);
  load = (address, zip, radius) => api.loadReport(address, zip, radius);
}

const out = [];
for (const s of SCENARIOS) {
  const requests = [];
  globalThis.fetch = makeFetch(s, requests);
  let outcome;
  try {
    const report = await load(s.address, s.zip, s.radius_mi);
    outcome = { ok: true, report };
  } catch (e) {
    outcome = { ok: false, error: e && e.message ? e.message : String(e), type: e && e.constructor ? e.constructor.name : typeof e };
  }
  out.push({ name: s.name, requests, outcome });
}
process.stdout.write(JSON.stringify(out));
