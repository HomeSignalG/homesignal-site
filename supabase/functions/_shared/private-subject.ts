// THE ADDRESS AND LABEL A STORED REPORT WAS MADE FOR (Development Activity build steps 6, 7 and 8) — the ONE reader.
//
// A stored report is permanent and holds no address. The address the agent typed, and the client label they gave,
// live only in the deletable private layer (public.report_private_context), and this is the one place an edge function asks the layer for
// them: through the layer's own reader, public.report_private_context_read, and only while the layer still keeps them (state 'active').
// Once the layer has purged them, every answer here is null and a report simply shows without an address.
//
// THREE WINDOWS ONTO ONE READ, and the difference is the point:
//   subjectOf(contextId, labelMax)  the address AND the client label (cleaned for printing). For a member of the brokerage that made the
//                                   report: the report function's saved-report list and reopened report.
//   addressOf(contextId)            the address and NOTHING ELSE. For the person who holds a share link: the founder's answer of 2026-10-03
//                                   is that the client sees the street address. The agent's label is not the client's to see (it can be an
//                                   agent's own note), so this window cannot return it: there is no label in what it hands back.
//   pointOf(contextId)              the property's POINT and nothing else (build step 9). For the daily Watch job only, which must ask the canonical
//                                   spatial read what is near the property. It is not a display window: the point is never put in a response, a log,
//                                   an email or a stored row, and it has no address, label or any other column in what it hands back.
// No other column of the private layer (the normalized address, the property keys, the purge columns) is ever returned by any window.
//
// PURE of environment and network: the database call arrives as `rpc` (_shared/service-rest.ts). It fails CLOSED: a failed or oddly shaped
// read is DataUnavailable, never "no address".
import { DataUnavailable } from './service-rest.ts';
import type { ServiceRpc } from './service-rest.ts';
import { cleanDisplayName } from './evaluation-reads.ts';

export type Subject = { address: string | null; label: string | null };

export function makePrivateSubjectReads(rpc: ServiceRpc) {
  /** The private context while the layer keeps it, else null. One database call. */
  async function activeContext(contextId: string | null): Promise<{ address: unknown; label: unknown } | null> {
    if (!contextId) return null;
    const { data, error } = await rpc('report_private_context_read', { p_context: contextId });
    if (error || !Array.isArray(data)) throw new DataUnavailable('private context');
    const c = data.length === 1 ? data[0] : null;
    if (!c || c.state !== 'active') return null;
    return { address: c.address, label: c.label };
  }
  const addressText = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  return {
    /** The address and the client label a stored report was made for, for a member of the brokerage that made it. */
    async subjectOf(contextId: string | null, labelMax: number): Promise<Subject> {
      const c = await activeContext(contextId);
      if (!c) return { address: null, label: null };
      return { address: addressText(c.address), label: cleanDisplayName(c.label, labelMax) };
    },

    /** The address alone, for the holder of a share link. Never the label. */
    async addressOf(contextId: string | null): Promise<string | null> {
      const c = await activeContext(contextId);
      return c ? addressText(c.address) : null;
    },

    /**
     * The property's point, while the layer keeps it; null once it is purged or when the context holds no point. For the daily Watch job (a
     * separate read of the same function, so the display windows above can never return a coordinate by accident). A point that is not a pair
     * of finite numbers inside the globe is DataUnavailable, never "somewhere".
     */
    async pointOf(contextId: string | null): Promise<{ lat: number; lng: number } | null> {
      if (!contextId) return null;
      const { data, error } = await rpc('report_private_context_read', { p_context: contextId });
      if (error || !Array.isArray(data)) throw new DataUnavailable('private context');
      const c = data.length === 1 ? data[0] : null;
      if (!c || c.state !== 'active') return null;
      if (c.latitude === null && c.longitude === null) return null;
      const lat = typeof c.latitude === 'number' ? c.latitude : NaN, lng = typeof c.longitude === 'number' ? c.longitude : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new DataUnavailable('private context');
      return { lat, lng };
    },
  };
}
