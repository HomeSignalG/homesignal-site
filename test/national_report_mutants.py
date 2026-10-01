#!/usr/bin/env python3
"""Prohibited mutations of the national Development Activity report (Order G). Each MUST make at least one of

    test/national-report.test.mjs
    test/national-report-function.test.mjs
    test/national-report-structure.test.mjs

exit non-zero. Run:  python3 test/national_report_mutants.py   [name ...]

It edits files in place, runs the suites, and ALWAYS restores the originals (even on error or ^C). An anchor that does not
match exactly once is a harness failure, never a pass. Exit 1 if any mutation survives, 2 on a harness fault.
(Manual, like report_snapshot_module_mutants.py: CI runs the node tests, not this loop.)
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOD = 'supabase/functions/_shared/national-report.ts'
HAN = 'supabase/functions/get-development-activity-report/handler.ts'
DAT = 'supabase/functions/get-development-activity-report/data.ts'
IDX = 'supabase/functions/get-development-activity-report/index.ts'
GATE = 'supabase/functions/_shared/admin-gate.ts'
REST = 'supabase/functions/_shared/service-rest.ts'
CHG = 'supabase/functions/_shared/change-reads.ts'
CFG = 'supabase/config.toml'
WF = '.github/workflows/deploy-edge-functions.yml'
REG = 'supabase/functions/_shared/report-rights.json'
GEN = 'supabase/functions/_shared/project-type.generated.js'
TESTS = ['test/national-report.test.mjs', 'test/national-report-function.test.mjs', 'test/national-report-structure.test.mjs']

# name -> list of (file, old, new)
M = {}


def m(name, file, old, new):
    M[name] = [(file, old, new)]


# ---- the rights gate ----------------------------------------------------------------------------------------------------
m('rights_gate_off', MOD, "if (view === 'customer') { excluded.no_rights", "if (false) { excluded.no_rights")
m('unlisted_family_cleared', MOD, "const grant = cleared.get(family);", "const grant = cleared.get(family) ?? { registry_id: family, cleared_on: '2026-01-01', audit_ref: 'x', attribution: '' };")
m('hold_not_labelled', MOD, "if (view === 'internal') entry.rights = grant ? 'CLEARED' : 'HOLD';", "void 0;")
m('internal_view_storable', MOD, "if (view !== 'customer') blockers.push('INTERNAL_VIEW');", "void 0;")
m('hold_blocker_removed', MOD, "if (anyHold) blockers.push('CONTAINS_UNCLEARED_SOURCE');", "void 0;")
m('wildcard_registry_allowed', MOD, "if (/[*?%]/.test(e.registry_id)) throw", "if (false) throw")
m('duplicate_registry_allowed', MOD, "if (seen.has(e.registry_id)) throw", "if (false) throw")
m('audit_ref_optional', MOD, "for (const k of ['registry_id', 'cleared_on', 'audit_ref'])", "for (const k of ['registry_id', 'cleared_on'])")
m('impossible_date_allowed', MOD, "if (!validDay(e.cleared_on)) throw", "if (false) throw")
m('attribution_dropped', MOD, "attribution: grant ? (grant.attribution || null) : null", "attribution: null")
m('empty_registry_not_limited', MOD, "if (rights.cleared.length === 0) {", "if (false) {")
m('partial_exclusion_not_disclosed', MOD, "} else if (Object.keys(excluded.no_rights).length > 0) {", "} else if (false) {")
# ---- the recent-activity window --------------------------------------------------------------------------------------------
m('window_not_bounded_above', MOD, "if (date > today || date < addDays(today, -RECENT_DAYS)) return null;", "if (date < addDays(today, -RECENT_DAYS)) return null;")
m('window_not_bounded_below', MOD, "if (date > today || date < addDays(today, -RECENT_DAYS)) return null;", "if (date > today) return null;")
m('window_one_day_short', MOD, "if (date > today || date < addDays(today, -RECENT_DAYS)) return null;", "if (date > today || date < addDays(today, -(RECENT_DAYS - 1))) return null;")
m('plans_count_as_events', MOD, "filed: 'Filed', issued: 'Issued',", "scheduled: 'Scheduled', filed: 'Filed', issued: 'Issued',")
m('inherited_kind_accepted', MOD, "if (!Object.prototype.hasOwnProperty.call(EVENT_KINDS, kind)) return null;", "if (!(kind in EVENT_KINDS)) return null;")
m('date_not_validated', MOD, "if (!validDay(p.submitted_at)) return null;", "if (!p.submitted_at) return null;")
m('operating_inventory_listed', MOD, "if (lc.key === 'operating' && !ev && !changeCounts) {", "if (false) {")
# ---- change intelligence -----------------------------------------------------------------------------------------------------
m('change_without_change_ready', MOD, "if (!isChangeReady(led)) return [];", "if (false) return [];")
m('change_ready_means_present', MOD, "return !!led && led.change_ready === true;", "return !!led;")
m('non_material_counts', MOD, ".filter((e) => e.material === true && keep(e))", ".filter((e) => keep(e))")
m('event_window_unbounded', MOD, "(e) => String(e.observed_at).slice(0, 10) >= windowStart && String(e.observed_at).slice(0, 10) <= today);", "(e) => true);")
m('from_to_swapped', MOD, "from: (e.prev_facts ?? {})[f] ?? null, to: (e.new_facts ?? {})[f] ?? null", "from: (e.new_facts ?? {})[f] ?? null, to: (e.prev_facts ?? {})[f] ?? null")
m('state_never_change_ready', MOD, "limitations.length > 0 ? 'LIMITED_COVERAGE' : anyChangeReady ? 'CHANGE_READY' : 'REPORT_READY'", "limitations.length > 0 ? 'LIMITED_COVERAGE' : 'REPORT_READY'")
# ---- Type and lifecycle stay with the authority -------------------------------------------------------------------------------------
m('lifecycle_promoted', MOD, "const lc = HS().canonicalLifecycle({ status: p.status });",
  "const lc0 = HS().canonicalLifecycle({ status: p.status }); const lc = String(p.status).toLowerCase() === 'decided' ? { key: 'proposed', label: 'Proposed' } : lc0;")
m('publisher_status_normalised', MOD, "publisher_status: p.status,", "publisher_status: lc.key,")
m('type_from_wrong_field', MOD, "HS().canonicalProjectType({ type: p.type, name: p.name })", "HS().canonicalProjectType({ type: p.type_raw, name: p.name })")
# ---- the split and the boundary ---------------------------------------------------------------------------------------------------
m('distance_into_intelligence', MOD, "source_family: family || null,", "source_family: family || null, distance_mi: distance.get(p.source_key),")
m('address_into_intelligence', MOD, "    zip: subject.zip,\n    radius_mi,", "    zip: subject.zip, subject_address: subject.address,\n    radius_mi,")
m('street_line_into_intelligence', MOD, "    zip: subject.zip,\n    radius_mi,", "    zip: subject.zip, subject_street: subject.address.split(',')[0],\n    radius_mi,")
m('coordinate_into_intelligence', MOD, "    zip: subject.zip,\n    radius_mi,", "    zip: subject.zip, subject_lat: subject.lat,\n    radius_mi,")
m('label_into_intelligence', MOD, "    zip: subject.zip,\n    radius_mi,", "    zip: subject.zip, subject_label: subject.label ?? null,\n    radius_mi,")
m('engine_inputs_carry_address', MOD, "engine: REPORT_VERSION, zip: subject.zip,", "engine: REPORT_VERSION, address: subject.address, zip: subject.zip,")
m('private_label_dropped', MOD, "    ...(subject.label ? { label: subject.label } : {}),\n", "")
m('boundary_whole_address_skipped', MOD, "if (ctx.address && has(norm(ctx.address))) findings.push('ADDRESS_IN_BODY');", "void 0;")
m('boundary_normalised_skipped', MOD, "if (ctx.normalized_address && has(norm(ctx.normalized_address))) findings.push('NORMALIZED_ADDRESS_IN_BODY');", "void 0;")
m('boundary_label_skipped', MOD, "if (ctx.label && has(norm(ctx.label))) findings.push('LABEL_IN_BODY');", "void 0;")
m('boundary_fragments_skipped', MOD, "for (const f of addressFragments(src)) if (hasSub(f.text))", "for (const f of addressFragments(src)) if (false)")
m('boundary_coordinates_skipped', MOD, "if (decimals >= 5 && body.includes(String(c))) findings.push('COORDINATE_IN_BODY');", "void 0;")
m('boundary_relative_keys_skipped', MOD, "for (const k of subjectRelativeKeys(JSON.parse(body))) findings.push('SUBJECT_RELATIVE_KEY:' + k);", "void 0;")
m('boundary_word_bounded', MOD, "const has = (needle: string) => needle.length >= 3 && text.includes(needle);", "const has = (needle: string) => needle.length >= 3 && text.includes(' ' + needle + ' ');")
m('finding_repeats_the_value', MOD, "findings.push('ADDRESS_FRAGMENT_IN_BODY:' + f.kind)", "findings.push('ADDRESS_FRAGMENT_IN_BODY:' + f.text)")
m('house_number_fragment_dropped', MOD, "    if (t.length >= 5 && t !== street) out.push({ kind: 'house_number_and_street', text: t });", "")
m('storage_blockers_ignore_boundary', MOD, "for (const f of boundaryFindings(intelligence, privateContext)) blockers.push('BOUNDARY:' + f);", "void 0;")
# ---- coverage ----------------------------------------------------------------------------------------------------------------------------
m('truncation_ignored', MOD, "const truncated = input.rows.some((r) => r.has_more === true);", "const truncated = false;")
m('truncation_inferred_from_count', MOD, "const truncated = input.rows.some((r) => r.has_more === true);", "const truncated = input.rows.length >= 1000;")
m('health_of_other_families_counts', MOD, ".filter((h) => families.has(h.registry_id))", "")
m('health_ignored', MOD, "if (sourcesNotFullyRead(input.health, familiesIncluded))", "if (false)")
m('outside_coverage_reports', MOD, "if (!input.zip_supported) {", "if (false) {")
m('nearest_becomes_farthest', MOD, "if (cur === undefined || r.distance_mi < cur) distance.set", "if (cur === undefined || r.distance_mi > cur) distance.set")
m('projects_unsorted', MOD, "for (const p of [...input.projects].sort((a, b) => (a.source_key < b.source_key ? -1 : 1))) {", "for (const p of [...input.projects]) {")
m('source_url_optional', MOD, "if (!p.source_ref || !p.source_ref.trim()) {", "if (false) {")
m('non_development_included', MOD, "if (p.record_kind !== 'development') {", "if (false) {")
m('any_radius_accepted', MOD, "return ALLOWED_RADII.includes(n) ? n : null;", "return Number.isFinite(n) ? n : null;")
# ---- who may ask ----------------------------------------------------------------------------------------------------------------------------
m('missing_token_proceeds', GATE, "if (!token) return reply(req, { error: 'unauthorized' }, 401);", "void 0;")
m('anon_key_becomes_a_user', GATE, "if (!user || !user.email) return reply(req, { error: 'unauthorized' }, 401);", "user = user ?? { email: 'anonymous' };")
m('admin_check_skipped', GATE, "if (!admin) return reply(req, { error: 'forbidden' }, 403);", "void 0;")
m('admin_read_failure_passes', GATE, "try { admin = await deps.isAdmin(user.email); } catch { return reply(req, { error: 'unavailable' }, 502); }", "try { admin = await deps.isAdmin(user.email); } catch { admin = true; }")
m('auth_failure_passes', GATE, "try { user = await deps.authenticate(token); } catch { return reply(req, { error: 'unavailable' }, 502); }", "try { user = await deps.authenticate(token); } catch { user = { email: 'founder@example.com' }; }")
m('unknown_fields_ignored', HAN, "if (unknown.length) return reply(", "if (false) return reply(")
m('body_size_not_bounded', GATE, "if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return TOO_LARGE;", "void 0;")
m('declared_length_ignored', GATE, "if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return TOO_LARGE;", "void 0;")
m('default_radius_wrong', HAN, "const radius = b.radius_mi === undefined ? 1 : parseRadius(b.radius_mi);", "const radius = b.radius_mi === undefined ? 2 : parseRadius(b.radius_mi);")
m('default_view_internal', HAN, "(b.view === undefined ? 'customer' : b.view)", "(b.view === undefined ? 'internal' : b.view)")
m('label_unbounded', HAN, "b.label.length > 80", "b.label.length > 8000")
m('address_bounds_removed', HAN, "if (address.length < 8 || address.length > 200 || address.indexOf(' ') < 0)", "if (false)")
m('data_failure_returns_ok', HAN, "if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);", "if (e instanceof DataUnavailable) return reply(req, { status: 'OK', coverage_state: 'REPORT_READY', report: null }, 200);")
m('error_message_echoed', HAN, "return reply(req, { error: 'internal' }, 500);", "return reply(req, { error: String((e as any)?.message) }, 500);")
m('cors_wildcard', GATE, "if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;", "h['Access-Control-Allow-Origin'] = '*';")
m('response_cacheable', GATE, "'Cache-Control': 'no-store'", "'Cache-Control': 'public, max-age=3600'")
m('response_claims_stored', HAN, "stored: false,\n        report_id: null,", "stored: true,\n        report_id: null,")
m('storable_always_true', HAN, "storable: out.storage_blockers.length === 0,", "storable: true,")
m('events_window_wrong', HAN, "const since = addDays(dayOf(deps.now()), -RECENT_DAYS);", "const since = dayOf(deps.now());")
m('keys_not_deduped', HAN, "const keys = [...new Set(rows.map((r) => r.source_key))].sort();", "const keys = rows.map((r) => r.source_key);")
m('unresolved_address_reports', HAN, "if (!g) return reply(req, { status: 'ADDRESS_NOT_RESOLVED', report: null, stored: false });", "if (!g) return reply(req, { status: 'OK', report: null, stored: false });")
m('outside_coverage_proceeds', HAN, "if (!supported) return reply(req, { status: 'OUTSIDE_COVERAGE', zip: g.zip, report: null, stored: false });", "void 0;")
m('capability_claims_storage', HAN, "stores_reports: false,", "stores_reports: true,")
m('handler_logs_the_address', HAN, "const address = typeof b.address === 'string' ? b.address.trim() : '';", "const address = typeof b.address === 'string' ? b.address.trim() : ''; console.log(address);")
m('handler_imports_the_writer', HAN, "export { MAX_BODY_BYTES, ALLOWED_ORIGINS, DataUnavailable };", "import { issueSnapshot } from '../_shared/report-snapshot.ts'; void issueSnapshot;\nexport { MAX_BODY_BYTES, ALLOWED_ORIGINS, DataUnavailable };")
# ---- the reads ------------------------------------------------------------------------------------------------------------------------------
m('read_error_returns_empty', REST, "if (!r.ok) throw new DataUnavailable('http ' + r.status);\n    let rows: unknown;", "if (!r.ok) return [] as T[];\n    let rows: unknown;")
m('row_cap_not_enforced', REST, "if (rows.length >= POSTGREST_ROW_CAP) throw", "if (false) throw")
m('radius_error_returns_empty', DAT, "if (!r.ok) throw new DataUnavailable('http ' + r.status); // a refused radius is an error, not \"nothing nearby\"", "if (!r.ok) return [];")
m('admin_case_insensitive', REST, "return rows.length === 1 && rows[0].email === email;", "return rows.length === 1 && rows[0].email.toLowerCase() === email.toLowerCase();")
m('anon_token_is_a_user', REST, "if (r.status === 401 || r.status === 403 || r.status === 404) return null; // includes the public anon key: no user\n", "")
m('zip_unvalidated', DAT, "if (!/^\\d{5}$/.test(zip)) return false;\n      const rows", "const rows")
m('hydrate_all_record_kinds', DAT, "&record_kind=eq.development&source_key=in.", "&source_key=in.")
m('hydrate_keeps_oldest', DAT, "if (!cur || String(r.last_seen_at ?? '') > String(cur.last_seen_at ?? '')) best.set", "if (!cur || String(r.last_seen_at ?? '') < String(cur.last_seen_at ?? '')) best.set")
m('bookkeeping_column_leaks', DAT, "return [...best.values()].map(({ last_seen_at: _drop, ...p }) => p as ProjectRow);", "return [...best.values()] as ProjectRow[];")
m('raw_event_table_read', CHG, "rest('dev_change_event_reportable?select=' + EVENT_COLUMNS + '&observed_at=gte.'", "rest('dev_change_event?select=' + EVENT_COLUMNS + '&observed_at=gte.'")
m('raw_event_table_read_written_since', CHG, "rest('dev_change_event_reportable?select=' + EVENT_COLUMNS + ',created_at&material=eq.true&created_at=gt.'", "rest('dev_change_event?select=' + EVENT_COLUMNS + ',created_at&material=eq.true&created_at=gt.'")
m('chunk_too_large', REST, "const KEY_CHUNK = 25;", "const KEY_CHUNK = 5000;")
m('quote_not_escaped', REST, "'\"' + String(v).replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"') + '\"'", "'\"' + String(v) + '\"'")
m('second_geocoder', DAT, "r = await fetchFn(base + '/functions/v1/geocode-address', {", "r = await fetchFn('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress', {")
m('spatial_limit_dropped', DAT, ", p_limit: RADIUS_ROW_LIMIT }", " }")
m('geocode_zip_unchecked', DAT, "|| !/^\\d{5}$/.test(String(m.zip))) return null;", ") return null;")
m('service_key_to_third_party', REST, "try { r = await fetchFn(base + '/rest/v1/' + path, { headers: svc }); }", "try { r = await fetchFn('https://example.com/rest/v1/' + path, { headers: svc }); }")
# ---- config, registry, generated copy ---------------------------------------------------------------------------------------------------------
m('jwt_verification_off', CFG, "[functions.get-development-activity-report]\nverify_jwt = true", "[functions.get-development-activity-report]\nverify_jwt = false")
m('deploy_exempts_it_from_jwt', WF, 'if [ "$FN" = "get-address-report" ]; then', 'if [ "$FN" = "get-address-report" ] || [ "$FN" = "get-development-activity-report" ]; then')
m('a_source_is_cleared', REG, '"cleared": []', '"cleared": [{"registry_id": "x", "cleared_on": "2026-09-29", "audit_ref": "y", "attribution": ""}]')
m('generated_copy_drifts', GEN, "// ==== BEGIN lib/project-type.js (verbatim) ====\n", "// ==== BEGIN lib/project-type.js (verbatim) ====\n// edited by hand\n")
m('module_defines_its_own_type_rule', MOD, "export const LIFECYCLE_ORDER =", "const CATEGORY_REGISTRY = {}; void CATEGORY_REGISTRY;\nexport const LIFECYCLE_ORDER =")
m('module_reads_the_environment', MOD, "export const PRODUCT_NAME =", "const _k = (globalThis as any).Deno?.env?.get('SUPABASE_URL'); void _k;\nexport const PRODUCT_NAME =")
m('rights_class_column_read', CHG, "const cols = 'identity_key,registry_id,comparable,change_ready,", "const cols = 'rights_class,identity_key,registry_id,comparable,change_ready,")


RSW = '.github/workflows/report-snapshot-suite.yml'
RUN = 'test/national_report_pg/run.sh'
m('roundtrip_dropped_from_workflow', RSW, "bash test/national_report_pg/run.sh 2>&1", "echo skipped 2>&1")
m('roundtrip_node_not_pinned', RSW, "node-version: '22'", "node-version: '20'")
m('roundtrip_paths_forget_the_engine', RSW, "      - 'supabase/functions/_shared/national-report.ts'\n      - 'supabase/functions/_shared/project-type.generated.js'\n      - 'supabase/functions/_shared/report-rights.json'\n      - 'test/dev_change_ledger_pg/fixture.sql'\n      - 'test/changes_since_report_pg/**'\n      - 'supabase/functions/_shared/changes-since-report.ts'\n      - 'supabase/functions/_shared/change-reads.ts'\n      - 'supabase/functions/_shared/service-rest.ts'\n      - 'supabase/functions/_shared/admin-gate.ts'\n      - 'supabase/functions/follow-development-report/**'\n      - 'docs/dev-change-reportable.sql'\n      - 'docs/dev-change-ledger.sql'\n      - '.github/workflows/report-snapshot-suite.yml'\n  push:",
  "      - 'test/dev_change_ledger_pg/fixture.sql'\n      - 'test/changes_since_report_pg/**'\n      - 'supabase/functions/_shared/changes-since-report.ts'\n      - 'supabase/functions/_shared/change-reads.ts'\n      - 'supabase/functions/_shared/service-rest.ts'\n      - 'supabase/functions/_shared/admin-gate.ts'\n      - 'supabase/functions/follow-development-report/**'\n      - 'docs/dev-change-reportable.sql'\n      - 'docs/dev-change-ledger.sql'\n      - '.github/workflows/report-snapshot-suite.yml'\n  push:")
m('roundtrip_runs_on_any_database', RUN, "case \"$PGDATABASE\" in *disposable*) ;; *) echo \"ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')\"; exit 1;; esac", "true")
m('roundtrip_uses_a_copy_of_the_sql', RUN, 'P -f "$root/docs/report-snapshot.sql" >/dev/null 2>&1', 'P -f "$here/snapshot-copy.sql" >/dev/null 2>&1')


def run_tests():
    for t in TESTS:
        r = subprocess.run(['node', str(ROOT / t)], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            return False, t
    return True, None


def main():
    only = set(sys.argv[1:])
    unknown = only - set(M)
    if unknown:
        print('HARNESS — unknown mutation(s): ' + ', '.join(sorted(unknown)))
        return 2
    ok, which = run_tests()
    if not ok:
        print('HARNESS — the unmutated tree does not pass ' + which)
        return 2
    survived, harness = [], []
    names = [k for k in M if not only or k in only]
    for name in names:
        originals = {}
        try:
            applied = True
            for (file, old, new) in M[name]:
                p = ROOT / file
                originals.setdefault(file, p.read_text())
                text = p.read_text()
                if text.count(old) != 1:
                    print('HARNESS  %-38s anchor matched %d times in %s' % (name, text.count(old), file))
                    harness.append(name); applied = False; break
                p.write_text(text.replace(old, new))
            if not applied:
                continue
            passed, which = run_tests()
            if passed:
                print('SURVIVED %s' % name); survived.append(name)
            else:
                print('killed   %-38s by %s' % (name, which.split('/')[-1]))
        finally:
            for file, text in originals.items():
                (ROOT / file).write_text(text)
    ok, which = run_tests()
    if not ok:
        print('HARNESS — the tree does not pass after restoring: ' + which)
        return 2
    print('\n%d mutations, %d killed, %d survived, %d harness faults' % (len(names), len(names) - len(survived) - len(harness), len(survived), len(harness)))
    if survived:
        print('SURVIVORS: ' + ', '.join(survived))
    return 1 if (survived or harness) else 0


if __name__ == '__main__':
    sys.exit(main())
