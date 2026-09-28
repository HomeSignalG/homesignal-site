// NYC V1 allowlist assembly for the Future Surroundings Report JSON API.
// Hosts: only data.cityofnewyork.us. Views: uf93-f8nk, ipu4-2q9a, rbx6-tga4.
// Do not import get-address-report, geocode-address, Census, ArcGIS, or OSM.

export const HOST = 'https://data.cityofnewyork.us';
export const ALLOWED = new Set(['uf93-f8nk', 'ipu4-2q9a', 'rbx6-tga4', 'w9ak-ipjd']);
export const FORBIDDEN_HOST_RE =
  /geocoding\.geo\.census\.gov|geoclient\.nyc\.gov|geosupport|openaddresses|arcgis\.com|openstreetmap\.org|tile\.openstreetmap|get-address-report/i;

const MILES_PER_DEG_LAT = 69.0;
const ISSUANCE_TYPES: Record<string, 1> = { NB: 1, DM: 1, AL: 1, FO: 1 };
const DOBNOW_TYPES: Record<string, 1> = {
  'General Construction': 1,
  Structural: 1,
  Foundation: 1,
  'Earth Work': 1,
  'Full Demolition': 1,
};
const FILING_TYPES: Record<string, 1> = { 'New Building': 1, 'Full Demolition': 1 };
// A filing the publisher marks withdrawn is not pending work. It is not listed as such.
const FILING_DEAD_STATUS: Record<string, 1> = { 'filing withdrawn': 1 };
const NEARBY_CAP = 50;
// The report only lists records dated inside this window, and every record query
// requests the same window. An unordered row window returns the publisher's oldest
// rows, which this filter then drops, and the view goes silently empty.
const RECENT_DAYS = 365;
// Sized so a single request exhausts the window even at 1 mi in the densest part of
// the city (measured: 3,390 rows). If it ever binds, data_state.coverage records it
// rather than the report implying coverage it does not have.
const ROW_CAP = 5000;

