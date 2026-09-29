// NYC V1 allowlist API for the Development Activity report (legacy slug: future-surroundings).
// Hosts: only data.cityofnewyork.us. Views: uf93-f8nk, ipu4-2q9a, rbx6-tga4, w9ak-ipjd.
// Do not import get-address-report, geocode-address, Census, ArcGIS, or OSM.
//
// This file holds only what is specific to the API: request validation and the capability
// document. The report itself (address matching, the four record queries, row shaping, the
// fingerprint) is the shared engine in ./engine.ts, the same code the page runs. Keep it
// that way: a second copy of any of that here is a second report engine.
import { Report, Soda } from './engine.ts';

export const HOST: string = Soda.HOST;
export const EXCLUSIONS: string[] = Report.EXCLUSIONS;
export const INVESTIGATE: string = Report.INVESTIGATE;

export const windowStartIso = Report.windowStartIso;
export const isoDate = Report.isoDate;
export const coverageFor = Report.coverageFor;
export const parseBuyerAddress = Report.parseBuyerAddress;
export const matchAddressPoint = Report.matchAddressPoint;
export const pointCoords = Report.pointCoords;
export const bbox = Report.bbox;
export const nearbyFromPublisherRows = Report.nearbyFromPublisherRows;
export const assembleReport = Report.assembleReport;
export const sodaUrl = Soda.sodaUrl;
export const loadReport = Soda.loadReport;

const FORBIDDEN_REQUEST_KEYS = new Set([
  'lat', 'lng', 'geocode', 'census', 'openaddresses', 'arcgis',
  'osm', 'score', 'outlook', 'sowhat', 'impact',
]);

export function validateApiRequest(body: unknown): {
  ok: boolean;
  error?: string;
  address?: string;
  zip?: string;
  radius_mi?: number;
  market?: string;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'JSON object required' };
  }
  const rec = body as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (FORBIDDEN_REQUEST_KEYS.has(key.toLowerCase())) {
      return { ok: false, error: 'field not on the NYC V1 allowlist: ' + key };
    }
  }
  if (rec.market && rec.market !== 'nyc-v1' && rec.market !== 'nyc') {
    return { ok: false, error: 'market is not assemblable' };
  }
  const address = String(rec.address || '').trim();
  if (!address) return { ok: false, error: 'address required' };
  const zip = String(rec.zip || '').trim();
  if (zip && !/^\d{5}$/.test(zip)) return { ok: false, error: 'zip must be five digits' };
  let radius = Number(rec.radius_mi);
  if (!isFinite(radius) || radius <= 0) radius = 0.5;
  if (radius > 1) radius = 1;
  return { ok: true, address, zip, radius_mi: radius, market: 'nyc-v1' };
}

export function capability() {
  return {
    product: 'HomeSignal Future Surroundings Report',
    version: 'nyc-v1',
    market: 'nyc-v1',
    host: new URL(Soda.HOST).host,
    datasets: Object.values(Report.DATASETS).map((d) => d.id),
    signed_paid_pilots: 0,
    verdict: 'NOT YET',
    note: 'POST { address, zip, radius_mi }. The function fetches only those four NYC Open Data views.',
  };
}
