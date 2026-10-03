// THE TWO CANONICAL PROJECT READS a report is built from — moved here from get-development-activity-report/data.ts so the report and the
// Watch (docs/development-activity-watch-2026-10-03.md) call the database the same way (CLAUDE.md "one canonical truth path"):
//   radius   public.n5_projects_within_radius — which projects are near a point (the canonical spatial read)
//   hydrate  public.app_projects             — what each of them is (one row per project: the newest materialisation)
// The ledger reads are _shared/change-reads.ts. The ORDER of the reads is _shared/report-run.ts. Nothing here decides what a report says.
// It names no Deno global: the project URL, the service headers and `fetch` arrive as arguments, and it fails CLOSED (a refused or oddly shaped
// answer is DataUnavailable, never "nothing nearby").
import { DataUnavailable, inBatches, quoteIn } from './service-rest.ts';
import type { FetchFn } from './service-rest.ts';
import type { ProjectRow, RadiusRow } from './national-report.ts';

/** Rows requested from the canonical spatial read. It reports `has_more`, and a truncated area is disclosed, never hidden. */
export const RADIUS_ROW_LIMIT = 1000;

type Rest = <T>(path: string) => Promise<T[]>;

export function makeReportReads(conn: { base: string; svc: Record<string, string> }, rest: Rest, fetchFn: FetchFn) {
  const { base, svc } = conn;
  return {
    async radius(lat: number, lng: number, radiusMi: number): Promise<RadiusRow[]> {
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

    async hydrate(keys: string[]): Promise<ProjectRow[]> {
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
  };
}
