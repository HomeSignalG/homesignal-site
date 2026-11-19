// WHICH KINDS OF RECORD THE CONNECTED SOURCES COVER FOR A PLACE — and, as a separate fact, which kinds have NO connected source (report-accuracy-universal, 2026-11-19).
//
// Four situations are kept apart and never merged:
//   no applicable source connected ....... a category no applicable source declares (`not_connected`, said only when every applicable source declares its categories)
//   applicable source failed / incomplete  SOURCE_NOT_FULLY_READ (national-report.ts, source health) — not decided here
//   source read fine, nothing matched .... the report's own outcome — not decided here
//   freshness uncertain .................. record dates (record-dates.ts, verification) — not decided here
//
// What this module reads is only DECLARED metadata: the registry's `coverage_categories` per source (generated: source-categories.generated.json) and its declared
// geography (source-applicability.ts). It never infers a category from an agency name, a dataset title, a jurisdiction level or a type map. A source that declares no
// categories is "not established": it might cover the category, so nothing is claimed either way. A statewide source never establishes a LOCAL category (building
// permits, planning, subdivisions) for a place; a county-declared source establishes it for that county's own jurisdiction only, and says so.
// Pure: no I/O, no clock, no place, source or agency name in the rules below.
import categoriesFile from './source-categories.generated.json' with { type: 'json' };
import { familyScope } from './source-applicability.ts';
import type { Jurisdiction } from './source-applicability.ts';

/** The closed vocabulary. `local` categories are issued by a place's own government, so only a source declared for that place can establish them. */
export const CATEGORIES = Object.freeze({
  building_permits: { label: 'Building permits', local: true },
  planning_zoning: { label: 'Planning and zoning cases', local: true },
  subdivision_land_division: { label: 'Subdivisions and land divisions', local: true },
  transportation_capital: { label: 'Transportation capital projects', local: false },
} as const);
export type CategoryKey = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];
export const COVERAGE_CATEGORIES_RULE = 'coverage-categories-1';

const REGISTRY_CATEGORIES: Record<string, string[]> =
  ((categoriesFile as unknown as { families?: Record<string, string[]> }).families) ?? {};

export type CategoryRef = { category: CategoryKey; label: string };
export type CategoryCoverage = {
  rule: string;
  /** a verified state and county were read for the subject; without them nothing can be said to be connected or missing */
  geography_verified: boolean;
  applicable_sources: number;
  /** applicable sources that declare no categories: while any exist, a category with no declaring source is "not established", never "not connected" */
  sources_without_category_metadata: number;
  connected: Array<CategoryRef & { scope: 'statewide' | 'county'; sources: number }>;
  /** a local category declared only by a statewide source: it does not establish coverage of this place */
  statewide_only: CategoryRef[];
  not_connected: CategoryRef[];
  not_established: CategoryRef[];
};

const ref = (c: CategoryKey): CategoryRef => ({ category: c, label: CATEGORIES[c].label });

/** The categories each applicable source declares (an unknown category word is ignored, never mapped). */
function declared(id: string, registry: Record<string, string[]>): CategoryKey[] {
  return (registry[id] ?? []).filter((c): c is CategoryKey => Object.prototype.hasOwnProperty.call(CATEGORIES, c));
}

export function categoryCoverage(
  places: Jurisdiction[], applicable: string[],
  registry: Record<string, string[]> = REGISTRY_CATEGORIES,
  scopeOf: (id: string, places: Jurisdiction[]) => 'statewide' | 'county' | null = familyScope,
): CategoryCoverage {
  const verified = places.length > 0 && applicable.length > 0;
  const withoutMeta = applicable.filter((id) => declared(id, registry).length === 0).length;
  const out: CategoryCoverage = {
    rule: COVERAGE_CATEGORIES_RULE, geography_verified: places.length > 0, applicable_sources: applicable.length,
    sources_without_category_metadata: withoutMeta, connected: [], statewide_only: [], not_connected: [], not_established: [],
  };
  for (const c of CATEGORY_KEYS) {
    const fams = applicable.filter((id) => declared(id, registry).includes(c));
    const county = fams.filter((id) => scopeOf(id, places) === 'county');
    if (CATEGORIES[c].local) {
      if (county.length) { out.connected.push({ ...ref(c), scope: 'county', sources: county.length }); continue; }
      if (fams.length) { out.statewide_only.push(ref(c)); continue; }
    } else if (fams.length) {
      out.connected.push({ ...ref(c), scope: county.length ? 'county' : 'statewide', sources: fams.length });
      continue;
    }
    // no source declares it: it is missing only when the metadata of every applicable source is complete and the geography is verified
    (verified && withoutMeta === 0 ? out.not_connected : out.not_established).push(ref(c));
  }
  return out;
}

/** A stored or passed value read back as a category coverage, or null when it is not one (the view then says nothing, never a guess). */
export function categoryCoverageOf(v: unknown): CategoryCoverage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((e) => e && typeof e === 'object' && typeof (e as CategoryRef).category === 'string' && Object.prototype.hasOwnProperty.call(CATEGORIES, (e as CategoryRef).category)) : null);
  const connected = list(o.connected), statewide = list(o.statewide_only), nc = list(o.not_connected), ne = list(o.not_established);
  if (o.rule !== COVERAGE_CATEGORIES_RULE || !connected || !statewide || !nc || !ne) return null;
  return v as CategoryCoverage;
}
