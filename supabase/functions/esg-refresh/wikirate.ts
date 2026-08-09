// wikirate.ts — the WikiRate client + metric classifier for the ESG company layer.
// WikiRate is the PRIMARY source; the World Benchmarking Alliance rides in as a metric
// DESIGNER on WikiRate (there is no public WBA REST API — api.worldbenchmarkingalliance.org
// does not resolve, verified 2026-08-09), which is also what gives WBA data clean attribution.
//
// Pure functions + an injected fetch, so the offline suite drives the SHIPPED classifier.

import { classifyCandidate, resolveCandidates, nameVariants, type CandidateLike, type MatchConfidence } from "./normalize.ts";

export const WIKIRATE_BASE = "https://wikirate.org";
export const WIKIRATE_ATTRIBUTION =
  "Company data from WikiRate (wikirate.org), licensed CC BY 4.0.";
export const WBA_ATTRIBUTION =
  "Benchmark data designed by the World Benchmarking Alliance, published on WikiRate (CC BY 4.0).";

/**
 * LICENSING GATE — designers whose answers we may DISPLAY.
 * WikiRate hosts community/NGO-designed metrics under CC BY 4.0, but it can also host
 * metrics whose underlying ratings are proprietary. The founder's rule is explicit: do not
 * display MSCI / Sustainalytics / S&P ESG or similar commercial scores without licensing.
 * This is an ALLOWLIST, so an unknown designer fails CLOSED (stored raw, never rendered).
 *
 * Verified 2026-08-09 across 9 sampled companies (1,800 answers): the designers present are
 * World Benchmarking Alliance (1,454), Walk Free, SBTi, Center for Political Accountability,
 * Clean Clothes Campaign, Commons, GRI, BHRRC, and university research groups.
 * ZERO MSCI / Sustainalytics / S&P / ISS / Refinitiv answers appeared.
 */
export const DISPLAY_DESIGNERS = new Set([
  "World Benchmarking Alliance",
  "Science Based Targets Initiative (SBTi)",
  "Global Reporting Initiative",
  "CDP",
]);
/** Never displayable, regardless of the allowlist — belt and braces for the founder's rule. */
export const PROPRIETARY_DESIGNERS = [
  /msci/i, /sustainalytics/i, /s&p/i, /\bsandp\b/i, /iss esg/i, /refinitiv/i,
  /moody/i, /bloomberg/i, /fitch/i, /ecovadis/i,
];
export function designerIsDisplayable(designer: string): boolean {
  if (PROPRIETARY_DESIGNERS.some((re) => re.test(designer))) return false;
  return DISPLAY_DESIGNERS.has(designer);
}

/** Which source a displayable designer is attributed to. */
export function sourceForDesigner(designer: string): "wba" | "wikirate" {
  return designer === "World Benchmarking Alliance" ? "wba" : "wikirate";
}

export interface WikirateAnswer {
  metric: string;      // "<Designer>+<Title>" or "<Designer>+<Title>+<Research Group>"
  company: string;
  year: number | string;
  value: string;
  url?: string;
}
export interface ParsedMetric {
  designer: string;
  title: string;
  researchGroup: string | null;
  /** true when this is the numeric-scored twin of a Yes/No disclosure answer. */
  scored: boolean;
}
export function parseMetricName(metric: string): ParsedMetric {
  const parts = String(metric || "").split("+");
  return {
    designer: parts[0] || "",
    title: parts[1] || "",
    researchGroup: parts[2] || null,
    scored: parts.length > 2,
  };
}

// ── E / S / G classification ──────────────────────────────────────────────────────────
// Classified from the metric's OWN WORDS. Anything that does not self-describe is left
// UNCLASSIFIED and still shown under its own name — never forced into a pillar, because a
// forced pillar is an editorial claim about what a metric measures.
export type Pillar = "environmental" | "social" | "governance" | "unclassified";
const PILLAR_WORDS: [Pillar, RegExp][] = [
  ["environmental", /climate|emission|greenhouse|ghg|carbon|energy|water|waste|circular|nature|biodiversity|pollut|environment|resilien|1\.5°c|deforest/i],
  ["governance",    /governance|board|remuneration|accountab|anti-?corruption|bribery|lobby|political|tax|ethic|transparen|audit|whistleblow/i],
  ["social",        /social|worker|employe|labour|labor|human right|divers|inclusi|gender|health|safety|community|just transition|wage|child|forced|supply chain|skills|redundanc|digital access|literacy|cyber|privacy|consumer/i],
];
export function pillarFor(title: string): Pillar {
  for (const [pillar, re] of PILLAR_WORDS) if (re.test(title)) return pillar;
  return "unclassified";
}

