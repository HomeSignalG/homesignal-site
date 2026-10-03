// PROPERTY WATCH, as the edge functions reach it (Development Activity build step 9).
//
// The database owns every decision here (docs/property-watch.sql): who may watch a stored report, how many a brokerage may have, whether the
// property is still kept, which watches are due, when the next check is, and what the agent has already been told. This file only calls those
// functions, checks the shape of what comes back, and turns the database's refusals into named errors. It is the ONE place an edge function
// names them, so the agent's function and the daily job cannot read a watch two different ways.
//
// PURE of environment and network: the database calls arrive as `rpc` and `rest` (_shared/service-rest.ts). Everything fails CLOSED: a failed
// or oddly shaped answer is DataUnavailable, never "no watches" or "nothing due".
import { DataUnavailable } from './service-rest.ts';
import type { ServiceRpc } from './service-rest.ts';
import { UUID } from './evaluation-reads.ts';
import { EVENT_TYPES } from './property-watch.ts';
import type { SeenKey } from './property-watch.ts';

/** The report is not one of the caller's own brokerage's, does not exist, the brokerage has no standing, or the watch is not the caller's. All one answer. */
export class WatchNotFound extends Error {}
/** The brokerage already has the most watches it may have (the database's own limit). */
export class WatchLimitReached extends Error {}
/** The report has no private context, or the layer purged it: there is no property left to watch. */
export class PropertyNotKept extends Error {}

const isTime = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const maybeTime = (v: unknown) => v === null || isTime(v);

/** The outcomes a watch can show. Mirrors the database's check constraint (docs/property-watch.sql). */
export const OUTCOMES = ['CHECKED', 'CHECKED_PARTIAL', 'NOTIFIED', 'READ_FAILED', 'EMAIL_FAILED', 'NO_RECIPIENT'] as const;
export type Outcome = typeof OUTCOMES[number];
export type SuccessOutcome = 'CHECKED' | 'CHECKED_PARTIAL' | 'NOTIFIED';
export type FailureOutcome = 'READ_FAILED' | 'EMAIL_FAILED' | 'NO_RECIPIENT';
export type EndReason = 'STANDING_LOST' | 'PROPERTY_NOT_KEPT';

/** One of the caller's watches. The context handle is for the caller's own address read; it is never put in a response. */
export type WatchRow = {
  watch_id: string; report_id: string; number: number | null; generated_at: string; private_context_id: string | null;
  created_at: string; last_run_at: string | null; last_outcome: Outcome | null; next_due_at: string;
};
export type StartedWatch = { watch_id: string; created_at: string; started: boolean };
export type Claimed = { watch_id: string; report_id: string; user_id: string };

function watchRow(r: unknown): WatchRow {
  const x = r as Record<string, unknown> | null;
  if (!x || !isUuid(x.watch_id) || !isUuid(x.report_id) || !(x.number === null || Number.isInteger(x.number)) || !isTime(x.generated_at)
      || !(x.private_context_id === null || isUuid(x.private_context_id)) || !isTime(x.created_at) || !maybeTime(x.last_run_at)
      || !(x.last_outcome === null || (typeof x.last_outcome === 'string' && (OUTCOMES as readonly string[]).includes(x.last_outcome))) || !isTime(x.next_due_at)) {
    throw new DataUnavailable('shape');
  }
  return {
    watch_id: x.watch_id, report_id: x.report_id, number: x.number as number | null, generated_at: x.generated_at as string,
    private_context_id: x.private_context_id as string | null, created_at: x.created_at as string, last_run_at: x.last_run_at as string | null,
    last_outcome: x.last_outcome as Outcome | null, next_due_at: x.next_due_at as string,
  };
}

type Rest = <T>(path: string) => Promise<T[]>;

