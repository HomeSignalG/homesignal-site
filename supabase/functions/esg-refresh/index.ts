// esg-refresh — the reusable ESG / Sustainability COMPANY service (Supabase edge function).
//
// SCOPE GATE (founder, 2026-08-09): this is a PILOT. It runs for Del Valle, TX (78617) and
// nothing else. PILOT_ZIPS below is the whole gate — scaling nationwide is a deliberate,
// reviewable edit to that one constant, never a side effect of calling this function with a
// different ZIP. A non-pilot ZIP is REFUSED (409), not silently skipped, so a mistaken call
// is loud rather than invisible.
//
// WHAT IT DOES, in order:
//   1. read the mapped records for the ZIP (app_projects: facilities + developments)
//   2. identify the company behind each, conservatively (normalize.ts, alias registry)
//   3. resolve that company against WikiRate (primary), then WBA-designed metrics (secondary)
//   4. cache: company_esg_matches + company_esg_data + company_esg_raw (verbatim payload)
//   5. stamp app_projects.company_esg ONLY for displayable tiers
//
// WHAT IT NEVER DOES: compute an overall score, display a proprietary rating, attach ESG on
// an ambiguous match, or imply that company data measures the facility.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { companyFromSiteName, isDisplayable, type AliasEntry } from "./normalize.ts";
import {
  classifyAnswers, fetchAnswers, searchCompany,
  WIKIRATE_ATTRIBUTION, WBA_ATTRIBUTION, WIKIRATE_BASE,
} from "./wikirate.ts";
import aliasRegistry from "./company-aliases.json" with { type: "json" };

const REGISTRY: AliasEntry[] = (aliasRegistry as { companies: AliasEntry[] }).companies ?? [];

/** THE PILOT GATE. One ZIP. Changing this is the scaling decision. */
const PILOT_ZIPS = new Set(["78617"]);   // Del Valle, Travis County, TX

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization" };
}
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json", ...cors() } });
}

const fetchJson = async (url: string) => {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "homesignal-esg/1.0" } });
  return { ok: r.ok, status: r.status, json: () => r.json() };
};

/**
 * The company a mapped record belongs to, and IN WHAT ROLE.
 * Roles are kept distinct because the founder's display contract differs by role:
 * a PROPOSED development shows its developer's track record; an OPERATING facility shows
 * the operator/owner's company profile. We only ever claim the role the DATA states.
 */
type Role = "developer" | "operator" | "owner" | "parent" | "unknown";
interface RecordIdentity {
  id: string; name: string; record_kind: string; status: string | null;
  role: Role; role_source: string;
  company_key: string | null; canonical_name: string | null;
  outcome: string; reason: string; competing?: string[];
}

