// The report engine, as the edge function sees it.
//
// The engine is two classic scripts that the page also loads from lib/: nyc-v1-report.js
// (address matching, row shaping, the report and its fingerprint) and nyc-v1-soda.js (the
// NYC Open Data queries). They register on globalThis instead of exporting, so this module
// is the one place that loads them and reads them back.
//
// Everything the API does with a report goes through these two objects. There is no second
// implementation of any of it in this directory, and test/fsr-engine-one-source.test.mjs
// fails if one appears. The files under ./engine/ are generated copies of lib/ (see
// scripts/sync-fsr-engine.mjs), which is what keeps the page and the API on the same code.
import './engine/nyc-v1-report.js';
import './engine/nyc-v1-soda.js';

// deno-lint-ignore no-explicit-any
type Fn = (...args: any[]) => any;

export interface ReportEngine {
  DATASETS: Record<string, { id: string; name: string; publisher: string; registry_id?: string }>;
  EXCLUSIONS: string[];
  INVESTIGATE: string;
  windowStartIso: Fn;
  isoDate: Fn;
  coverageFor: Fn;
  parseBuyerAddress: Fn;
  matchAddressPoint: Fn;
  pointCoords: Fn;
  bbox: Fn;
  nearbyFromPublisherRows: Fn;
  assembleReport: Fn;
}

export interface SodaEngine {
  HOST: string;
  sodaUrl: Fn;
  loadReport: Fn;
}

const g = globalThis as unknown as { HSNycV1?: ReportEngine; HSNycV1Soda?: SodaEngine };

// A failed import would otherwise surface as "undefined is not a function" on the first
// request. Say what is wrong instead.
if (!g.HSNycV1 || !g.HSNycV1Soda) {
  throw new Error('the report engine did not register: check supabase/functions/get-future-surroundings-report/engine/');
}

export const Report: ReportEngine = g.HSNycV1;
export const Soda: SodaEngine = g.HSNycV1Soda;
