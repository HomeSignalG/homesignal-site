// The service-role reads that every ADMIN edge function in this project makes — moved here VERBATIM from
// get-development-activity-report/data.ts so the allow-list and the PostgREST helper have ONE definition
// (CLAUDE.md "one canonical truth path"). Two functions now ask who may call them: the national report and Changes Since
// Report / Follow. Neither carries its own copy of "is this user an admin" or "what counts as a complete read".
//
// This file names no Deno global: the caller passes the environment and `fetch` in, so a test can hand it a stub and look at
// every request. It holds no rule about what a report says and no rule about who may ask (that is admin-gate.ts). It only
// fetches, and it fails CLOSED:
//   * a non-2xx answer is DataUnavailable, never an empty list (an empty list reads as "nothing is near you");
//   * a response that fills PostgREST's row cap is DataUnavailable, never silently cut short;
//   * the service key is sent only to the project's own URL.
/** A read failed. The caller answers 502 and says nothing about which read. */
export class DataUnavailable extends Error {}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

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

export async function inBatches<T>(items: string[], run: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const parts = chunks(items, KEY_CHUNK);
  for (let i = 0; i < parts.length; i += CHUNK_PARALLELISM) {
    const got = await Promise.all(parts.slice(i, i + CHUNK_PARALLELISM).map(run));
    for (const g of got) out.push(...g);
  }
  return out;
}

export function makeServiceReads(cfg: { url: string; serviceKey: string }, fetchFn: FetchFn) {
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

  async function authenticate(token: string): Promise<{ email: string } | null> {
    let r: Response;
    try { r = await fetchFn(base + '/auth/v1/user', { headers: { apikey: cfg.serviceKey, Authorization: 'Bearer ' + token } }); }
    catch { throw new DataUnavailable('network'); }
    if (r.status === 401 || r.status === 403 || r.status === 404) return null; // includes the public anon key: no user
    if (!r.ok) throw new DataUnavailable('http ' + r.status);
    const u = await r.json().catch(() => null);
    return u && typeof u.email === 'string' && u.email ? { email: u.email } : null;
  }

  async function isAdmin(email: string): Promise<boolean> {
    // exact comparison, the same as public.hs_acquisition_metrics: an email that does not match is not an admin
    const rows = await rest<{ email: string }>('dashboard_admins?select=email&limit=1&email=eq.' + encodeURIComponent(email));
    return rows.length === 1 && rows[0].email === email;
  }

  return { base, svc, rest, authenticate, isAdmin };
}