function identify(row: { id: string; name: string; record_kind: string; status: string | null; developer: string | null }): RecordIdentity {
  const base = { id: row.id, name: row.name, record_kind: row.record_kind, status: row.status };
  // A development's `developer` column is a STATED company (TDLR TABS owner field) — that is
  // a real role claim from the record. A facility's `developer` column is NOT: it holds the
  // provenance label "EPA FRS · registry <id>", so it must never be read as a company.
  const stated = row.record_kind === "development" && row.developer && !/^EPA FRS/i.test(row.developer)
    ? row.developer.trim() : null;

  if (stated) {
    const hit = companyFromSiteName(stated, REGISTRY);
    return {
      ...base, role: "developer", role_source: "app_projects.developer (TDLR TABS owner field)",
      company_key: hit.entry?.company_key ?? null, canonical_name: hit.entry?.canonical_name ?? stated,
      outcome: hit.outcome, reason: hit.reason, competing: hit.competing,
    };
  }
  // Otherwise the only company signal is the record's own NAME, which for EPA FRS rows is a
  // SITE name. companyFromSiteName holds on anything ambiguous.
  const hit = companyFromSiteName(row.name, REGISTRY);
  return {
    ...base,
    role: hit.entry ? "operator" : "unknown",
    role_source: hit.entry ? "inferred from the facility name via the reviewed alias registry" : "no company stated on the record",
    company_key: hit.entry?.company_key ?? null, canonical_name: hit.entry?.canonical_name ?? null,
    outcome: hit.outcome, reason: hit.reason, competing: hit.competing,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  let body: { zip?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body = defaults */ }

  const zip = String(body.zip || "").trim();
  const dryRun = body.dry_run !== false;   // WRITES ARE OPT-IN: default is a dry run.
  if (!zip) return json({ error: "zip is required" }, 400);
  if (!PILOT_ZIPS.has(zip)) {
    return json({
      error: "outside the ESG pilot scope",
      zip, pilot_zips: [...PILOT_ZIPS],
      detail: "ESG is a Del Valle (78617) pilot. Nationwide ingestion is gated pending founder review of the matching and presentation.",
    }, 409);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: rows, error } = await supabase
    .from("app_projects")
    .select("id,name,record_kind,status,developer")
    .eq("zip", zip);
  if (error) return json({ error: error.message }, 500);

  const identities = (rows || []).map(identify);
  // One resolution per DISTINCT company, not per record.
  const keys = [...new Set(identities.filter((i) => i.company_key).map((i) => i.company_key!))];

  const resolutions: Record<string, unknown> = {};
  const displayable: Record<string, unknown> = {};

  for (const key of keys) {
    const entry = REGISTRY.find((e) => e.company_key === key)!;
    const queryName = entry.wikirate_name || entry.canonical_name;
    const search = await searchCompany(queryName, fetchJson);

    if (!dryRun) {
      for (const r of search.raw) {
        await supabase.from("company_esg_raw").insert({
          company_id: key, source: "wikirate", endpoint: r.endpoint, http_status: r.status, payload: r.payload,
        });
      }
    }

    if (search.confidence === "ambiguous" || !search.candidate) {
      resolutions[key] = { confidence: "ambiguous", reason: search.reason, tried: search.tried, tied: search.tied };
      if (!dryRun) {
        await supabase.from("company_esg_matches").upsert({
          company_id: key, canonical_company_name: entry.canonical_name, source: "wikirate",
          external_company_id: null, match_confidence: "ambiguous",
          matched_via: search.tried.join(" → "), match_notes: search.reason, last_checked: new Date().toISOString(),
        });
      }
      continue;
    }

    const ans = await fetchAnswers(search.candidate.id, fetchJson);
    const esg = classifyAnswers(ans.answers);
    const hasAny = esg.environmental.length + esg.social.length + esg.governance.length + esg.unclassified.length > 0;
    const usesWba = [...esg.environmental, ...esg.social, ...esg.governance, ...esg.unclassified].some((m) => m.source === "wba");
    const cardUrl = `${WIKIRATE_BASE}/${String(search.candidate.name).replace(/\s+/g, "_")}`;

    resolutions[key] = {
      confidence: search.confidence, matched: search.candidate, tried: search.tried,
      answers_fetched: ans.answers.length, displayable_metrics: hasAny, esg,
    };

    if (!dryRun) {
      await supabase.from("company_esg_raw").insert({
        company_id: key, source: "wikirate", endpoint: ans.endpoint, http_status: ans.status, payload: ans.payload,
      });
      await supabase.from("company_esg_matches").upsert({
        company_id: key, canonical_company_name: entry.canonical_name, source: "wikirate",
        external_company_id: String(search.candidate.id), external_company_name: search.candidate.name,
        match_confidence: search.confidence, matched_via: search.tried.join(" → "),
        parent_company_id: entry.parent_key ?? null,
        parent_company_name: entry.parent_key ? (REGISTRY.find((e) => e.company_key === entry.parent_key)?.canonical_name ?? null) : null,
        last_checked: new Date().toISOString(),
      });
      if (hasAny) {
        await supabase.from("company_esg_data").upsert({
          company_id: key, source: usesWba ? "wba" : "wikirate",
          overall_score: null,          // the sources publish no scaled composite — never computed
          overall_score_scale: null,
          environmental_value: esg.environmental, social_value: esg.social,
          governance_value: esg.governance, unclassified_value: esg.unclassified,
          reporting_year: esg.reporting_year, raw_source_url: cardUrl,
          attribution: usesWba ? WBA_ATTRIBUTION : WIKIRATE_ATTRIBUTION,
          retrieved_at: new Date().toISOString(),
        });
      }
    }

    if (isDisplayable(search.confidence) && hasAny) {
      displayable[key] = {
        company_name: entry.canonical_name, source_company_name: search.candidate.name,
        match_confidence: search.confidence, source_url: cardUrl,
        reporting_year: esg.reporting_year,
        attribution: usesWba ? WBA_ATTRIBUTION : WIKIRATE_ATTRIBUTION,
        environmental: esg.environmental, social: esg.social,
        governance: esg.governance, unclassified: esg.unclassified,
      };
    }
  }

  // Stamp the map rows. Only displayable tiers, only this ZIP, and the blob always carries
  // the role + the not-this-facility disclosure so the render layer cannot lose them.
  let stamped = 0;
  if (!dryRun) {
    for (const ident of identities) {
      const d = ident.company_key ? displayable[ident.company_key] : null;
      if (!d) continue;
      const blob = {
        ...(d as Record<string, unknown>),
        role: ident.role, role_source: ident.role_source,
        record_status: ident.status,
        scope_note: "Company-level sustainability data; not a rating of this individual facility.",
      };
      const { error: upErr } = await supabase.from("app_projects").update({ company_esg: blob }).eq("id", ident.id);
      if (!upErr) stamped++;
    }
  }

  return json({
    zip, dry_run: dryRun,
    records_examined: identities.length,
    companies_identified: keys.length,
    rows_stamped: stamped,
    identities, resolutions,
    displayable_companies: Object.keys(displayable),
  }, 200);
});
