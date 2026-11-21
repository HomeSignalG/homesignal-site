// AIR PERMITS & FILINGS for the Development Activity Report (PREPARED, NOT WIRED INTO assemble()).
// A report is a 0.5-mile circle around the subject ADDRESS (REPORT_RADIUS_MI), not a ZIP. The reader is therefore the circle reader,
// public.map1_air_permits_near (exact great-circle distance on stored points). A whole-ZIP report would call air_permits_for_zip instead;
// the two answer different questions and neither stands in for the other.
// Rules kept here: air permits are never development projects and never enter a development count; a read that fails, a source that
// is blocked/stale, or a record with no point is stated as such and never reads as "no air permits"; the agency's own status word is
// carried unchanged with its scope. Nothing here names a Deno global. It decides nothing about development.
import { DataUnavailable } from './service-rest.ts';
import type { FetchFn } from './service-rest.ts';

export type AirRecord = Record<string, unknown> & { permit_no?: string; project_no?: string; status?: string; action_kind?: string; record_url?: string };
export type AirSource = { source: string; state: string; state_name?: string; agency?: string; permit_types?: string[]; checked_at?: string; status: string };
export type AirNear = { status: string; sources: AirSource[]; records: AirRecord[] };

export const AIR_STATUS_SCOPE = 'Status applies to this air authorization only, not to the development';
export const AIR_NOTE = 'An air authorization is one permit for one activity, not approval of a whole development, and permitted limits are not measured air quality at any home.';
/** The reader is capped at 20 miles; the report radius is far below it. */
export async function readAirPermitsNear(
  conn: { base: string; svc: Record<string, string> }, fetchFn: FetchFn, lat: number, lng: number, radiusMi: number,
): Promise<AirNear> {
  let r: Response;
  try {
    r = await fetchFn(conn.base + '/rest/v1/rpc/map1_air_permits_near', {
      method: 'POST', headers: { ...conn.svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_lat: lat, p_lng: lng, p_radius_mi: radiusMi }),
    });
  } catch { throw new DataUnavailable('network'); }
  if (!r.ok) throw new DataUnavailable('http ' + r.status);
  const b = await r.json().catch(() => null);
  if (!b || typeof b !== 'object' || !Array.isArray(b.records) || !Array.isArray(b.sources)) throw new DataUnavailable('shape');
  return b as AirNear;
}

/** The report section. `read` is null when the read failed: that is "could not check", never "none". */
export function airPermitsSection(read: AirNear | null, state: { zip_state?: string } = {}) {
  if (!read) return { outcome: 'read_failed', records: [], limitations: ['Air permits and filings could not be checked for this report, so none are listed. This does not mean there are none.'] };
  const own = read.sources.filter((s) => !state.zip_state || s.state === state.zip_state);
  const complete = own.length > 0 && own.every((s) => s.status === 'complete');
  const incomplete = own.filter((s) => s.status !== 'complete');
  const limitations: string[] = [];
  if (!own.length) limitations.push('No air-permit source is registered for this state yet, so air permits are not covered by this report.');
  for (const s of incomplete) limitations.push((s.agency || s.source) + ' air permits are ' + (s.status === 'blocked' ? 'not readable by a program' : 'not current') + ', so none can be reported as absent.');
  limitations.push('Only records with a stored location can be placed within this distance; records without one are not counted here.');
  const records = read.records.map((r) => ({ ...r, status_scope: r.status ? AIR_STATUS_SCOPE : undefined }));
  return {
    outcome: records.length ? 'records' : complete ? 'none_found_in_complete_source' : 'not_established',
    records, note: AIR_NOTE, limitations,
    counts: {
      new_filings: records.filter((r) => ['application', 'registration', 'proposed_action'].includes(String(r.action_kind))).length,
      issued: records.filter((r) => r.action_kind === 'issued').length,
      renewals_or_changes: records.filter((r) => ['renewal', 'modification', 'amendment'].includes(String(r.action_kind))).length,
    },
  };
}
