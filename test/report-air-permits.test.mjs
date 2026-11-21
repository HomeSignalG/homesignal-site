// Report path for air permits: fixture-only (labelled). Run: node test/report-air-permits.test.mjs
import { airPermitsSection, readAirPermitsNear, AIR_STATUS_SCOPE } from '../supabase/functions/_shared/report-air-permits.ts';
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) bad++; };
const SRC = (status) => ({ source: 'tx_tceq_nsr', state: 'TX', agency: 'TCEQ', status });
const REC = { permit_no: '185303', project_no: '414660', status: 'PENDING', action_kind: 'registration' }; // FIXTURE, not evidence
ok(airPermitsSection(null).outcome === 'read_failed' && /does not mean there are none/.test(airPermitsSection(null).limitations[0]), 'R1 failed read is "could not check", never none');
ok(airPermitsSection({ status: 'complete', sources: [SRC('blocked')], records: [] }, { zip_state: 'TX' }).outcome === 'not_established', 'R2 blocked source with no records is not "none"');
ok(airPermitsSection({ status: 'complete', sources: [SRC('unavailable')], records: [] }, { zip_state: 'TX' }).outcome === 'not_established', 'R3 stale source with no records is not "none"');
ok(airPermitsSection({ status: 'complete', sources: [], records: [] }, { zip_state: 'TX' }).outcome === 'not_established', 'R4 uncovered state is not "none"');
ok(airPermitsSection({ status: 'complete', sources: [SRC('complete')], records: [] }, { zip_state: 'TX' }).outcome === 'none_found_in_complete_source', 'R5 only a complete source may report none');
const s = airPermitsSection({ status: 'complete', sources: [SRC('complete')], records: [REC, { ...REC, permit_no: '2', action_kind: 'renewal' }] }, { zip_state: 'TX' });
ok(s.counts.new_filings === 1 && s.counts.renewals_or_changes === 1, 'R6 renewals are not new filings');
ok(s.records.every((r) => r.status_scope === AIR_STATUS_SCOPE) && s.records[0].status === 'PENDING', 'R7 agency status carried unchanged with its scope');
ok(s.limitations.some((l) => /no mapped location/.test(l) && /how many exist/.test(l)), 'R8 with no county count, the no-location limitation is still stated');
const u1 = airPermitsSection({ status: 'complete', sources: [SRC('complete')], records: [], unlocated_in_county: 1, unlocated_county: 'Cameron' }, { zip_state: 'TX' });
ok(u1.limitations.includes('1 air permit in Cameron County has no mapped location, so it could not be tested against this distance and is not listed.') && u1.outcome === 'none_found_in_complete_source', 'R11 a no-location permit is disclosed by county; it is never silently dropped');
ok(!airPermitsSection({ status: 'complete', sources: [SRC('complete')], records: [], unlocated_in_county: 0, unlocated_county: 'Cameron' }, { zip_state: 'TX' }).limitations.some((l) => /no mapped location/.test(l)), 'R12 a zero count adds no disclosure');
const mm = airPermitsSection({ status: 'complete', sources: [SRC('complete')], records: [{ ...REC, record_id: 'x' }], matches: { x: { matched_by: 'footprint', distance_mi: 0.12 } } }, { zip_state: 'TX' });
ok(mm.records[0].location_match.matched_by === 'footprint', 'R13 how a record matched (footprint or point) is carried to the report');
let threw = false; try { await readAirPermitsNear({ base: 'http://x', svc: {} }, async () => new Response('{}', { status: 200 }), 1, 1, 0.5); } catch { threw = true; }
ok(threw, 'R9 an oddly shaped answer is DataUnavailable');
let call; await readAirPermitsNear({ base: 'http://x', svc: {} }, async (u, o) => { call = [u, JSON.parse(o.body)]; return new Response(JSON.stringify({ sources: [], records: [] })); }, 29.37, -100.9, 0.5, { state: 'TX', county: 'Cameron' });
ok(/map1_air_permits_near$/.test(call[0]) && call[1].p_radius_mi === 0.5 && call[1].p_state === 'TX' && call[1].p_county === 'Cameron', 'R10 reader calls the circle function with the report radius');
if (bad) { console.log(bad + ' FAILURE(S)'); process.exit(1); } console.log('report-air-permits: all checks pass');
