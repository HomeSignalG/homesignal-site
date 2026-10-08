// EPA ECHO + ICIS-NPDES (CWA) enrichment — report what happened, never infer it.
//
// WHY THIS IS ITS OWN MODULE (2026-09-27). Until now `echoEnrich` / `cwaPermitEnrich`
// lived inline in index.ts and FAILED SILENTLY: a non-200, a timeout, or a missing
// QueryID `return`ed with no stamp. The ZIP then stored FRS facilities without `env.epa`,
// which is indistinguishable from "ECHO answered and matched nothing". Measured on the
// 12,722-ZIP cache: 57.9% of facility sites carry ECHO data; 916 ZIPs match zero; a
// 40-facility ZIP matching zero at a 58% base rate is a failed call (01610: 40 FRS,
// 0 ECHO, 2 CWA). The refresh write guard only checks FRS `epa.ok`, so a failed ECHO
// call OVERWRITES last-known-good compliance data with absence.
//
// THE DISTINCTION THIS MODULE EXISTS TO PRESERVE — same four-way as sources/epa-frs.ts:
//   ok:true  + matched>0   → EPA answered, some FRS ids joined.
//   ok:true  + matched=0   → EPA answered, genuinely no ECHO/CWA rows for these ids.
//   ok:false               → the call failed as a whole. NOT "no data". Caller must
//                            keep last-known-good `env.epa` and record the attempt.
//   attempted:false        → nothing to query (no registry ids). Not a failure.
//
// Fail-open for the PAGE (a hiccup never 500s the report). Fail-closed for the STORE
// (`ok:false` is what stops a refresh from wiping stored ECHO). QueryRows is recorded
// when the payload carries it so a `responseset=500` truncation is visible.

export type EchoCallOutcome = {
  /** true = we issued at least one HTTP call. false = no registry ids to query. */
  attempted: boolean;
  /** true = EPA answered and the payload parsed. Only then is matched=0 authoritative. */
  ok: boolean;
  /** null on success; else why the sequence gave up — observability, not a page switch. */
  reason: string | null;
  /** FRS facilities that received a row from this call. */
  matched: number;
  /** Facilities[] rows we actually received (after responseset). */
  query_rows: number;
  /** Results.QueryRows when the payload names it; null when absent (unverified). */
  query_rows_reported: number | null;
  duration_ms: number;
  /** How many stored env.epa blocks were copied back after a failed call. */
  restored?: number;
};

export const ECHO_BASE = "https://echodata.epa.gov/echo";
export const ECHO_FETCH_TIMEOUT_MS = 25000;
export const ECHO_MAX_RADIUS_MI = 5;
export const ECHO_RESPONSESET = "500";

export const ECHO_STATUTES: [string, string][] = [
  ["CWA", "CWAComplianceStatus"],
  ["CAA", "CAAComplianceStatus"],
  ["RCRA", "RCRAComplianceStatus"],
  ["SDWA", "SDWAComplianceStatus"],
];

export const CWA_QCOLUMNS = "1,2,9,11,51,54";
export const PERMIT_STATUS_PRECEDENCE = [
  "Effective",
  "Admin Continued",
  "Administratively Continued",
  "Expired",
  "Pending",
  "Not Needed",
  "Retired",
  "Terminated",
];
export const PERMIT_TRACKING_ON = new Set([
  "Effective",
  "Admin Continued",
  "Administratively Continued",
  "Expired",
]);

const ECHO_RESTORE_FIELDS = [
  "in_violation",
  "snc",
  "quarters_nc",
  "inspections",
  "action_year",
  "penalty_count",
  "current_as_of",
] as const;
const CWA_RESTORE_FIELDS = ["permits", "permit_status", "compliance_tracking_on"] as const;

type FetchLike = (input: string, init?: unknown) => Promise<Response>;

