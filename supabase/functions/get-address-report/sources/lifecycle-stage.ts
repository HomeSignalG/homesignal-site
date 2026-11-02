// THE PER-SOURCE STAGE SWITCH (docs/lifecycle-classification-audit-2026-11-01.md §6 step 3).
//
// OFF BY DEFAULT, AND OFF IS BYTE-IDENTICAL. A registry entry uses the national stage model only when it says
// `"stage_model": true`. No entry does today, and the release gate (§10) keeps it that way until the founder has
// reviewed the generated mapping audit, before/after counts, impact tests and rollback. With the switch off,
// socrata.ts::statusLookupFor returns exactly the old buildBucketLookup(status_to_bucket) result, which
// test/lifecycle-stage-switch.test.ts proves for every entry in the registry.
//
// ON: the entry declares, per verbatim status, a national STAGE (status_to_stage) or an ACTIVITY
// (status_to_activity), and the bucket comes from the ONE stage-to-column rule in lib/project-type.js
// (HS.recordLifecycle.stageColumn), through the generated engine copy. No column is decided here.
//
// FAIL CLOSED. An entry that switches on with an incomplete or invalid declaration throws from statusLookupFor;
// every connector already catches that at the same call and quarantines that ONE entry. Rules enforced:
//   - record_class is in the national vocabulary;
//   - every status the entry maps today (status_to_bucket) is declared exactly once in the stage model, so
//     switching on can never silently drop a value;
//   - every stage and activity is in the vocabulary;
//   - an inactive category is one of cancelled / withdrawn / denied / expired;
//   - founder D8: an inactive or paused mapping, and any term stage, carries a documentation `receipt`;
//   - founder rule (no stage from generic dataset membership): entry_stage requires entry_stage_receipt.
import "../../_shared/project-type.generated.js";

// deno-lint-ignore no-explicit-any
const RL = (): any => (globalThis as any).HS?.recordLifecycle;

export interface ActivityDeclaration {
  activity: "paused" | "inactive" | "undetermined";
  category?: "cancelled" | "withdrawn" | "denied" | "expired";
  /** The earlier stage the government's own term names (term rung), only with documented semantics. */
  term_stage?: string;
  /** Where the agency documents what this term means (D8). Required for paused, inactive and any term_stage. */
  receipt?: string;
}

export interface StageModelEntry {
  registry_id: string;
  stage_model?: boolean;
  record_class?: string;
  /** The stage the dataset's own definition guarantees for every record (class_entry rung). */
  entry_stage?: string;
  entry_stage_receipt?: string;
  /** Column holding the publisher's own date of inactivity or pause (expiration, withdrawal, decision...). */
  inactive_date_column?: string | string[] | null;
  status_to_bucket?: Record<string, string[] | undefined>;
  status_to_stage?: Record<string, string>;
  status_to_activity?: Record<string, ActivityDeclaration>;
}

export function stageModelEnabled(entry: { stage_model?: unknown } | null | undefined): boolean {
  return !!entry && entry.stage_model === true;
}

