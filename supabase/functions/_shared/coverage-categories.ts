// WHICH KINDS OF RECORD THE CONNECTED SOURCES COVER FOR A PLACE — and, as a separate fact, which kinds have NO connected source (report-accuracy-universal, 2026-11-19).
//
// Two things are kept apart and never merged: a source's GEOGRAPHIC SCOPE (statewide or county, source-applicability.ts) and its SUBJECT CATEGORY (what kinds of record it holds,
// the registry's `coverage_categories`). A statewide source can hold local permits or planning records; that is for the registry to declare, not for the scope to rule out.
// Neither a statewide nor a county scope implies COMPLETENESS: a connected category says "this source holds such records here", and `completeness` says whether the source
// declared (`coverage_complete_for`) that it holds all of them within its own scope. Without that declaration it is `not_established`, and the view never says "all".
//
// Four situations are kept apart and never merged:
//   no applicable source connected ....... a category no applicable source declares (`not_connected`, said only when every applicable source declares its categories)
//   applicable source failed / incomplete  SOURCE_NOT_FULLY_READ (national-report.ts, source health) — not decided here
//   source read fine, nothing matched .... the report's own outcome — not decided here
//   freshness uncertain .................. record dates (record-dates.ts, verification) — not decided here
//
// A category some applicable source declares is `connected` even when another applicable source declares nothing: known coverage is never erased by someone else's missing metadata.
// A category nobody declares is `not_connected` only while geography is verified AND every applicable source declares its categories; otherwise `not_established`.
// It never infers a category from an agency name, a dataset title, a jurisdiction level or a type map.
// Pure: no I/O, no clock, no place, source or agency name in the rules below.
import categoriesFile from './source-categories.generated.json' with { type: 'json' };
import { familyScope } from './source-applicability.ts';
import type { Jurisdiction } from './source-applicability.ts';

/** The closed vocabulary. */
export const CATEGORIES = Object.freeze({
  building_permits: { label: 'Building permits' },
  planning_zoning: { label: 'Planning and zoning cases' },
  subdivision_land_division: { label: 'Subdivisions and land divisions' },
  transportation_capital: { label: 'Transportation capital projects' },
} as const);
export type CategoryKey = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];
export const COVERAGE_CATEGORIES_RULE = 'coverage-categories-2';

const FILE = categoriesFile as unknown as { families?: Record<string, string[]>; complete?: Record<string, string[]> };
const REGISTRY_CATEGORIES: Record<string, string[]> = FILE.families ?? {};
const REGISTRY_COMPLETE: Record<string, string[]> = FILE.complete ?? {};

export type CategoryRef = { category: CategoryKey; label: string };
export type CategoryCoverage = {
  rule: string;
  /** a verified state and county were read for the subject; without them nothing can be said to be connected or missing */
  geography_verified: boolean;
  applicable_sources: number;
  /** applicable sources that declare no categories: while any exist, a category with no declaring source is "not established", never "not connected" */
  sources_without_category_metadata: number;
  /** a source holds records of the category here. scope: the geographic reach of the sources that declare it. completeness: `declared_complete` only when a source declared it holds ALL of them within its scope */
  connected: Array<CategoryRef & { scope: 'statewide' | 'county'; sources: number; completeness: 'declared_complete' | 'not_established' }>;
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
  complete: Record<string, string[]> = REGISTRY_COMPLETE,
): CategoryCoverage {
  const verified = places.length > 0 && applicable.length > 0;
  const withoutMeta = applicable.filter((id) => declared(id, registry).length === 0).length;
  const out: CategoryCoverage = {
    rule: COVERAGE_CATEGORIES_RULE, geography_verified: places.length > 0, applicable_sources: applicable.length,
    sources_without_category_metadata: withoutMeta, connected: [], not_connected: [], not_established: [],
  };
  for (const c of CATEGORY_KEYS) {
    const fams = applicable.filter((id) => declared(id, registry).includes(c));
    if (fams.length) {
      const county = fams.some((id) => scopeOf(id, places) === 'county');
      out.connected.push({ ...ref(c), scope: county ? 'county' : 'statewide', sources: fams.length,
        completeness: fams.some((id) => (complete[id] ?? []).includes(c)) ? 'declared_complete' : 'not_established' });
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
  const connected = list(o.connected), nc = list(o.not_connected), ne = list(o.not_established);
  if (o.rule !== COVERAGE_CATEGORIES_RULE || !connected || !nc || !ne) return null;
  return v as CategoryCoverage;
}