export function echoParse(text: string): Record<string, unknown> {
  return JSON.parse(text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")) as Record<string, unknown>;
}

export function echoYear(mdY?: string): string | null {
  const all = String(mdY ?? "").match(/\d{4}/g);
  return all && all.length ? all[all.length - 1] : null;
}

/** Use the radius FRS actually answered at, not the radius the caller asked for. */
export function enrichRadiusMi(epa: Record<string, unknown> | null | undefined, requested: number): number {
  const used = Number(epa?.radius_used);
  return Number.isFinite(used) && used > 0 ? used : requested;
}

export function interpretEcho(row: Record<string, string>): Record<string, unknown> {
  const inViolation: string[] = [];
  for (const [code, field] of ECHO_STATUTES) {
    const v = String(row[field] ?? "");
    if (/violation|significant|non.?compliance/i.test(v) && !/no violation|no data/i.test(v)) {
      inViolation.push(code);
    }
  }
  const epa: Record<string, unknown> = { in_violation: inViolation };
  if (row.FacSNCFlg === "Y") epa.snc = true;
  const qtrs = parseInt(row.FacQtrsWithNC ?? "", 10);
  if (Number.isFinite(qtrs) && qtrs > 0) epa.quarters_nc = qtrs;
  const insp = parseInt(row.FacInspectionCount ?? "", 10);
  if (Number.isFinite(insp) && insp > 0) epa.inspections = insp;
  const yr = echoYear(row.FacDateLastFormalAction);
  if (yr) epa.action_year = yr;
  const pen = parseInt(row.FacPenaltyCount ?? "", 10);
  if (Number.isFinite(pen) && pen > 0) epa.penalty_count = pen;
  epa.current_as_of = new Date().toISOString().slice(0, 10);
  return epa;
}

function callReason(e: unknown): string {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (e instanceof SyntaxError) return "parse_error";
  return "fetch_error";
}

function reportedQueryRows(results: Record<string, unknown> | undefined): number | null {
  if (!results) return null;
  const n = Number(results.QueryRows ?? results.QueryRowCount ?? results.Rows);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function emptyOutcome(partial: Partial<EchoCallOutcome>): EchoCallOutcome {
  return {
    attempted: false,
    ok: true,
    reason: "no_registry_ids",
    matched: 0,
    query_rows: 0,
    query_rows_reported: null,
    duration_ms: 0,
    ...partial,
  };
}

async function echoGetFacilitiesThenQid(
  path: "echo_rest_services" | "cwa_rest_services",
  lat: number,
  lng: number,
  radiusMi: number,
  fetchImpl: FetchLike,
  timeoutMs: number,
  extraQid?: Record<string, string>,
): Promise<{ ok: false; reason: string; query_rows_reported: number | null } | {
  ok: true;
  rows: Record<string, string>[];
  query_rows_reported: number | null;
}> {
  const q1 = new URLSearchParams({
    output: "JSON",
    p_lat: lat.toFixed(6),
    p_long: lng.toFixed(6),
    p_radius: String(Math.min(radiusMi, ECHO_MAX_RADIUS_MI)),
  });
  const r1 = await fetchImpl(`${ECHO_BASE}/${path}.get_facilities?${q1}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r1.ok) return { ok: false, reason: `http_${r1.status}`, query_rows_reported: null };
  const parsed1 = echoParse(await r1.text());
  const results1 = parsed1?.Results as Record<string, unknown> | undefined;
  const qid = results1?.QueryID;
  if (qid == null || qid === "") {
    return { ok: false, reason: "no_qid", query_rows_reported: reportedQueryRows(results1) };
  }
  const q2 = new URLSearchParams({
    output: "JSON",
    qid: String(qid),
    responseset: ECHO_RESPONSESET,
    ...(extraQid ?? {}),
  });
  const r2 = await fetchImpl(`${ECHO_BASE}/${path}.get_qid?${q2}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r2.ok) return { ok: false, reason: `qid_http_${r2.status}`, query_rows_reported: null };
  const parsed2 = echoParse(await r2.text());
  const results2 = parsed2?.Results as Record<string, unknown> | undefined;
  const rows = (results2?.Facilities ?? []) as Record<string, string>[];
  return {
    ok: true,
    rows: Array.isArray(rows) ? rows : [],
    query_rows_reported: reportedQueryRows(results2),
  };
}

export async function echoEnrich(
  fac: Record<string, unknown>[],
  lat: number,
  lng: number,
  radiusMi: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs: number = ECHO_FETCH_TIMEOUT_MS,
): Promise<EchoCallOutcome> {
  if (!fac.some((f) => String(f.registry_id ?? "").trim())) {
    return emptyOutcome({ attempted: false, ok: true, reason: "no_registry_ids" });
  }
  const started = Date.now();
  const done = (partial: Partial<EchoCallOutcome>): EchoCallOutcome => ({
    attempted: true,
    ok: false,
    reason: null,
    matched: 0,
    query_rows: 0,
    query_rows_reported: null,
    duration_ms: Date.now() - started,
    ...partial,
  });
  try {
    const got = await echoGetFacilitiesThenQid("echo_rest_services", lat, lng, radiusMi, fetchImpl, timeoutMs);
    if (!got.ok) {
      return done({ ok: false, reason: got.reason, query_rows_reported: got.query_rows_reported });
    }
    const byId = new Map<string, Record<string, string>>();
    for (const row of got.rows) {
      const id = String(row.RegistryID ?? "").trim();
      if (id) byId.set(id, row);
    }
    let matched = 0;
    for (const f of fac) {
      const row = byId.get(String(f.registry_id ?? "").trim());
      if (!row) continue;
      const epa = interpretEcho(row);
      const env = (f.env ??= {}) as Record<string, unknown>;
      env.link_type = "geo_matched";
      env.epa = epa;
      f.viol = (epa.in_violation as string[]).length;
      if (row.FacStreet) f._fstreet = String(row.FacStreet);
      if (row.FacZip) f._fzip = String(row.FacZip).slice(0, 5);
      matched++;
    }
    return done({
      ok: true,
      reason: null,
      matched,
      query_rows: got.rows.length,
      query_rows_reported: got.query_rows_reported,
    });
  } catch (e) {
    return done({ ok: false, reason: callReason(e) });
  }
}

export async function cwaPermitEnrich(
  fac: Record<string, unknown>[],
  lat: number,
  lng: number,
  radiusMi: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs: number = ECHO_FETCH_TIMEOUT_MS,
): Promise<EchoCallOutcome> {
  if (!fac.some((f) => String(f.registry_id ?? "").trim())) {
    return emptyOutcome({ attempted: false, ok: true, reason: "no_registry_ids" });
  }
  const started = Date.now();
  const done = (partial: Partial<EchoCallOutcome>): EchoCallOutcome => ({
    attempted: true,
    ok: false,
    reason: null,
    matched: 0,
    query_rows: 0,
    query_rows_reported: null,
    duration_ms: Date.now() - started,
    ...partial,
  });
  try {
    const got = await echoGetFacilitiesThenQid(
      "cwa_rest_services",
      lat,
      lng,
      radiusMi,
      fetchImpl,
      timeoutMs,
      { qcolumns: CWA_QCOLUMNS },
    );
    if (!got.ok) {
      return done({ ok: false, reason: got.reason, query_rows_reported: got.query_rows_reported });
    }
    const byId = new Map<string, Record<string, string>[]>();
    for (const row of got.rows) {
      const id = String(row.RegistryID ?? "").trim();
      if (id) (byId.get(id) ?? byId.set(id, []).get(id)!).push(row);
    }
    let matched = 0;
    for (const f of fac) {
      const rws = byId.get(String(f.registry_id ?? "").trim());
      if (!rws || !rws.length) continue;
      const permits = rws.map((r) => {
        const p: Record<string, unknown> = {};
        if (r.SourceID) p.npdes_id = String(r.SourceID);
        if (r.Statute) p.statute = String(r.Statute);
        if (r.CWPPermitStatusDesc) p.status = String(r.CWPPermitStatusDesc);
        if (r.CWPPermitTypeDesc) p.type = String(r.CWPPermitTypeDesc);
        return p;
      }).filter((p) => Object.keys(p).length);
      if (!permits.length) continue;
      const statuses = permits.map((p) => String(p.status ?? "")).filter(Boolean);
      const env = (f.env ??= {}) as Record<string, unknown>;
      env.link_type = "geo_matched";
      const epa = (env.epa ??= {}) as Record<string, unknown>;
      epa.permits = permits;
      const head = PERMIT_STATUS_PRECEDENCE.find((s) => statuses.includes(s));
      if (head) {
        epa.permit_status = head;
        epa.compliance_tracking_on = PERMIT_TRACKING_ON.has(head);
      }
      matched++;
    }
    return done({
      ok: true,
      reason: null,
      matched,
      query_rows: got.rows.length,
      query_rows_reported: got.query_rows_reported,
    });
  } catch (e) {
    return done({ ok: false, reason: callReason(e) });
  }
}

/** Pull stored env.epa blocks, keyed on trimmed FRS registry id. */
export function storedEpaByRegistryId(sites: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(sites)) return out;
  for (const s of sites) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const id = String(rec.registry_id ?? "").trim();
    const env = rec.env as Record<string, unknown> | undefined;
    const epa = env?.epa;
    if (id && epa && typeof epa === "object") out.set(id, epa as Record<string, unknown>);
  }
  return out;
}

