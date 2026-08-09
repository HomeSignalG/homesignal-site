// normalize.ts — company-name normalization and site-name → company identification for the
// ESG / Sustainability company layer. PURE FUNCTIONS ONLY (no I/O, no fetch) so the offline
// unit suite can drive the SHIPPED code rather than a copy of it.
//
// THE GOVERNING RULE (docs/esg-company-layer.md §3, founder's conservative data philosophy):
//   No ESG result is better than the wrong company's ESG result.
//
// That rule is why this module is deliberately NOT a fuzzy matcher. Two separate stages:
//
//   Stage A  companyFromSiteName()  — a MAPPED FACILITY NAME → a curated company entry.
//            EPA FRS facility names are SITE names, not company names. Measured against the
//            live app_projects table 2026-08-09: 98,059 distinct facility names, including
//            "ALPHABET GARDEN CHILDCARE-TREATMENT PLANT 1" (a childcare centre, not Alphabet
//            Inc), "PG&E TESLA SUBSTATION" (a PG&E substation in Tesla, California — not
//            Tesla Motors) and "WALMART C/O TESLA ENERGY" (two companies in one string).
//            Free-text extraction gets all three wrong, so Stage A matches ONLY against the
//            reviewed registry in company-aliases.json and HOLDS whenever two entries claim
//            the same facility.
//
//   Stage B  nameVariants()/classifyCandidate() — a curated company name → a WikiRate card.
//            WikiRate's ?filter[name]= is a SUBSTRING search: "Amazon" returns "Banco da
//            Amazonia" and six other Amazonia companies (live-verified 2026-08-09). A
//            substring hit is therefore never sufficient — a candidate is accepted only when
//            its normalized core EQUALS the query's, and only when it is the unique such hit.
//
// Confidence tiers are the founder's, verbatim: exact / high / parent display; ambiguous HOLDs.

/** Confidence tiers. Only DISPLAY_TIERS ever reach a resident. */
export type MatchConfidence = "exact" | "high" | "parent" | "ambiguous";
export const DISPLAY_TIERS: readonly MatchConfidence[] = ["exact", "high", "parent"];
/** The one gate the render layer and the writer both call. Unknown/absent tiers fail closed. */
export function isDisplayable(c: string | null | undefined): boolean {
  return DISPLAY_TIERS.includes(c as MatchConfidence);
}

// Legal-form and generic corporate tokens stripped to form a comparison "core". Order matters
// only for readability; stripping is token-wise, not positional.
const LEGAL_SUFFIXES = new Set([
  "llc", "lc", "llp", "lp", "plc", "inc", "incorporated", "corp", "corporation", "co",
  "company", "companies", "ltd", "limited", "holding", "holdings", "group", "groups",
  "technologies", "technology", "international", "worldwide", "enterprises", "enterprise",
  "industries", "industry", "trust", "partners", "partnership", "gmbh", "ag", "sa", "sas",
  "spa", "srl", "nv", "bv", "pty", "ab", "oy", "asa", "kk", "pte", "sarl", "kg", "se",
]);

/** Unicode-fold, lowercase, drop punctuation, collapse whitespace. The comparison alphabet. */
export function normalizeCompanyName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")  // strip combining accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The comparison CORE: the normalized name with legal-form tokens removed.
 * "Amazon.com, Inc." → "amazon com"; "Equinix Inc." → "equinix"; "Digital Realty Trust Inc"
 * → "digital realty". Never returns empty for a non-empty input — a name made entirely of
 * legal tokens ("The Company Ltd") keeps its normalized form rather than collapsing to "",
 * because an empty core would match every other empty core.
 */
export function companyCore(raw: string | null | undefined): string {
  const norm = normalizeCompanyName(raw);
  if (!norm) return "";
  const kept = norm.split(" ").filter((t) => t && !LEGAL_SUFFIXES.has(t) && t !== "the");
  return kept.length ? kept.join(" ") : norm;
}

/**
 * Ordered, de-duplicated query variations for a curated company name — the founder's
 * "try reasonable normalized variations such as removing LLC, Inc., Corporation, Holdings,
 * Technologies". Most specific first, so an exact hit is always preferred.
 * Variants are QUERIES ONLY; a variant hit still has to pass classifyCandidate().
 */
export function nameVariants(raw: string | null | undefined): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const t = v.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  const original = String(raw ?? "").trim();
  if (!original) return out;
  push(original);
  push(original.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim()); // "Amazon.com, Inc." → "Amazon com Inc"
  const core = companyCore(original);
  if (core) push(core);
  // Progressive right-trim of the core: "space exploration technologies corporation" is already
  // core-stripped, but a long descriptive name still benefits from its leading tokens.
  const tokens = core.split(" ").filter(Boolean);
  for (let n = tokens.length - 1; n >= 1; n--) push(tokens.slice(0, n).join(" "));
  return out;
}

/**
 * Classify ONE WikiRate candidate against the query name.
 *   "exact" — the normalized full names are identical.
 *   "high"  — the normalized CORES are identical (legal-form differences only).
 *   null    — not a match at all. A substring relationship is deliberately NOT a match:
 *             that is what let "Amazon" pull in "Banco da Amazonia".
 */
