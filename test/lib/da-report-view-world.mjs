// SHARED FIXTURES for the Development Activity report view's suites (test/da-report-view.test.mjs and .browser.test.mjs).
//
// Every response comes from the REAL request handler (supabase/functions/get-development-activity-report/handler.ts), which runs the
// real assemble() (_shared/national-report.ts), over rows shaped like the ones production returns (the spatial read, app_projects, the
// change ledger, its reportable events and the source-health view). Nothing about the response shape is written by hand: what is
// written by hand is the WORLD the engine reads, and the engine decides the rest. The rights file is the one that ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await import('../../supabase/functions/get-development-activity-report/handler.ts');

export const NOW = new Date('2026-09-29T12:00:00Z');
export const FAM_A = 'wsdot-project-delivery-plan-proposed';
export const FAM_B = 'austin-site-plan-cases';
export const RIGHTS_SHIPPED = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/report-rights.json'), 'utf8'));
export const RIGHTS_AB = { version: 1, cleared: [
  { registry_id: FAM_A, cleared_on: '2026-09-29', audit_ref: 'test fixture', attribution: 'Data: WSDOT' },
  { registry_id: FAM_B, cleared_on: '2026-09-29', audit_ref: 'test fixture', attribution: '' },
] };
export const ADDRESS = '742 Evergreen Terrace, Springfield, OR 97477';

export const row = (k, d, fam, x = {}) => ({ source_key: k, feature_id: 'pt:' + k, registry_id: fam, provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'Point', has_more: false, ...x });
export const proj = (k, fam, x = {}) => ({
  source_key: k, registry_id: fam, record_kind: 'development', name: 'Record ' + k, type: 'Residential', type_raw: null, status: 'Proposed',
  stage: null, developer: null, size: null, investment: null, submitted_at: '2026-09-10', date_kind: 'filed', address: '005 King',
  source_ref: 'https://example.gov/records/' + k, ...x,
});
export const led = (k, fam) => ({ identity_key: k, registry_id: fam, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-20T19:00:00Z', last_observed_at: '2026-09-28T19:30:00Z' });
export const evt = (k, x = {}) => ({ identity_key: k, event_type: 'status_changed', material: true, observed_at: '2026-09-27T10:00:00Z', prev_facts: { status: 'Proposed', stage: 'Pending' }, new_facts: { status: 'Approved', stage: 'Advertised' }, changed_fields: ['stage', 'status'], publisher_event_type: 'issued', publisher_event_date: '2026-09-24', ...x });

/** The world the engine reads: what the spatial read, app_projects, the ledger and the health view would return. */
export const RICH = {
  rows: [
    row('k-approved', 0.2, FAM_A), row('k-first', 0.35, FAM_B), row('k-proposed', 0.4, FAM_B), row('k-decided', 0.5, FAM_B), row('k-old-appr', 0.6, FAM_A),
    row('k-op', 0.7, FAM_A), row('k-unk', 0.9, FAM_B), row('k-sched', 0.95, FAM_B), row('k-op-quiet', 0.3, FAM_A),
  ],
  projects: [
    proj('k-approved', FAM_A, { name: 'Menchaca Apartments', type: 'Residential', status: 'Approved', stage: 'Advertised', date_kind: 'issued', submitted_at: '2026-09-24' }),
    proj('k-first', FAM_B, { name: 'Lakeline Medical Office', type: 'Commercial', status: 'Proposed', date_kind: 'filed', submitted_at: '2026-03-01' }),
    proj('k-proposed', FAM_B, { name: 'Riverside Retail Center', type: 'Commercial', status: 'Proposed', date_kind: 'filed', submitted_at: '2026-09-10' }),
    proj('k-decided', FAM_B, { name: 'Oak Grove Townhomes', type: 'Residential', status: 'Decided', date_kind: 'decided', submitted_at: '2026-09-20' }),
    proj('k-old-appr', FAM_A, { name: 'Willow Creek Plat', type: 'Residential', status: 'Approved', date_kind: 'issued', submitted_at: '2025-01-10' }),
    proj('k-op', FAM_A, { name: 'Highway 99 Widening', type: 'Roads', status: 'Operating', date_kind: 'completed', submitted_at: '2026-09-22' }),
    proj('k-unk', FAM_B, { name: 'Fire Station 12', type: 'Civic/Public', status: 'On file', date_kind: 'issued', submitted_at: '2026-09-15' }),
    proj('k-sched', FAM_B, { name: 'Planned Bridge Replacement', type: 'Utility', status: 'Proposed', date_kind: 'scheduled', submitted_at: '2027-01-01' }),
    proj('k-op-quiet', FAM_A, { name: 'Quiet Operating Plant', type: 'Industrial', status: 'Operating', date_kind: 'scheduled', submitted_at: '2027-01-01' }),
  ],
  ledger: [led('k-approved', FAM_A), led('k-first', FAM_B)],
  events: [
    evt('k-approved'),
    evt('k-first', { event_type: 'first_detected', observed_at: '2026-09-26T08:00:00Z', prev_facts: null, new_facts: { status: 'Proposed' }, changed_fields: ['status'], publisher_event_type: null, publisher_event_date: null }),
  ],
  health: [],
};
/** Same world, no ledger: the cold start (nothing is change-ready yet). */
export const COLD = { ...RICH, ledger: [], events: [] };

export async function wire(world, { view = 'customer', rights = RIGHTS_AB, address = ADDRESS } = {}) {
  const deps = {
    now: () => NOW, rights,
    authenticate: async (t) => (t === 'user-token' ? { email: 'founder@example.com' } : null),
    isAdmin: async (e) => e === 'founder@example.com',
    geocode: async () => ({ matchedAddress: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477' }),
    zipSupported: async () => true,
    radius: async () => world.rows, hydrate: async () => world.projects, ledger: async () => world.ledger ?? [],
    events: async () => world.events ?? [], health: async () => world.health ?? [],
  };
  const res = await H.makeHandler(deps)(new Request('https://x.supabase.co/functions/v1/get-development-activity-report', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer user-token' }, body: JSON.stringify({ address, view }),
  }));
  return JSON.parse(await res.text());
}
export const clone = (x) => JSON.parse(JSON.stringify(x));