/**
 * Copy last-known-good ECHO/CWA fields onto this run's facilities when the matching
 * live call failed. A successful empty answer (ok:true, matched:0) is left alone —
 * that is real absence, not a wipe. Only fills fields this run did not stamp.
 */
export function preserveStoredEnv(
  fac: Record<string, unknown>[],
  storedById: Map<string, Record<string, unknown>>,
  echo: EchoCallOutcome,
  cwa: EchoCallOutcome,
): { restored_echo: number; restored_cwa: number } {
  let restored_echo = 0;
  let restored_cwa = 0;
  if ((echo.ok && cwa.ok) || storedById.size === 0) {
    return { restored_echo, restored_cwa };
  }
  for (const f of fac) {
    const stored = storedById.get(String(f.registry_id ?? "").trim());
    if (!stored) continue;
    if (!echo.ok) {
      const need = ECHO_RESTORE_FIELDS.some((k) => stored[k] != null && (f.env as { epa?: Record<string, unknown> } | undefined)?.epa?.[k] == null);
      if (need) {
        const env = (f.env ??= {}) as Record<string, unknown>;
        const epa = (env.epa ??= {}) as Record<string, unknown>;
        env.link_type = env.link_type || "geo_matched";
        for (const k of ECHO_RESTORE_FIELDS) {
          if (epa[k] == null && stored[k] != null) epa[k] = stored[k];
        }
        if (f.viol == null && Array.isArray(epa.in_violation)) {
          f.viol = (epa.in_violation as unknown[]).length;
        }
        restored_echo++;
      }
    }
    if (!cwa.ok) {
      const need = CWA_RESTORE_FIELDS.some((k) => stored[k] != null && (f.env as { epa?: Record<string, unknown> } | undefined)?.epa?.[k] == null);
      if (need) {
        const env = (f.env ??= {}) as Record<string, unknown>;
        const epa = (env.epa ??= {}) as Record<string, unknown>;
        env.link_type = env.link_type || "geo_matched";
        for (const k of CWA_RESTORE_FIELDS) {
          if (epa[k] == null && stored[k] != null) epa[k] = stored[k];
        }
        restored_cwa++;
      }
    }
  }
  return { restored_echo, restored_cwa };
}