export function classifyCandidate(query: string, candidate: string): MatchConfidence | null {
  const qn = normalizeCompanyName(query), cn = normalizeCompanyName(candidate);
  if (!qn || !cn) return null;
  if (qn === cn) return "exact";
  const qc = companyCore(query), cc = companyCore(candidate);
  if (qc && cc && qc === cc) return "high";
  return null;
}

export interface CandidateLike { id: number | string; name: string }
export interface ResolutionResult {
  confidence: MatchConfidence;
  candidate: CandidateLike | null;
  /** Every candidate that tied at the winning tier — populated on an ambiguous HOLD. */
  tied: CandidateLike[];
  reason: string;
}

/**
 * Pick the single correct candidate from a WikiRate search result set, or HOLD.
 * Ties at the best tier are AMBIGUOUS — never "pick the first" and never "pick the shortest".
 * A tie means the data cannot tell us which company this is, which is exactly the case the
 * founder's rule says to drop.
 */
export function resolveCandidates(query: string, candidates: CandidateLike[]): ResolutionResult {
  const scored = (candidates || [])
    .map((c) => ({ c, tier: classifyCandidate(query, c?.name ?? "") }))
    .filter((s): s is { c: CandidateLike; tier: MatchConfidence } => s.tier !== null);
  if (!scored.length) {
    return { confidence: "ambiguous", candidate: null, tied: [], reason: "no candidate matched on normalized name or core" };
  }
  for (const tier of ["exact", "high"] as const) {
    const atTier = scored.filter((s) => s.tier === tier);
    if (!atTier.length) continue;
    // Distinct WikiRate cards only: the same card returned twice is not ambiguity.
    const distinct = atTier.filter((s, i) => atTier.findIndex((o) => String(o.c.id) === String(s.c.id)) === i);
    if (distinct.length === 1) {
      return { confidence: tier, candidate: distinct[0].c, tied: [], reason: `unique ${tier} match` };
    }
    return {
      confidence: "ambiguous", candidate: null, tied: distinct.map((s) => s.c),
      reason: `${distinct.length} candidates tied at ${tier} — cannot tell them apart`,
    };
  }
  return { confidence: "ambiguous", candidate: null, tied: [], reason: "no candidate matched" };
}

// ── Stage A: mapped facility name → curated company entry ────────────────────────────────

export interface AliasEntry {
  company_key: string;
  canonical_name: string;
  /** The name queried against WikiRate (may differ from the display name). */
  wikirate_name?: string;
  /** Parent company key — used when the site's operator is a subsidiary. */
  parent_key?: string;
  /** Whole-token phrases that identify this company in a facility name. */
  site_patterns: string[];
  /** Phrases that DISQUALIFY this entry even when a site_pattern hit (false-friend guards). */
  deny_patterns?: string[];
  _receipts?: string;
}

export interface IdentifyResult {
  entry: AliasEntry | null;
  /** "matched" | "no_match" | "ambiguous" | "denied" */
  outcome: "matched" | "no_match" | "ambiguous" | "denied";
  reason: string;
  competing?: string[];
}

/** Whole-token phrase test: "TESLA" must not fire on "TESLASTONE", "AMAZON" not on "AMAZONIA". */
function phraseHit(haystackNorm: string, phrase: string): boolean {
  const p = normalizeCompanyName(phrase);
  if (!p) return false;
  return new RegExp(`(^| )${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(haystackNorm);
}

/**
 * Identify the company behind a MAPPED FACILITY NAME, conservatively.
 * Returns outcome "ambiguous" when two different companies both claim the name — the
 * "WALMART C/O TESLA ENERGY" case — and "denied" when a false-friend guard fires.
 */
export function companyFromSiteName(siteName: string | null | undefined, registry: AliasEntry[]): IdentifyResult {
  const norm = normalizeCompanyName(siteName);
  if (!norm) return { entry: null, outcome: "no_match", reason: "empty facility name" };

  const hits: AliasEntry[] = [];
  const denied: string[] = [];
  for (const entry of registry || []) {
    if (!entry || !Array.isArray(entry.site_patterns)) continue;
    if (!entry.site_patterns.some((p) => phraseHit(norm, p))) continue;
    if ((entry.deny_patterns || []).some((d) => phraseHit(norm, d))) { denied.push(entry.company_key); continue; }
    hits.push(entry);
  }

  const distinct = hits.filter((h, i) => hits.findIndex((o) => o.company_key === h.company_key) === i);
  if (distinct.length === 1) return { entry: distinct[0], outcome: "matched", reason: "single registry entry claimed this facility" };
  if (distinct.length > 1) {
    return {
      entry: null, outcome: "ambiguous",
      reason: `${distinct.length} companies claim this facility name — held`,
      competing: distinct.map((d) => d.company_key),
    };
  }
  if (denied.length) return { entry: null, outcome: "denied", reason: `false-friend guard fired for ${denied.join(", ")}` };
  return { entry: null, outcome: "no_match", reason: "no registry entry claims this facility" };
}
