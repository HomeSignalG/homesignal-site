// get-development-activity-report — request handling (Development Activity plan, Order G).
//
// The national Development Activity report as a JWT-protected server path. This file holds the LOGIC and reads no
// environment and calls no network: everything external arrives through `Deps`, so the whole request path is
// testable without Deno or a database (test/national-report-function.test.mjs).
//
// WHO MAY CALL IT is _shared/admin-gate.ts (`authorizeAdmin`), the ONE gate every internal function uses: a signed-in user whose
// email is in public.dashboard_admins. The gateway's JWT check alone is not enough, because the public anon key is a validly
// signed token. That is an internal diagnostic surface, which is what the plan permits before the account, entitlement and
// quota units (Orders H and L) exist; it is NOT a customer surface and cannot function as an unlimited customer generator.
// When those units land, the entitlement check replaces `isAdmin` in the shared gate.
//
// NOTHING IS STORED. This function never calls the snapshot writer and does not import issueSnapshot (a structural
// test fails if it does). `assemble` says whether a report COULD be stored (`storage_blockers`); the response reports
// it and stores nothing. Storing a real customer report waits for the gates in report-private-context-contract §6.
import {
  addDays, ALLOWED_RADII, assemble, dayOf, parseRadius, RECENT_DAYS, validateRights,
} from '../_shared/national-report.ts';
import { authorizeAdmin, MAX_BODY_BYTES, ALLOWED_ORIGINS, readBounded, reply, TOO_LARGE, corsFor } from '../_shared/admin-gate.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';
import type {
  LedgerProject, ProjectRow, RadiusRow, ReportableEvent, SourceHealth, View,
} from '../_shared/national-report.ts';

export { MAX_BODY_BYTES, ALLOWED_ORIGINS, DataUnavailable };
/** Rows requested from the canonical spatial read. It reports `has_more`, and a truncated area is disclosed, never hidden. */
export const RADIUS_ROW_LIMIT = 1000;

export type Geocoded = { matchedAddress: string; lat: number; lng: number; zip: string };

export type Deps = {
  now: () => Date;
  rights: unknown;
  authenticate: (token: string) => Promise<{ email: string } | null>;
  isAdmin: (email: string) => Promise<boolean>;
  geocode: (address: string) => Promise<Geocoded | null>;
  zipSupported: (zip: string) => Promise<boolean>;
  radius: (lat: number, lng: number, radiusMi: number) => Promise<RadiusRow[]>;
  hydrate: (keys: string[]) => Promise<ProjectRow[]>;
  ledger: (keys: string[]) => Promise<LedgerProject[]>;
  events: (keys: string[], sinceDay: string) => Promise<ReportableEvent[]>;
  health: (families: string[]) => Promise<SourceHealth[]>;
};

/** The geocoder itself could not be reached (distinct from "no match"). */
export class GeocoderUnavailable extends Error {}

export function capability() {
  return {
    product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
    method: 'POST { address, radius_mi?, view?, label? }',
    radius_mi: ALLOWED_RADII,
    recent_days: RECENT_DAYS,
    access: 'signed-in internal user only (JWT + dashboard_admins). Not a customer surface.',
    stores_reports: false,
  };
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function makeHandler(deps: Deps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
    if (req.method === 'GET') return reply(req, capability());
    if (req.method !== 'POST') return reply(req, { error: 'GET for the capability, POST to generate' }, 405);

    // 1. who is asking — the one shared gate: a signed-in user, then an allow-listed one
    const denied = await authorizeAdmin(req, deps);
    if (denied) return denied;

    // 2. what they asked — bounded, validated, and nothing unknown accepted
    const raw = await readBounded(req);
    if (raw === TOO_LARGE) return reply(req, { error: 'request_too_large' }, 413);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reply(req, { error: 'invalid_request' }, 400);
    const b = raw as Record<string, unknown>;
    const unknown = Object.keys(b).filter((k) => !['address', 'radius_mi', 'view', 'label'].includes(k));
    if (unknown.length) return reply(req, { error: 'invalid_request', detail: 'unknown field: ' + unknown[0] }, 400);
    const address = typeof b.address === 'string' ? b.address.trim() : '';
    if (address.length < 8 || address.length > 200 || address.indexOf(' ') < 0) return reply(req, { error: 'invalid_request', detail: 'address' }, 400);
    const radius = b.radius_mi === undefined ? 1 : parseRadius(b.radius_mi);
    if (radius === null) return reply(req, { error: 'invalid_request', detail: 'radius_mi must be one of ' + ALLOWED_RADII.join(', ') }, 400);
    const view = (b.view === undefined ? 'customer' : b.view) as View;
    if (view !== 'customer' && view !== 'internal') return reply(req, { error: 'invalid_request', detail: 'view' }, 400);
    let label: string | undefined;
    if (b.label !== undefined) {
      if (typeof b.label !== 'string' || b.label.length > 80) return reply(req, { error: 'invalid_request', detail: 'label' }, 400);
      label = b.label.trim() || undefined;
    }

    try {
      const rights = validateRights(deps.rights); // a malformed registry fails the request: never "everything is cleared"

      // 3. resolve the address, then the ZIP — before any credit-shaped decision
      const g = await deps.geocode(address);
      if (!g) return reply(req, { status: 'ADDRESS_NOT_RESOLVED', report: null, stored: false });
      const supported = await deps.zipSupported(g.zip);
      if (!supported) return reply(req, { status: 'OUTSIDE_COVERAGE', zip: g.zip, report: null, stored: false });

      // 4. the canonical reads
      const rows = await deps.radius(g.lat, g.lng, radius);
      const keys = [...new Set(rows.map((r) => r.source_key))].sort();
      const since = addDays(dayOf(deps.now()), -RECENT_DAYS);
      const [projects, ledger, events] = await Promise.all([
        deps.hydrate(keys), deps.ledger(keys), deps.events(keys, since),
      ]);
      const families = [...new Set(projects.map((p) => p.registry_id).filter((f): f is string => !!f))].sort();
      const health = families.length ? await deps.health(families) : [];

      // 5. compose
      const out = assemble({
        now: deps.now(), view, zip_supported: true, radius_mi: radius, rights,
        subject: { address, matched_address: g.matchedAddress, lat: g.lat, lng: g.lng, zip: g.zip, ...(label ? { label } : {}) },
        rows, projects, ledger, events, health,
      });
      return reply(req, {
        status: 'OK',
        coverage_state: out.coverage_state,
        report: out.intelligence,
        // for this response only: measured from the subject, so never part of the permanent report
        render: out.renderOnly,
        // nothing is stored by this endpoint; these say whether the report COULD be, later
        stored: false,
        report_id: null,
        storable: out.storage_blockers.length === 0,
        storage_blockers: out.storage_blockers,
      });
    } catch (e) {
      if (e instanceof GeocoderUnavailable) return reply(req, { error: 'geocoder_unavailable' }, 502);
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500); // never the message: it can carry the address
    }
  };
}