/**
 * WBA prefixes many indicator titles with a benchmark code ("URB-A.01.A - Material
 * Sustainability Impact Identification"). The code is internal methodology structure; the
 * words after it are the self-describing part a resident can read. Strip the code, keep
 * the words verbatim — never reword them.
 */
export function displayTitle(title: string): string {
  return String(title || "").replace(/^[A-Z]{2,4}-[A-Z0-9.]+\s+-\s+/, "").trim();
}

/**
 * THE HOMEOWNER SHORTLIST — which of a company's ~186 answers are worth a resident's
 * attention. This is the "useful vs unnecessary clutter" question the pilot exists to
 * answer, and it is deliberately a small, reviewed allowlist of SUBJECTS (emissions,
 * water, waste, pollution, and the governance/social facts a neighbour would actually
 * weigh) rather than a dump of every indicator.
 *
 * ⚠️ WHY THIS REPLACED AN EARLIER "headline metrics only" RULE — a real defect, measured
 * 2026-08-09 and worth not re-introducing: that rule kept only pillar/benchmark roll-ups
 * plus two named metrics. But WBA's roll-ups are ALL numeric (and numbers are suppressed,
 * because WikiRate publishes no scale), while its Yes/No answers are the indicators. The
 * two filters were each defensible and jointly EMPTY: Microsoft's 85 Yes/No answers
 * yielded 2, and Republic Services' 55 yielded 0 — every one of Republic's Yes/No titles
 * is code-prefixed. A rule that renders nothing for every company is indistinguishable
 * from a rule that is working, which is exactly the failure mode to design against.
 */
const HOMEOWNER_METRICS = [
  /greenhouse gas emissions (reporting|reduction targets)/i,
  /progress on greenhouse gas emissions reduction/i,
  /water use (reporting|reduction (target|progress))/i,
  /water use and energy consumption reporting/i,
  /(targets|progress) for water use reduction or energy efficiency/i,
  /progress on water use reduction or energy efficiency/i,
  /water pollutant reduction (target|progress)/i,
  /water pollution risk assessment/i,
  /waste (reduction (target|progress reporting)|recovery and recycling reporting)/i,
  /climate (transition plan|change risk)/i,
  /nature-related risks/i,
  /sustainability strategy disclosure/i,
  /governance body sustainability responsibility/i,
  /executive remuneration sustainability linkage/i,
  /human rights (commitment|policy|due diligence)/i,
  /health and safety/i,
  /diversity and inclusion policy/i,
  /community investments disclosure/i,
];
/** True when a metric is on the reviewed homeowner shortlist (code prefix ignored). */
export function isHeadlineMetric(title: string): boolean {
  const t = displayTitle(title);
  return HOMEOWNER_METRICS.some((re) => re.test(t));
}

/**
 * A VALUE WE CAN HONESTLY SHOW.
 * Yes/No answers are self-describing and need no scale. Numeric answers do NOT: verified
 * 2026-08-09, WikiRate publishes NO unit and NO value_type for these WBA metrics — both
 * `+unit.json` and `+value_type.json` return HTTP 404 and the metric card returns pointer
 * stubs with "id": null. A bare "1.8623333" therefore has no stated maximum anywhere in the
 * API, so rendering it as a score would invent a scale. Numbers are suppressed until a
 * scale is sourced; the disclosure answers carry the meaning instead.
 */
export function displayableValue(value: string): { text: string; kind: "disclosure" } | null {
  const v = String(value ?? "").trim();
  if (/^(yes|no)$/i.test(v)) return { text: v.charAt(0).toUpperCase() + v.slice(1).toLowerCase(), kind: "disclosure" };
  return null;
}

export interface EsgMetricRow { label: string; value: string; year: number; source: "wba" | "wikirate"; metric_url?: string }
export interface ClassifiedEsg {
  environmental: EsgMetricRow[];
  social: EsgMetricRow[];
  governance: EsgMetricRow[];
  unclassified: EsgMetricRow[];
  reporting_year: number | null;
  /** Metrics dropped, with the reason — the audit trail for "why isn't X shown?". */
  dropped: { title: string; reason: string }[];
}

