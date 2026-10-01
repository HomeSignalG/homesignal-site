// THE CHANGE LEDGER READS an internal edge function makes — moved here from get-development-activity-report/data.ts so the
// column lists and the one-reader rule have ONE definition (CLAUDE.md "one canonical truth path"). The national report and
// Changes Since Report ask the ledger the same questions in the same words; neither carries its own copy of the SELECT.
// What is NOT verbatim, so nobody has to diff it to find out: `eventsWrittenSince` is new (Changes Since Report asks it), and
// `health` now names public.dev_change_source_fetch_health instead of dev_change_source_health (see the comment on `health`).
//
// WHAT IT READS, AND WHAT IT NEVER READS.
//   * events come ONLY from public.dev_change_event_reportable, the view that owns "may this event be shown as a change"
//     (docs/dev-change-reportable.sql). The ledger's raw event table is never named here, and a structural test fails
//     if any file in this repo's edge functions names it.
//   * `rights_class` is never selected: a rights decision is _shared/report-rights.json's, not a ledger column's.
//   * nothing here reads the private context. It has no handle to it.
// It makes no decision and holds no rule; it fetches through the `rest` it is handed, which fails closed.
import { inBatches, quoteIn } from './service-rest.ts';
import type { LedgerProject, ReportableEvent, SourceHealth, WrittenEvent } from './national-report.ts';

type Rest = <T>(path: string) => Promise<T[]>;

const EVENT_COLUMNS = 'identity_key,event_type,material,observed_at,prev_facts,new_facts,changed_fields,publisher_event_type,publisher_event_date';

export function makeChangeReads(rest: Rest) {
  return {
    async ledger(keys: string[]): Promise<LedgerProject[]> {
      const cols = 'identity_key,registry_id,comparable,change_ready,observation_count,first_observed_at,last_observed_at';
      return await inBatches<LedgerProject>(keys, (b) =>
        rest('dev_change_project?select=' + cols + '&identity_key=in.' + encodeURIComponent(quoteIn(b))));
    },

    /** Events the SOURCE RECORD says were observed on or after a day: what the report's recent-activity window asks. */
    async events(keys: string[], sinceDay: string): Promise<ReportableEvent[]> {
      return await inBatches<ReportableEvent>(keys, (b) =>
        rest('dev_change_event_reportable?select=' + EVENT_COLUMNS + '&observed_at=gte.' + encodeURIComponent(sinceDay)
          + '&identity_key=in.' + encodeURIComponent(quoteIn(b))));
    },

    /**
     * MATERIAL events the ledger recorded after an instant: what Changes Since Report asks. `observed_at` is the retrieval instant of
     * the source record, which can be hours older than the moment the ledger recorded the event, so "what the ledger learned since
     * the report" is `created_at` (the instant the recording transaction began), not `observed_at`. (docs/dev-change-ledger.sql
     * defines both columns; docs/development-activity-follow-changes-2026-10-01.md §3 records what sets each.)
     * Only material events are asked for: every consumer discards the rest (national-report.ts `materialEvents`), and the non-material
     * ones are the high-volume refreshes, so asking for them would push a long-held Follow toward the 1,000-row cap sooner.
     * The cap is still fatal by design (service-rest.ts fails closed, a cut-short page is never an answer), so a Follow held long
     * enough on a very busy set of projects can still answer 502; paging is the follow-up if that ever happens (§7 of the follow doc).
     */
    async eventsWrittenSince(keys: string[], sinceIso: string): Promise<WrittenEvent[]> {
      return await inBatches<WrittenEvent>(keys, (b) =>
        rest('dev_change_event_reportable?select=' + EVENT_COLUMNS + ',created_at&material=eq.true&created_at=gt.' + encodeURIComponent(sinceIso)
          + '&identity_key=in.' + encodeURIComponent(quoteIn(b))));
    },

    /**
     * The failure evidence for the families a report names. It reads public.dev_change_source_fetch_health, NOT dev_change_source_health:
     * the wide view aggregates the whole ledger (933,013 projects on 2026-10-01) before a registry_id filter can apply, which measured
     * 6.1-6.2 s here and 7.4-10.6 s by an independent reviewer, against the 8 s statement timeout PostgREST runs under. The narrow view
     * is the same definition of the 24-hour counts (the wide view is built FROM it) and touches only the failure record. A family
     * with no failure record has no row, and `sourcesNotFullyRead` treats an absent row and an all-zero row alike.
     */
    async health(families: string[]): Promise<SourceHealth[]> {
      return await inBatches<SourceHealth>(families, (b) =>
        rest('dev_change_source_fetch_health?select=registry_id,fetch_failures_24h,blocked_24h,truncated_24h&registry_id=in.'
          + encodeURIComponent(quoteIn(b))));
    },
  };
}
