// SURFACE DECLARATION for every verifier — the answer to "which page, reading which table?"
//
// WHY THIS EXISTS (founder ruling, 2026-08-03). Both tables are authoritative, each for its own
// surface: the materializer's caps exist deliberately for list pages, and the map genuinely needs
// every site. The divergence is DESIGN, not defect, and is not being collapsed.
//
// What was missing is that no verification declared which surface it spoke about. On 2026-08-03
// `app_projects` held ZERO saint-paul rows while `development_reports` held 20,000 on a single ZIP
// — at the same moment, for five days, with every verifier green. Every "what do residents see"
// check had been run against `app_projects`; `homesignalmap.html` reads `development_reports`
// DIRECTLY and uncapped, so residents saw the retired data anyway.
//
// So: a verifier states its surface and its table in its own output header, and any claim about
// what residents see names the table. A clean materialized layer is NOT evidence about a surface
// that bypasses it.
//
// Matrix of record: QUEUE.md item 0d. Rule: docs/maps-go-live-governance.md,
// "A SECOND READER ON A DIVERGED SURFACE".

/**
 * surface  — the resident-facing page (or "n/a — data only" for pure data audits)
 * tables   — every table the verifier itself reads, in read order
 * capped   — true when the tables it reads are the MATERIALIZED (capped) layer
 * note     — anything a reader needs to not over-read the result
 */
export const SURFACES = {
  'verify-property-page': {
    surface: 'property.html (saved-place dossier; Del Valle 78617 is the pilot)',
    tables: ['app_projects'],
    capped: true,
    note: 'SIGNED-OUT ONLY — property.html is authenticated, so this exercises the EMPTY state plus '
        + 'the data a dossier would read. The rendered dossier itself is NOT covered.',
  },
  'verify-development': {
    surface: 'map page (homesignalmap.html?zip=)',
    tables: ['development_reports', 'app_community_meta', 'property_reports'],
    capped: false,
    note: 'reads the UNCAPPED cache the map page itself reads — says nothing about app_projects',
  },
  'verify-representative-zips': {
    surface: 'map page (homesignalmap.html?zip=)',
    tables: ['development_reports'],
    capped: false,
  },
  'audit-official-links': {
    surface: 'map page (homesignalmap.html?zip=)',
    tables: ['development_reports'],
    capped: false,
  },
  'verify-geocodes': {
    surface: 'map page (homesignalmap.html?zip=)',
    tables: ['development_reports'],
    capped: false,
    note: 'reads via the page; source-supplied geometry is never fenced',
  },
  'verify-maps': {
    surface: 'map page (homesignalmap.html?zip=)',
    tables: ['development_reports'],
    capped: false,
  },
  'verify-map-markers': {
    surface: 'map page + dashboard.html',
    tables: ['development_reports', 'app_projects'],
    capped: null,
    note: 'SPANS BOTH LAYERS — state which one any finding came from',
  },
  'verify-communities': {
    surface: 'community.html?zip=',
    tables: ['communities'],
    capped: false,
  },
  'verify-coverage-state': {
    surface: 'community.html?zip=',
    tables: ['app_community_meta'],
    capped: true,
  },
  'verify-alerts-page': {
    surface: 'alerts.html',
    tables: ['app_changes', 'alerts'],
    capped: true,
    note: 'app_changes is capped by app_refresh_zip at 6/6/8/48/48 — a missing row may be a CAP, not an absence',
  },
  'verify-alerts-categories': {
    surface: 'alerts.html',
    tables: ['app_changes'],
    capped: true,
  },
  'verify-facility-entity': {
    surface: 'development.html',
    tables: ['app_projects'],
    capped: true,
  },
  'verify-maps-uncap': {
    surface: 'n/a — data only',
    tables: ['app_projects'],
    capped: true,
  },
  'audit-marker-symbology': {
    surface: 'n/a — data only',
    tables: ['app_projects'],
    capped: true,
  },
  'verify-maps-live': {
    surface: 'development.html',
    tables: [],
    capped: null,
    note: 'drives the rendered page only — reads no table directly',
  },
  'verify-maps-rest-shapes': {
    surface: 'n/a — REST contract only',
    tables: [],
    capped: null,
  },
  'verify-maps-rollout': {
    surface: 'n/a — rollout state only',
    tables: [],
    capped: null,
  },
};

/** Surfaces that exist and have NO verifier. This is where the next silent defect lives. */
export const UNVERIFIED_SURFACES = [
  // The full property card, reached from the Maps slide-in's top link. Nothing drives it yet.
  // It ships with the offline gates (test/property-card.test.mjs pins the state vocabulary and
  // the "no count without a check" rule; test/property-card-page.test.mjs pins the page and the
  // slide-in link), but those are SOURCE assertions — they say nothing about the rendered live
  // page. The page exposes window.__HS_CARD for exactly that verifier when it is written.
  'property-card.html — property_reports, development_reports, app_projects',
  'properties.html  — app_projects, app_changes',
  'today.html       — app_projects, app_changes, meetings',
  'index.html       — app_community_meta (isCovered), app_changes',
  'maps.html        — app_projects, app_changes, meetings, facilities',
  'reports.html     — app_projects',
];

/** PARTIALLY covered surfaces — a verifier exists but does NOT cover the whole page.
 *
 *  WHY THIS STATE EXISTS (2026-08-04). property.html got its first verifier, and neither existing
 *  bucket could describe the result honestly. Listing it under SURFACES alone reads as "covered"
 *  — the exact over-read the surface rule was written to stop. Leaving it in UNVERIFIED_SURFACES
 *  reads as "nothing checks this", which is now false. A binary model forces one of two wrong
 *  answers, so the model was wrong.
 *
 *  Each entry MUST name the covering verifier AND the residual in plain words. "Partial" without
 *  a stated residual is just "covered" with extra steps.
 */
export const PARTIAL_SURFACES = [
  {
    page: 'property.html',
    verifier: 'verify-property-page',
    covered: 'signed-out surface (honest empty state, no persona leak, seed reachable only by opt-in) '
           + 'and the app_projects data a dossier would read (source_ref / coords / name)',
    residual: 'the RENDERED SIGNED-IN DOSSIER is not covered — property.html is authenticated, so an '
            + 'unauthenticated check can only reach the empty state. Covering it needs a test account, '
            + 'which is a founder call.',
  },
];

/** Print the declaration. Call FIRST in main(), before any assertion output. */
export function surfaceBanner(name) {
  const s = SURFACES[name];
  if (!s) throw new Error(`surface-banner: "${name}" is not declared in scripts/lib/surface-banner.mjs — declare it, do not skip it`);
  const cap = s.capped === true ? 'CAPPED (materialized layer)'
            : s.capped === false ? 'UNCAPPED (cache the page reads)'
            : 'n/a';
  console.log(`${name}: surface = ${s.surface}, table = ${s.tables.length ? s.tables.join(' + ') : '(none)'} [${cap}]`);
  if (s.note) console.log(`${name}: NOTE — ${s.note}`);
  return s;
}