/** Turn a company's raw answers into the display-ready, licence-filtered pillar buckets. */
export function classifyAnswers(answers: WikirateAnswer[]): ClassifiedEsg {
  const out: ClassifiedEsg = { environmental: [], social: [], governance: [], unclassified: [], reporting_year: null, dropped: [] };
  const seen = new Set<string>();
  let maxYear = 0;

  for (const a of answers || []) {
    const { designer, title, scored } = parseMetricName(a.metric);
    const year = Number(a.year);
    if (!title) continue;
    if (!designerIsDisplayable(designer)) { out.dropped.push({ title, reason: `designer not on the display allowlist (${designer})` }); continue; }
    if (!isHeadlineMetric(title))          { out.dropped.push({ title, reason: "not on the reviewed homeowner shortlist" }); continue; }
    const val = displayableValue(a.value);
    if (!val) { out.dropped.push({ title, reason: `value "${a.value}" has no stated scale in the API — suppressed rather than invented` }); continue; }
    if (scored) { out.dropped.push({ title, reason: "scored twin of a disclosure answer" }); continue; }

    const key = `${title}|${year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (Number.isFinite(year) && year > maxYear) maxYear = year;
    const shown = displayTitle(title);
    out[pillarFor(shown)].push({
      label: shown, value: val.text, year, source: sourceForDesigner(designer),
      metric_url: a.url,
    });
  }
  // Most recent first, then alphabetical — deterministic ordering for a stable UI.
  for (const k of ["environmental", "social", "governance", "unclassified"] as const) {
    out[k].sort((x, y) => (y.year - x.year) || x.label.localeCompare(y.label));
  }
  out.reporting_year = maxYear || null;
  return out;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface SearchOutcome {
  confidence: MatchConfidence;
  candidate: CandidateLike | null;
  tried: string[];
  tied: CandidateLike[];
  reason: string;
  raw: { endpoint: string; status: number; payload: unknown }[];
}

/**
 * Resolve a company name to ONE WikiRate card, trying the normalized variants in order.
 * A variant that returns candidates but no core-equal one keeps going; a variant that
 * returns a TIE stops immediately as ambiguous — a later, looser variant must never be
 * allowed to "resolve" something the more specific query already found ambiguous.
 */
export async function searchCompany(name: string, fetchJson: FetchLike): Promise<SearchOutcome> {
  const tried: string[] = [];
  const raw: { endpoint: string; status: number; payload: unknown }[] = [];
  for (const variant of nameVariants(name)) {
    const endpoint = `${WIKIRATE_BASE}/Company.json?filter%5Bname%5D=${encodeURIComponent(variant)}&limit=20`;
    tried.push(variant);
    const res = await fetchJson(endpoint);
    const payload = res.ok ? await res.json() : null;
    raw.push({ endpoint, status: res.status, payload });
    if (!res.ok || !payload) continue;
    const items = ((payload as { items?: CandidateLike[] }).items || [])
      .map((i) => ({ id: (i as { id: number }).id, name: (i as { name: string }).name }));
    if (!items.length) continue;
    const r = resolveCandidates(name, items);
    if (r.confidence !== "ambiguous") return { ...r, tried, raw };
    if (r.tied.length) return { ...r, tried, raw };   // a real tie is terminal
  }
  return { confidence: "ambiguous", candidate: null, tried, tied: [], reason: "no core-equal candidate on any name variant", raw };
}

/** Fetch a resolved company's answers (company_id filter ONLY — see the warning below). */
export async function fetchAnswers(companyId: string | number, fetchJson: FetchLike, limit = 200) {
  // ⚠️ filter[company_name] IS BROKEN/IGNORED upstream: verified 2026-08-09,
  // Answer.json?filter[company_name]=Microsoft+Corporation returned answers for KIABI.
  // Always filter by company_id — a wrong-company answer set is the exact failure this
  // whole layer exists to prevent.
  const endpoint = `${WIKIRATE_BASE}/Answer.json?filter%5Bcompany_id%5D=${encodeURIComponent(String(companyId))}&limit=${limit}`;
  const res = await fetchJson(endpoint);
  const payload = res.ok ? await res.json() : null;
  const items = (payload as { items?: WikirateAnswer[] } | null)?.items || [];
  return { endpoint, status: res.status, payload, answers: items };
}

/** The aliases WikiRate itself publishes for a card — the ONLY sourced alias authority. */
export async function fetchAliases(cardName: string, fetchJson: FetchLike): Promise<string[]> {
  const slug = cardName.replace(/\s+/g, "_");
  const endpoint = `${WIKIRATE_BASE}/${encodeURIComponent(slug)}.json`;
  const res = await fetchJson(endpoint);
  if (!res.ok) return [];
  const payload = await res.json().catch(() => null) as { alias?: { content?: string[] } } | null;
  return payload?.alias?.content || [];
}

export { classifyCandidate, resolveCandidates, nameVariants };