function windowFloor(): string {
  return new Date(Date.now() - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
}

const SUFFIX: Record<string, string> = {
  STREET: 'ST', STREETS: 'ST', ST: 'ST',
  AVENUE: 'AVE', AVENUES: 'AVE', AVE: 'AVE', AV: 'AVE',
  BOULEVARD: 'BLVD', BLVD: 'BLVD',
  ROAD: 'RD', RD: 'RD',
  PLACE: 'PL', PL: 'PL',
  DRIVE: 'DR', DR: 'DR',
  LANE: 'LN', LN: 'LN',
  COURT: 'CT', CT: 'CT',
  TERRACE: 'TER', TER: 'TER',
  PARKWAY: 'PKWY', PKWY: 'PKWY',
  CIRCLE: 'CIR', CIR: 'CIR',
  SQUARE: 'SQ', SQ: 'SQ',
  HIGHWAY: 'HWY', HWY: 'HWY',
  PLAZA: 'PLZ', PLZ: 'PLZ',
};

const ORDINALS: Record<string, string> = {
  FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH',
  SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH',
};

const BOROUGH: Record<string, string> = {
  MANHATTAN: '1', 'NEW YORK': '1', NYC: '1',
  BRONX: '2',
  BROOKLYN: '3', KINGS: '3',
  QUEENS: '4',
  'STATEN ISLAND': '5', RICHMOND: '5',
};

const DATASETS = {
  addresspoint: {
    id: 'uf93-f8nk',
    name: 'AddressPoint',
    publisher: 'New York City Office of Technology and Innovation, on NYC Open Data',
  },
  issuance: {
    id: 'ipu4-2q9a',
    name: 'DOB Permit Issuance',
    publisher: 'New York City Department of Buildings, on NYC Open Data',
    registry_id: 'nyc-dob-permit-issuance',
  },
  dobnow: {
    id: 'rbx6-tga4',
    name: 'DOB NOW: Build – Approved Permits',
    publisher: 'New York City Department of Buildings, on NYC Open Data',
    registry_id: 'nyc-dobnow-approved-permits',
  },
  filings: {
    id: 'w9ak-ipjd',
    name: 'DOB NOW: Build – Job Application Filings',
    publisher: 'New York City Department of Buildings, on NYC Open Data',
    registry_id: 'nyc-dobnow-job-filings',
  },
};

export const EXCLUSIONS = [
  'Census geocoder output',
  'OpenAddresses national_address_points',
  'ZCTA / TIGER/Line membership as official ZIP or proximity',
  'NYC Geoclient or Geosupport API output',
  'the ArcGIS AddressPoint FeatureServer',
  'EPA FRS / ECHO, TCEQ, TDLR/TABS',
  'any other jurisdiction-registry entry',
  'Compute Atlas, OpenStreetMap, or Epoch placement',
  'Local News, meetings, government notices, email, or MAPS posts',
  'scores, outlooks, Quality of Life scoring, predictive sowhat prose, or Effect at this address',
  'get-address-report as a payload, cache, or embed',
];

export const INVESTIGATE =
  'This report lists Department of Buildings records on file near the matching AddressPoint. Open each official record and investigate. It does not predict traffic, utilities, insurance, or property value.';

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

export function sodaUrl(kind: 'view' | 'resource', id: string, params: Record<string, string>): string {
  if (!ALLOWED.has(id)) throw new Error('dataset not on the NYC V1 allowlist');
  const path = kind === 'view' ? `/api/views/${id}.json` : `/resource/${id}.json`;
  const u = new URL(HOST + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') u.searchParams.set(k, v);
  }
  if (FORBIDDEN_HOST_RE.test(u.toString())) throw new Error('forbidden host');
  return u.toString();
}

function upper(s: unknown): string {
  return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function normalizeHouse(raw: unknown): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^#/, '');
  if (/^0+$/.test(s)) return '0';
  return s.replace(/^0+(?=\d)/, '');
}

function normalizeStreet(raw: unknown): string {
  const s = upper(raw).replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.split(' ').map((w) => ORDINALS[w] || SUFFIX[w] || w).join(' ');
}

function streetCore(normalized: string): string {
  const parts = String(normalized || '').split(' ');
  if (parts.length > 1 && SUFFIX[parts[parts.length - 1]]) {
    return parts.slice(0, -1).join(' ');
  }
  return String(normalized || '');
}

export function parseBuyerAddress(address: string, zip: string) {
  const raw = String(address || '').trim();
  let zip5 = String(zip || '').trim();
  const fromAddr = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (!/^\d{5}$/.test(zip5) && fromAddr) zip5 = fromAddr[1];
  if (!/^\d{5}$/.test(zip5)) zip5 = '';

  let borough = '';
  for (const name of Object.keys(BOROUGH)) {
    if (upper(raw).indexOf(name) !== -1) borough = BOROUGH[name];
  }

  let house = '';
  let rest = raw;
  const m = raw.match(/^\s*(\d+[A-Z]?(?:-\d+[A-Z]?)*)\s+(.+)$/i);
  if (m) {
    house = normalizeHouse(m[1]);
    rest = m[2];
  }
  rest = rest.replace(/,?\s*(New York|NY|USA)\b/ig, ' ');
  rest = rest.replace(/\b\d{5}(?:-\d{4})?\b/, ' ');
  for (const name of Object.keys(BOROUGH)) {
    rest = rest.replace(new RegExp('\\b' + name + '\\b', 'ig'), ' ');
  }
  const street = normalizeStreet(rest);
  return { typed: raw, house, street, street_core: streetCore(street), zip: zip5, borough };
}

function streetMatches(point: Record<string, unknown>, parsed: ReturnType<typeof parseBuyerAddress>): boolean {
  const full = normalizeStreet(point.full_street_name || '');
  const name = normalizeStreet(point.street_name || '');
  const want = parsed.street;
  const core = parsed.street_core;
  if (!want) return false;
  if (full && full === want) return true;
  if (name && name === want) return true;
  if (core && name && name === core) return true;
  if (core && full && streetCore(full) === core) return true;
  return false;
}

export function matchAddressPoint(candidates: Record<string, unknown>[], parsed: ReturnType<typeof parseBuyerAddress>) {
  const rows = (candidates || []).filter((p) => {
    if (!p || !p.the_geom) return false;
    if (parsed.house && normalizeHouse(p.house_number) !== parsed.house) return false;
    if (parsed.zip && String(p.zipcode || '') !== parsed.zip) return false;
    if (parsed.borough && String(p.boroughcode || '') !== parsed.borough) return false;
    return streetMatches(p, parsed);
  });
  if (!rows.length) return { status: 'address_miss' as const, point: null };
  if (rows.length > 1) return { status: 'address_ambiguous' as const, point: null, count: rows.length };
  return { status: 'ok' as const, point: rows[0] };
}

export function pointCoords(point: Record<string, unknown> | null) {
  const g = point && point.the_geom as { coordinates?: number[] } | undefined;
  if (!g || !g.coordinates || g.coordinates.length < 2) return null;
  const lng = Number(g.coordinates[0]);
  const lat = Number(g.coordinates[1]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng };
}

function toEN(homeLat: number, homeLng: number, lat: number, lng: number): [number, number] {
  const n = (lat - homeLat) * MILES_PER_DEG_LAT;
  const e = (lng - homeLng) * MILES_PER_DEG_LAT * Math.cos((homeLat * Math.PI) / 180);
  return [Math.round(e * 1000) / 1000, Math.round(n * 1000) / 1000];
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const en = toEN(lat1, lng1, lat2, lng2);
  return Math.round(Math.sqrt(en[0] * en[0] + en[1] * en[1]) * 1000) / 1000;
}

export function bbox(lat: number, lng: number, radiusMi: number) {
  const dLat = radiusMi / MILES_PER_DEG_LAT;
  const dLng = radiusMi / (MILES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// One view stores dates as text MM/DD/YYYY, the others as ISO timestamps. The ISO
// ones are Socrata floating timestamps and carry no zone, which Date.parse then reads
// as local time: east of UTC that reports the permit a day early. They are pinned to
// UTC so the date a buyer reads does not depend on where this code runs.
function parseDateMs(raw: string): number {
  const s = String(raw || '');
  if (!s) return NaN;
  const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (us) return Date.parse(us[3] + '-' + us[1] + '-' + us[2]);
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) return Date.parse(s + 'Z');
  return Date.parse(s);
}

export function isoDate(raw: string): string {
  const t = parseDateMs(raw);
  if (!isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

// What the report actually retrieved from a view, as opposed to what it asked for.
export function coverageFor(
  rows: Record<string, unknown>[] | undefined,
  dateField: string,
  rowCap: number,
) {
  const list = rows || [];
  const dates: string[] = [];
  list.forEach((r) => {
    const d = isoDate(String((r || {})[dateField] || ''));
    if (d) dates.push(d);
  });
  dates.sort();
  return {
    fetched: list.length,
    capped: !!rowCap && list.length >= rowCap,
    oldest: dates[0] || '',
    newest: dates[dates.length - 1] || '',
  };
}

function withinDays(isoOrUs: string, days: number, now = Date.now()): boolean {
  if (!isoOrUs) return false;
  const t = parseDateMs(isoOrUs);
  if (!isFinite(t)) return false;
  const ms = (days || 365) * 86400000;
  return now - t <= ms && t <= now + 86400000;
}

function issuanceRow(r: Record<string, unknown>, home: { lat: number; lng: number }, radiusMi: number) {
  if (!r || !ISSUANCE_TYPES[String(r.permit_type || '')]) return null;
  const lat = Number(r.gis_latitude);
  const lng = Number(r.gis_longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const dist = milesBetween(home.lat, home.lng, lat, lng);
  if (dist > radiusMi) return null;
  if (!withinDays(String(r.issuance_date || ''), RECENT_DAYS)) return null;
  const en = toEN(home.lat, home.lng, lat, lng);
  return {
    source: DATASETS.issuance.registry_id,
    dataset_id: DATASETS.issuance.id,
    case_number: String(r.job__ || ''),
    type: String(r.permit_type || ''),
    status: String(r.permit_status || ''),
    stage: 'Permit issued',
    date: String(r.issuance_date || ''),
    date_label: 'Issued',
    address: [r.house__, r.street_name].filter(Boolean).join(' '),
    zip: String(r.zip_code || ''),
    lat,
    lng,
    distance_mi: dist,
    east_mi: en[0],
    north_mi: en[1],
    record_url: HOST + '/d/' + DATASETS.issuance.id,
  };
}

function dobnowRow(r: Record<string, unknown>, home: { lat: number; lng: number }, radiusMi: number) {
  if (!r || !DOBNOW_TYPES[String(r.work_type || '')]) return null;
  const lat = Number(r.latitude);
  const lng = Number(r.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const dist = milesBetween(home.lat, home.lng, lat, lng);
  if (dist > radiusMi) return null;
  if (!withinDays(String(r.issued_date || ''), RECENT_DAYS)) return null;
  const en = toEN(home.lat, home.lng, lat, lng);
  return {
    source: DATASETS.dobnow.registry_id,
    dataset_id: DATASETS.dobnow.id,
    case_number: String(r.job_filing_number || r.work_permit || ''),
    type: String(r.work_type || ''),
    status: String(r.permit_status || ''),
    stage: 'Permit approved',
    date: String(r.issued_date || ''),
    date_label: 'Issued',
    address: [r.house_no, r.street_name].filter(Boolean).join(' '),
    zip: String(r.zip_code || ''),
    lat,
    lng,
    distance_mi: dist,
    east_mi: en[0],
    north_mi: en[1],
    record_url: HOST + '/d/' + DATASETS.dobnow.id,
  };
}

function filingRow(r: Record<string, unknown>, home: { lat: number; lng: number }, radiusMi: number) {
  if (!r || !FILING_TYPES[String(r.job_type || '')]) return null;
  if (FILING_DEAD_STATUS[String(r.filing_status || '').toLowerCase()]) return null;
  const lat = Number(r.latitude);
  const lng = Number(r.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const dist = milesBetween(home.lat, home.lng, lat, lng);
  if (dist > radiusMi) return null;
  if (!withinDays(String(r.filing_date || ''), RECENT_DAYS)) return null;
  const en = toEN(home.lat, home.lng, lat, lng);
  return {
    source: DATASETS.filings.registry_id,
    dataset_id: DATASETS.filings.id,
    case_number: String(r.job_filing_number || ''),
    type: String(r.job_type || ''),
    status: String(r.filing_status || ''),
    stage: 'Filed',
    date: String(r.filing_date || ''),
    date_label: 'Filed',
    address: [r.house_no, r.street_name].filter(Boolean).join(' '),
    // postcode is the job-site ZIP. `zip` on this view is the applicant's ZIP.
    zip: String(r.postcode || ''),
    lat,
    lng,
    distance_mi: dist,
    east_mi: en[0],
    north_mi: en[1],
    record_url: HOST + '/d/' + DATASETS.filings.id,
  };
}

export function nearbyFromPublisherRows(
  issuance: Record<string, unknown>[],
  dobnow: Record<string, unknown>[],
  home: { lat: number; lng: number },
  radiusMi: number,
  filings?: Record<string, unknown>[],
) {
  const out: ReturnType<typeof issuanceRow>[] = [];
  for (const r of issuance || []) {
    const row = issuanceRow(r, home, radiusMi);
    if (row) out.push(row);
  }
  for (const r of dobnow || []) {
    const row = dobnowRow(r, home, radiusMi);
    if (row) out.push(row);
  }
  for (const r of filings || []) {
    const row = filingRow(r, home, radiusMi);
    if (row) out.push(row);
  }
  out.sort((a, b) => (a && b ? a.distance_mi - b.distance_mi : 0));
  return out.filter(Boolean);
}

function viewVersion(meta: { id?: string; viewLastModified?: number; rowsUpdatedAt?: number } | null): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.id) parts.push(meta.id);
  if (meta.viewLastModified != null) parts.push('viewLastModified=' + meta.viewLastModified);
  if (meta.rowsUpdatedAt != null) parts.push('rowsUpdatedAt=' + meta.rowsUpdatedAt);
  return parts.join(' ');
}

async function getJson(url: string) {
  if (FORBIDDEN_HOST_RE.test(url)) throw new Error('forbidden host');
  if (!url.startsWith(HOST + '/')) throw new Error('host not allowed');
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const body = await r.text();
    throw new Error('SODA HTTP ' + r.status + ' ' + String(body || '').slice(0, 160));
  }
  return r.json();
}

function quote(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canonicalize(draft: Record<string, unknown>): string {
  const copy = JSON.parse(JSON.stringify(draft));
  delete copy.report_id;
  delete copy.generated_at;
  return JSON.stringify(copy);
}

export async function assembleReport(input: {
  address?: string;
  zip?: string;
  parsed?: ReturnType<typeof parseBuyerAddress>;
  radius_mi?: number;
  address_points?: Record<string, unknown>[];
  issuance?: Record<string, unknown>[];
  dobnow?: Record<string, unknown>[];
  filings?: Record<string, unknown>[];
  versions?: Record<string, string>;
  row_cap_per_dataset?: number;
  retrieved_at?: string;
  generated_at?: string;
}) {
  const parsed = input.parsed || parseBuyerAddress(input.address || '', input.zip || '');
  let radiusMi = Number(input.radius_mi);
  if (!isFinite(radiusMi) || radiusMi <= 0) radiusMi = 0.5;
  if (radiusMi > 1) radiusMi = 1;
  const match = matchAddressPoint(input.address_points || [], parsed);
  const home = match.point ? pointCoords(match.point) : null;
  const matched = (match.status === 'ok' && home)
    ? nearbyFromPublisherRows(input.issuance || [], input.dobnow || [], home, radiusMi, input.filings || [])
    : [];
  const nearby = matched.slice(0, NEARBY_CAP);

  const rowCap = input.row_cap_per_dataset || 0;
  const coverage: Record<string, ReturnType<typeof coverageFor>> = {};
  coverage[DATASETS.issuance.id] = coverageFor(input.issuance, 'issuance_date', rowCap);
  coverage[DATASETS.dobnow.id] = coverageFor(input.dobnow, 'issued_date', rowCap);
  coverage[DATASETS.filings.id] = coverageFor(input.filings, 'filing_date', rowCap);
  const coverageComplete = Object.keys(coverage).every((id) => !coverage[id].capped);
  // A record view that is on the allowlist, credited in the attribution, and returned
  // nothing at all is the defect this field exists to surface.
  const silent = (match.status === 'ok' && home)
    ? Object.keys(coverage).filter((id) => coverage[id].fetched === 0)
    : [];

  const retrieved = input.retrieved_at || '';
  const views = [
    {
      key: 'addresspoint' as const,
      version: input.versions && input.versions.addresspoint,
      retrieved_at: retrieved,
      modifications: 'Selected the_geom, addresspointid, house_number, street_name, full_street_name, zipcode, boroughcode. Matched the buyer-supplied address string to those fields.',
    },
    {
      key: 'issuance' as const,
      version: input.versions && input.versions.issuance,
      retrieved_at: retrieved,
      modifications: 'Selected permit_type, permit_status, issuance_date, house__, street_name, gis_latitude, gis_longitude, job__, zip_code. Kept NB/DM/AL/FO with publisher coordinates inside the stated radius, issued in the last ' + RECENT_DAYS + ' days. Ordered newest first on issuance_date read as a timestamp, because the publisher stores that column as text.',
    },
    {
      key: 'dobnow' as const,
      version: input.versions && input.versions.dobnow,
      retrieved_at: retrieved,
      modifications: 'Selected work_type, permit_status, issued_date, house_no, street_name, latitude, longitude, job_filing_number, zip_code. Kept General Construction, Structural, Foundation, Earth Work, Full Demolition with publisher coordinates inside the stated radius, issued in the last ' + RECENT_DAYS + ' days.',
    },
    {
      key: 'filings' as const,
      version: input.versions && input.versions.filings,
      retrieved_at: retrieved,
      modifications: 'Selected job_type, filing_status, filing_date, house_no, street_name, latitude, longitude, job_filing_number, postcode. Kept New Building and Full Demolition with publisher coordinates inside the stated radius, filed in the last ' + RECENT_DAYS + ' days, and dropped filings the publisher marks Filing Withdrawn.',
    },
  ];

  let property = null;
  if (match.point && home) {
    property = {
      addresspointid: String(match.point.addresspointid || ''),
      house_number: String(match.point.house_number || ''),
      street_name: String(match.point.street_name || ''),
      full_street_name: String(match.point.full_street_name || ''),
      zipcode: String(match.point.zipcode || ''),
      boroughcode: String(match.point.boroughcode || ''),
      lat: home.lat,
      lng: home.lng,
    };
  }

  const draft: Record<string, unknown> = {
    product: 'HomeSignal Future Surroundings Report',
    version: 'nyc-v1',
    buyer: { address: parsed.typed, zip: parsed.zip },
    status: match.status,
    radius_mi: radiusMi,
    property,
    nearby,
    nearby_matched: matched.length,
    nearby_truncated: matched.length > nearby.length,
    attribution: views.map((v) => {
      const meta = DATASETS[v.key];
      return {
        source: meta.publisher,
        dataset: meta.id,
        name: meta.name,
        version: v.version || 'version retrieved ' + (v.retrieved_at || ''),
        modifications: v.modifications,
      };
    }),
    exclusions: EXCLUSIONS.slice(),
    investigate: INVESTIGATE,
    data_state: {
      host: 'data.cityofnewyork.us',
      datasets: [DATASETS.addresspoint.id, DATASETS.issuance.id, DATASETS.dobnow.id, DATASETS.filings.id],
      // Key order is load-bearing: report_id is a hash of JSON.stringify in insertion
      // order, so this block must stay byte-identical to lib/nyc-v1-report.js or the two
      // surfaces fingerprint the same records differently. Pinned by 8i.
      window_days: RECENT_DAYS,
      window_start: isoDate(new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()),
      row_cap_per_dataset: input.row_cap_per_dataset ?? null,
      coverage,
      coverage_complete: coverageComplete,
      silent_datasets: silent,
      versions: input.versions || {},
    },
  };

  draft.report_id = await sha256Hex(canonicalize(draft));
  draft.generated_at = input.generated_at || new Date().toISOString();
  return draft;
}

export async function loadReport(address: string, zip: string, radiusMi: number) {
  const parsed = parseBuyerAddress(address, zip);
  const retrievedAt = new Date().toISOString();
  const [apMeta, issMeta, dobMeta, addressPoints, filMeta] = await Promise.all([
    getJson(sodaUrl('view', 'uf93-f8nk', {})),
    getJson(sodaUrl('view', 'ipu4-2q9a', {})),
    getJson(sodaUrl('view', 'rbx6-tga4', {})),
    parsed.house
      ? getJson(sodaUrl('resource', 'uf93-f8nk', {
        $select: 'the_geom,addresspointid,house_number,street_name,full_street_name,zipcode,boroughcode',
        $where: 'house_number=' + quote(parsed.house) + (parsed.zip ? ' AND zipcode=' + quote(parsed.zip) : ''),
        $limit: '50',
      }))
      : Promise.resolve([]),
    getJson(sodaUrl('view', 'w9ak-ipjd', {})),
  ]);
  const versions = {
    addresspoint: viewVersion(apMeta),
    issuance: viewVersion(issMeta),
    dobnow: viewVersion(dobMeta),
    filings: viewVersion(filMeta),
  };
  const match = matchAddressPoint(addressPoints || [], parsed);
  if (match.status !== 'ok') {
    return assembleReport({
      parsed,
      address: parsed.typed,
      zip: parsed.zip,
      radius_mi: radiusMi,
      address_points: addressPoints || [],
      issuance: [],
      dobnow: [],
      filings: [],
      versions,
      row_cap_per_dataset: ROW_CAP,
      retrieved_at: retrievedAt,
    });
  }
  const home = pointCoords(match.point);
  if (!home) {
    return assembleReport({
      parsed,
      address: parsed.typed,
      zip: parsed.zip,
      radius_mi: radiusMi,
      address_points: addressPoints || [],
      issuance: [],
      dobnow: [],
      filings: [],
      versions,
      row_cap_per_dataset: ROW_CAP,
      retrieved_at: retrievedAt,
    });
  }
  const radius = radiusMi || 0.5;
  const box = bbox(home.lat, home.lng, radius);
  const [issuance, dobnow, filings] = await Promise.all([
    // Scoped on the publisher's own coordinates, which is what the report claims to use.
    // Scoping by zip_code trusted a text field the publisher does not always get right.
    getJson(sodaUrl('resource', 'ipu4-2q9a', {
        $select: 'permit_type,permit_status,issuance_date,house__,street_name,gis_latitude,gis_longitude,job__,zip_code',
        // issuance_date is a text column on this view, so it is read as a timestamp
        // to filter and order. A lexical sort mixes MM/DD/YYYY and ISO values.
        $where: [
          "permit_type in('NB','DM','AL','FO')",
          'gis_latitude is not null',
          'gis_longitude is not null',
          'gis_latitude::number between ' + box.minLat + ' and ' + box.maxLat,
          'gis_longitude::number between ' + box.minLng + ' and ' + box.maxLng,
          'issuance_date is not null',
          "issuance_date::floating_timestamp >= '" + windowFloor() + "'",
        ].join(' AND '),
        $order: 'issuance_date::floating_timestamp DESC',
        $limit: String(ROW_CAP),
    })),
    getJson(sodaUrl('resource', 'rbx6-tga4', {
      $select: 'work_type,permit_status,issued_date,house_no,street_name,latitude,longitude,job_filing_number,zip_code,work_permit',
      $where: [
        "work_type in('General Construction','Structural','Foundation','Earth Work','Full Demolition')",
        'latitude is not null',
        'longitude is not null',
        'latitude between ' + box.minLat + ' and ' + box.maxLat,
        'longitude between ' + box.minLng + ' and ' + box.maxLng,
        "issued_date >= '" + windowFloor() + "'",
      ].join(' AND '),
      $limit: String(ROW_CAP),
      $order: 'issued_date DESC',
    })),
    // postcode is still selected because it is the job-site ZIP and `zip` is the
    // applicant's, but coordinates decide whether a record is nearby.
    getJson(sodaUrl('resource', 'w9ak-ipjd', {
      $select: 'job_type,filing_status,filing_date,house_no,street_name,latitude,longitude,job_filing_number,postcode',
      $where: [
        "job_type in('New Building','Full Demolition')",
        'latitude is not null',
        'longitude is not null',
        'latitude::number between ' + box.minLat + ' and ' + box.maxLat,
        'longitude::number between ' + box.minLng + ' and ' + box.maxLng,
        "filing_date >= '" + windowFloor() + "'",
      ].join(' AND '),
      $limit: String(ROW_CAP),
      $order: 'filing_date DESC',
    })),
  ]);
  return assembleReport({
    parsed,
    address: parsed.typed,
    zip: parsed.zip,
    radius_mi: radius,
    address_points: addressPoints || [],
    issuance,
    dobnow,
    filings,
    versions,
    row_cap_per_dataset: ROW_CAP,
    retrieved_at: retrievedAt,
  });
}

export function capability() {
  return {
    product: 'HomeSignal Future Surroundings Report',
    version: 'nyc-v1',
    market: 'nyc-v1',
    host: 'data.cityofnewyork.us',
    datasets: ['uf93-f8nk', 'ipu4-2q9a', 'rbx6-tga4', 'w9ak-ipjd'],
    signed_paid_pilots: 0,
    verdict: 'NOT YET',
    note: 'POST { address, zip, radius_mi }. The function fetches only those four NYC Open Data views.',
  };
}