export function makeWatchReads(rpc: ServiceRpc, rest: Rest) {
  return {
    // ── the agent's three (public.evaluation_property_watch_*) ──────────────────────────────────────────────────────────────

    /** Start watching one of the caller's own brokerage's stored reports. Idempotent: `started` is false when the agent already was. */
    async startWatch(userId: string, reportId: string): Promise<StartedWatch> {
      if (!isUuid(reportId)) throw new WatchNotFound('malformed');
      const { data, error } = await rpc('evaluation_property_watch_start', { p_user_id: userId, p_report_id: reportId });
      if (error) {
        if (error.message === 'NOT_FOUND') throw new WatchNotFound('refused');
        if (error.message === 'WATCH_LIMIT_REACHED') throw new WatchLimitReached('refused');
        if (error.message === 'PROPERTY_NOT_KEPT') throw new PropertyNotKept('refused');
        throw new DataUnavailable('evaluation_property_watch_start');
      }
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || !isUuid(r.watch_id) || !isTime(r.created_at) || typeof r.started !== 'boolean') throw new DataUnavailable('shape');
      return { watch_id: r.watch_id, created_at: r.created_at, started: r.started };
    },

    /** The caller's own watches, newest first. */
    async watchesOf(userId: string): Promise<WatchRow[]> {
      const { data, error } = await rpc('evaluation_property_watches_of', { p_user_id: userId });
      if (error) throw new DataUnavailable('evaluation_property_watches_of');
      if (!Array.isArray(data) || data.length > 200) throw new DataUnavailable('shape');
      return data.map(watchRow);
    },

    /** Stop one of the caller's own watches. A watch that is not theirs, is unknown or was already stopped is WatchNotFound. */
    async stopWatch(userId: string, watchId: string): Promise<void> {
      if (!isUuid(watchId)) throw new WatchNotFound('malformed');
      const { data, error } = await rpc('evaluation_property_watch_stop', { p_user_id: userId, p_watch_id: watchId });
      if (error) {
        if (error.message === 'NOT_FOUND') throw new WatchNotFound('refused');
        throw new DataUnavailable('evaluation_property_watch_stop');
      }
      if (data !== true) throw new DataUnavailable('shape');
    },

    // ── the daily job's (public.property_watch_*) ─────────────────────────────────────────────────────────────────────────

    /** Lease up to `limit` watches that are due, oldest due first. */
    async claim(limit: number): Promise<Claimed[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DataUnavailable('claim size');
      const { data, error } = await rpc('property_watch_claim', { p_limit: limit });
      if (error) throw new DataUnavailable('property_watch_claim');
      if (!Array.isArray(data) || data.length > limit) throw new DataUnavailable('shape');
      return data.map((r) => {
        if (!r || !isUuid(r.watch_id) || !isUuid(r.report_id) || !isUuid(r.user_id)) throw new DataUnavailable('shape');
        return { watch_id: r.watch_id, report_id: r.report_id, user_id: r.user_id };
      });
    },

    /** What the agent has already been told about this watch. */
    async seenOf(watchId: string): Promise<SeenKey[]> {
      if (!isUuid(watchId)) throw new DataUnavailable('watch id');
      const rows = await rest<SeenKey>('property_watch_seen?select=project_id,event_type,observed_at&watch_id=eq.' + encodeURIComponent(watchId));
      for (const r of rows) {
        if (!r || typeof r.project_id !== 'string' || !(EVENT_TYPES as readonly string[]).includes(r.event_type) || !isTime(r.observed_at)) throw new DataUnavailable('shape');
      }
      return rows;
    },

    /** A check finished. `told` is exactly what the email listed (empty unless the outcome is NOTIFIED). False when the watch no longer exists. */
    async recordRun(watchId: string, outcome: SuccessOutcome, told: SeenKey[]): Promise<boolean> {
      const { data, error } = await rpc('property_watch_record_run', { p_watch: watchId, p_outcome: outcome, p_seen: told });
      if (error) throw new DataUnavailable('property_watch_record_run');
      if (typeof data !== 'boolean') throw new DataUnavailable('shape');
      return data;
    },

    /** A check could not finish: the database backs the watch off and keeps its daily slot. False when the watch no longer exists. */
    async recordFailure(watchId: string, outcome: FailureOutcome): Promise<boolean> {
      const { data, error } = await rpc('property_watch_record_failure', { p_watch: watchId, p_outcome: outcome });
      if (error) throw new DataUnavailable('property_watch_record_failure');
      if (typeof data !== 'boolean') throw new DataUnavailable('shape');
      return data;
    },

    /** The watch can no longer run: remove it (the database closes its need). */
    async endWatch(watchId: string, reason: EndReason): Promise<boolean> {
      const { data, error } = await rpc('property_watch_end', { p_watch: watchId, p_reason: reason });
      if (error) throw new DataUnavailable('property_watch_end');
      if (typeof data !== 'boolean') throw new DataUnavailable('shape');
      return data;
    },
  };
}