/** Throws with every problem listed. Called only for an entry that switched on. */
export function validateStageModel(entry: StageModelEntry): void {
  const L = RL();
  if (!L) throw new Error("national lifecycle vocabulary not loaded (_shared/project-type.generated.js)");
  const problems: string[] = [];
  if (!L.RECORD_CLASSES.includes(entry.record_class)) problems.push(`record_class "${entry.record_class}" is not in the vocabulary`);
  if (entry.entry_stage !== undefined) {
    if (!L.RECORD_STAGES.includes(entry.entry_stage)) problems.push(`entry_stage "${entry.entry_stage}" is not in the vocabulary`);
    if (!String(entry.entry_stage_receipt || "").trim()) problems.push("entry_stage needs entry_stage_receipt (no stage from generic dataset membership)");
  }
  const st = entry.status_to_stage || {};
  const ac = entry.status_to_activity || {};
  const declared = new Map<string, number>();
  for (const k of [...Object.keys(st), ...Object.keys(ac)]) {
    const n = k.trim().toLowerCase();
    declared.set(n, (declared.get(n) || 0) + 1);
  }
  for (const [k, n] of declared) if (n > 1) problems.push(`status "${k}" is declared more than once`);
  for (const [k, stage] of Object.entries(st)) {
    if (!L.RECORD_STAGES.includes(stage)) problems.push(`status "${k}": stage "${stage}" is not in the vocabulary`);
  }
  for (const [k, a] of Object.entries(ac)) {
    if (!a || !["paused", "inactive", "undetermined"].includes(a.activity)) { problems.push(`status "${k}": activity "${a && a.activity}" is invalid`); continue; }
    if (a.activity === "inactive" && !L.INACTIVE_CATEGORIES.includes(a.category)) problems.push(`status "${k}": inactive needs a category of ${L.INACTIVE_CATEGORIES.join("/")}`);
    if (a.activity !== "inactive" && a.category) problems.push(`status "${k}": only an inactive status carries a category`);
    if ((a.activity !== "undetermined" || a.term_stage) && !String(a.receipt || "").trim()) problems.push(`status "${k}": needs a documentation receipt (D8)`);
    if (a.term_stage !== undefined && !L.RECORD_STAGES.includes(a.term_stage)) problems.push(`status "${k}": term_stage "${a.term_stage}" is not in the vocabulary`);
  }
  for (const list of Object.values(entry.status_to_bucket || {})) {
    for (const v of list || []) {
      if (!declared.has(String(v).trim().toLowerCase())) problems.push(`status "${v}" is mapped today but not declared in the stage model (it would be dropped)`);
    }
  }
  if (problems.length) throw new Error(`stage model for ${entry.registry_id}: ` + problems.join("; "));
}

/** status → bucket under the stage model. `unknown` is emitted (it becomes "On file" in the materialiser);
 *  `exclude` only for invalid_record. Validates first. */
export function stageBucketPairs(entry: StageModelEntry): [string, string][] {
  validateStageModel(entry);
  const L = RL();
  const cls = entry.record_class;
  const pairs: [string, string][] = [];
  for (const [status, stage] of Object.entries(entry.status_to_stage || {})) {
    const col = L.stageColumn(cls, stage, null);
    pairs.push([status, col === null ? "exclude" : col]);
  }
  for (const [status, a] of Object.entries(entry.status_to_activity || {})) {
    // The connector cannot see JODY's observation history (that rung is applied in the materialiser), so here
    // the column comes from the term rung, then the documented entry stage, else Lifecycle unknown.
    const h = L.historicalStage({ term: a.term_stage, classEntry: entry.entry_stage });
    pairs.push([status, L.stageColumn(cls, h.stage, null) || "unknown"]);
  }
  return pairs;
}

export interface StageFields {
  lifecycle_stage: string;
  lifecycle_stage_basis: string;
  activity: string;
  activity_term: string | null;
  inactive_category: string | null;
  activity_effective_date: string | null;
}

function findKey<T>(map: Record<string, T> | undefined, raw: string): T | undefined {
  if (!map) return undefined;
  const k = raw.trim();
  if (Object.prototype.hasOwnProperty.call(map, k)) return map[k];
  const lk = k.toLowerCase();
  for (const [key, v] of Object.entries(map)) if (key.trim().toLowerCase() === lk) return v;
  return undefined;
}

/** The record-level fields for one row of a switched-on entry, or null when the status is not declared (the
 *  lookup already dropped such a row). `readCol` reads one of the row's columns; `today` and `filedOn` are ISO days. */
export function stageFieldsFor(
  entry: StageModelEntry, statusRaw: string, readCol: (col: string | string[]) => unknown, today: string, filedOn: string | null,
): StageFields | null {
  const L = RL();
  const stage = findKey(entry.status_to_stage, statusRaw);
  if (stage !== undefined) {
    return { lifecycle_stage: stage, lifecycle_stage_basis: "status_map", activity: "active",
      activity_term: null, inactive_category: null, activity_effective_date: null };
  }
  const a = findKey(entry.status_to_activity, statusRaw);
  if (!a) return null;
  const h = L.historicalStage({ term: a.term_stage, classEntry: entry.entry_stage });
  const rawDate = entry.inactive_date_column ? readCol(entry.inactive_date_column) : null;
  const effective = a.activity === "undetermined" ? null
    : L.verifiedEffectiveDate(rawDate == null ? null : String(rawDate), { today, filedOn });
  return { lifecycle_stage: h.stage, lifecycle_stage_basis: h.basis, activity: a.activity,
    activity_term: statusRaw.trim(), inactive_category: a.activity === "inactive" ? (a.category || null) : null,
    activity_effective_date: effective };
}
