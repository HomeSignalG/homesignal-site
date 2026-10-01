// get-development-activity-report — the real database and service reads, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and
// look at every request it would make. It contains no rule about what a report says (that is _shared/national-report.ts)
// and no rule about who may ask (that is handler.ts). It only fetches, and it fails CLOSED:
//   * a non-2xx answer is DataUnavailable, never an empty list (an empty list reads as "nothing is near you");
//   * a response that fills PostgREST's row cap is DataUnavailable, never silently cut short;
//   * the service key is sent only to the project's own URL.
import { DataUnavailable, GeocoderUnavailable } from './handler.ts';
import type { Deps, Geocoded } from './handler.ts';
import type {
  LedgerProject, ProjectRow, RadiusRow, ReportableEvent, SourceHealth,
} from '../_shared/national-report.ts';
import { RADIUS_ROW_LIMIT } from './handler.ts';

export type Config = { url: string; serviceKey: string; rights: unknown; now?: () => Date };
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** PostgREST's default response cap. A response this long may have been cut, so it is refused. */
export const POSTGREST_ROW_CAP = 1000;
const KEY_CHUNK = 25;
const CHUNK_PARALLELISM = 4;

/** A PostgREST `in.(…)` list. Each value is double-quoted; a backslash or a double quote inside a value is escaped. */
export function quoteIn(values: string[]): string {
  return '(' + values.map((v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function inBatches<T>(items: string[], run: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const parts = chunks(items, KEY_CHUNK);
  for (let i = 0; i < parts.length; i += CHUNK_PARALLELISM) {
    const got = await Promise.all(parts.slice(i, i + CHUNK_PARALLELISM).map(run));
    for (const g of got) out.push(...g);
  }
  return out;
}

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const base = cfg.url.replace(/\/+$/, '');
  const svc = { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey, Accept: 'application/json' };

  async function rest<T>(path: string): Promise<T[]> {
    let r: Response;
    try { r = await fetchFn(base + '/rest/v1/' + path, { headers: svc }); } catch { throw new DataUnavailable('network'); }
    if (!r.ok) throw new DataUnavailable('http ' + r.status);
    let rows: unknown;
    try { rows = await r.json(); } catch { throw new DataUnavailable('json'); }
    if (!Array.isArray(rows)) throw new DataUnavailable('shape');
    if (rows.length >= POSTGREST_ROW_CAP) throw new DataUnavailable('row cap reached: the answer may be incomplete');
    return rows as T[];
  }

  return {
    now: cfg.now ?? (() => new Date()),
    rights: cfg.rights,

    async authenticate(token) {
      let r: Response;
      try { r = await fetchFn(base + '/auth/v1/user', { headers: { apikey: cfg.serviceKey, Authorization: 'Bearer ' + token } }); }
      catch { throw new DataUnavailable('network'); }
      if (r.status === 401 || r.status === 403 || r.status === 404) return null; // includes the public anon key: no user
      if (!r.ok) throw new DataUnavailable('http ' + r.status);
      const u = await r.json().catch(() => null);
      return u && typeof u.email === 'string' && u.email ? { email: u.email } : null;
    },

    async isAdmin(email) {
      // exact comparison, the same as public.hs_acquisition_metrics: an email that does not match is not an admin
      const rows = await rest<{ email: string }>('dashboard_admins?select=email&limit=1&email=eq.' + encodeURIComponent(email));
      return rows.length === 1 && rows[0].email === email;
    },

    async geocode(address): Promise<Geocoded | null> {
      // the ONE geocoder: the existing geocode-address function, never a second Census client
      let r: Response;
      try {
        r = await fetchFn(base + '/functions/v1/geocode-address', {
          method: 'POST',
          headers: { ...svc, 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });
      } catch { throw new GeocoderUnavailable('network'); }
      if (!r.ok) throw new GeocoderUnavailable('http ' + r.status);
      const j = await r.json().catch(() => null);
      const m = j && j.match;
      if (!m) return null;
      if (typeof m.lat !== 'number' || typeof m.lng !== 'number' || !/^\d{5}$/.test(String(m.zip))) return null;
      return { matchedAddress: String(m.matchedAddress ?? address), lat: m.lat, lng: m.lng, zip: String(m.zip) };
    },

    async zipSupported(zip) {
      if (!/^\d{5}$/.test(zip)) return false;
      const rows = await rest<{ zip: string }>('canonical_zip_registry?select=zip&limit=1&zip=eq.' + zip);
      return rows.length === 1;
    },

    async radius(lat, lng, radiusMi): Promise<RadiusRow[]> {
      let r: Response;
      try {
        r = await fetchFn(base + '/rest/v1/rpc/n5_projects_within_radius', {
          method: 'POST',
          headers: { ...svc, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_lat: lat, p_lng: lng, p_radius_mi: radiusMi, p_limit: RADIUS_ROW_LIMIT }),
        });
      } catch { throw new DataUnavailable('network'); }
      if (!r.ok) throw new DataUnavailable('http ' + r.status); // a refused radius is an error, not "nothing nearby"
      const rows = await r.json().catch(() => null);
      if (!Array.isArray(rows)) throw new DataUnavailable('shape');
      return rows as RadiusRow[];
    },

    async hydrate(keys): Promise<ProjectRow[]> {
      const cols = 'source_key,registry_id,record_kind,name,type,type_raw,status,stage,developer,size,investment,submitted_at,date_kind,address,source_ref,last_seen_at';
      const rows = await inBatches<ProjectRow & { last_seen_at: string | null }>(keys, (b) =>
        rest('app_projects?select=' + cols + '&record_kind=eq.development&source_key=in.' + encodeURIComponent(quoteIn(b))));
      // a project has one copy per ZIP page; the newest materialisation is the one used (the order the N5 shadow read uses)
      const best = new Map<string, ProjectRow & { last_seen_at: string | null }>();
      for (const r of rows) {
        const cur = best.get(r.source_key);
        if (!cur || String(r.last_seen_at ?? '') > String(cur.last_seen_at ?? '')) best.set(r.source_key, r);
      }
      return [...best.values()].map(({ last_seen_at: _drop, ...p }) => p as ProjectRow);
    },

    async ledger(keys): Promise<LedgerProject[]> {
      const cols = 'identity_key,registry_id,comparable,change_ready,observation_count,first_observed_at,last_observed_at';
      return await inBatches<LedgerProject>(keys, (b) =>
        rest('dev_change_project?select=' + cols + '&identity_key=in.' + encodeURIComponent(quoteIn(b))));
    },

    async events(keys, sinceDay): Promise<ReportableEvent[]> {
      const cols = 'identity_key,event_type,material,observed_at,prev_facts,new_facts,changed_fields,publisher_event_type,publisher_event_date';
      return await inBatches<ReportableEvent>(keys, (b) =>
        rest('dev_change_event_reportable?select=' + cols + '&observed_at=gte.' + encodeURIComponent(sinceDay)
          + '&identity_key=in.' + encodeURIComponent(quoteIn(b))));
    },

    async health(families): Promise<SourceHealth[]> {
      return await inBatches<SourceHealth>(families, (b) =>
        rest('dev_change_source_health?select=registry_id,fetch_failures_24h,blocked_24h,truncated_24h&registry_id=in.'
          + encodeURIComponent(quoteIn(b))));
    },
  };
}
