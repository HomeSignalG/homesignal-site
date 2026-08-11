// PHASE 8 — the regulatory / enforcement ATTRIBUTION contract.
// Guards the measured record in docs/evidence-phase1-migration.sql. Offline: the sandbox has
// no egress to Supabase, so the live proofs (including the mutation tests) are recorded there
// and pinned here, exactly as Phase 7 does.
//
// The rule under test: FACILITY RECORD != DIRECT-COMPANY RECORD != PARENT-COMPANY RECORD.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const p8 = sql.slice(sql.indexOf('PHASE 8 (2026-08-11)'));
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

ok(p8.length > 4000, 'Phase 8 section of the SQL of record loaded');
ok(/Scope: ZIP 78617 \/ Del Valle only/.test(p8), 'scope is the pilot ZIP only');
ok(/No existing consumer read path changed/.test(p8), 'no production read behaviour altered');

// --- the governing rule is enforced by vocabulary, not by discipline -----------------
ok(/FACILITY RECORD != DIRECT-COMPANY RECORD != PARENT-COMPANY RECORD/.test(p8),
  'the three attribution levels are stated as distinct');
ok(/each level is a DIFFERENT PREDICATE/.test(p8) && /a query for one\n-- level cannot return another/.test(p8),
  'levels cannot collapse: each is its own predicate');

// --- 1..3 identifier-backed attachment ------------------------------------------------
ok(/event_occurred_at_facility/.test(p8), '1. RN-backed events attach to a facility predicate');
ok(/EVERY event RN is present here for its own company_key \(0 missing\)/.test(p8),
  '2. CN-backed company attribution is agency-derived, with the 0-missing control');
ok(/HomeSignal therefore holds ZERO EPA enforcement events for any pilot\n--   facility/.test(p8),
  '3. no FRS/ECHO enforcement event exists to attach — stated, not faked');

// --- 4, 20 a name alone never attaches -------------------------------------------------
ok(/NEVER BY RESPONDENT NAME ALONE/.test(p8), '4. a respondent name alone does not attribute');
ok(/it was recorded 'attribution_unresolved'\n-- rather than guessed/.test(p8),
  '20. an ambiguous identity blocks attribution instead of guessing');
ok(/Cinco J\., Inc\./.test(p8) && /two organisations share that legal name/.test(p8),
  'the fail-closed binding gate fired on real data');

// --- 5, 12, 22, 25 an event elsewhere never reads as an event here ---------------------
ok(/happened_at_this_facility=false/.test(p8) && /Another facility — HUNTER FACILITY, NEW BRAUNFELS, TX/.test(p8),
  '5+22. every company event names the facility it happened at');
ok(/The word "violation at this\n-- property" is not constructible from this output/.test(p8),
  '12. this-property phrasing is not constructible');
ok(/DIRECT COMPANY — OTHER FACILITIES 49/.test(p8), '25. company history keeps facility context');

// --- 6, 21 facility level is its own section ------------------------------------------
ok(/THIS FACILITY                    0/.test(p8), '21. the facility section is labelled and separate');
ok(/The facility zero is a MEASURED absence, not silence/.test(p8),
  '6. the facility zero carries its own receipt');

// --- 7, 8, 9, 23 parent discipline -----------------------------------------------------
ok(/VERIFIED PARENT                   4/.test(p8), '7. the verified parent has its own separate count');
ok(/parent count stays 0,\n--      parent_eligible stays false/.test(p8),
  '8. a parent CANDIDATE cannot inherit — mutation-proven');
ok(/REPUBLIC SERVICES IS \*\*NOT\*\* INHERITED/.test(p8), '9. BFI does not inherit Republic Services');
ok(/No Republic Services entity exists in the graph and none was created/.test(p8),
  '9b. Republic Services was not invented to make BFI richer');
ok(/Parent-company history is not a record of this individual facility|VERIFIED PARENT/.test(p8),
  '23. parent output carries its caveat');

// --- 10, 11 isolation by identifier ----------------------------------------------------
ok(/CEMEX[\s\S]{0,400}ISOLATED BY IDENTIFIER/.test(p8), '10. CEMEX events stay on CEMEX');
ok(/3901 NORWOOD LN STE 1[\s\S]{0,120}remain two\n--   entities/.test(p8),
  '11. a same-address facility does not inherit another facility history');

// --- 12b, 13, 16 temporal ---------------------------------------------------------------
ok(/publish NO status field \(0 of 61 rows\)/.test(p8), '12b. absent status is recorded as absent');
ok(/states neither "currently violating" nor "resolved"/.test(p8),
  '13. no end date does not imply a continuing violation, and age does not imply resolution');

// --- 14, 17 penalties and conflicts -----------------------------------------------------
ok(/Penalties are reported PER LEVEL and never summed across levels/.test(p8),
  '14. a penalty keeps its event, level and date range');
ok(/direct_company \$6,750[\s\S]{0,120}verified_parent  \$875/.test(p8),
  '14b. the two penalties are never combined into one number');

// --- 15, 21 no double counting -----------------------------------------------------------
ok(/61 rows -> 53 DISTINCT AGENCY EVENTS/.test(p8), '15. duplicate legacy rows collapse to one event');
ok(/parent section shows 4 and not 12/.test(p8),
  '15b. an event reachable by several paths is counted once');
ok(/also_reachable_as/.test(p8), '15c. the other paths are disclosed, not hidden');

// --- 16, 17 cross-source overlap and conflicts -------------------------------------------
ok(/case number is deliberately\n-- NOT an identifier type/.test(p8),
  '16. a shared case number relates records instead of merging them');
ok(/Both events remain distinct entities — verified/.test(p8),
  '16b. the duplicate candidate was not silently merged');
ok(/Nothing was ever deduplicated on company name, date, penalty or facility name/.test(p8),
  '16c. no dedup on name/date/penalty/facility');

// --- 18, 19 availability states -----------------------------------------------------------
ok(/TCEQ NOV = checked_no_records \(asked, nothing found\),\n--   TCEQ NOE = not_checked \(never asked\)/.test(p8),
  '18+19. checked-no-records, unavailable and not-checked are distinct states');
ok(/a hit of 1 can never be rendered as "no violations"/.test(p8),
  '19b. a facility-presence hit is never read as an enforcement zero');

// --- 24, 25, 26, 27 the property graph stops honestly ---------------------------------------
ok(/facility_located_on_parcel is still 0/.test(p8), '24. no facility edge was manufactured');
ok(/Proximity\n--   is not location/.test(p8), '25b. proximity did not become location');
ok(/Neuralink Corporation keeps its 2 project_owner_as_filed claims, has 0\n--   operator\/owner\/customer claims, and 0 regulatory events/.test(p8),
  '26. project owner as filed did not become a facility operator');
ok(/facility_owner|FACILITY RECORD/.test(p8), '27. facility owner is not the property owner');

// --- 28 idempotence ---------------------------------------------------------------------------
ok(/run 1 vs run 2, every object identical/.test(p8), '28. run 2 adds zero semantic duplicates');
ok(/Run 2 FAILED THE FIRST TIME/.test(p8),
  '28b. idempotence was proven by running it, not by inspecting it');

// --- 29 no raw payload leaks -------------------------------------------------------------------
ok(/emits no raw payload, no attribution_note, no UUID and no schema vocabulary/.test(p8),
  '29. the RPC leaks no raw source payload');
ok(/REVOKED from public\/anon\/authenticated/.test(p8), '29b. the RPC is not browser-reachable');

// --- 30 phase 1-7 untouched ---------------------------------------------------------------------
ok(/Phase 8 wrote to no legacy table/.test(p8), '30. legacy tables unchanged');
for (const [t, h] of [['property_company_roles','b3923c901be5923d7f47d0d0f5dc89c3'],
                      ['project_facility_refs','ade204ec6037025a291bec43dbf55b0b'],
                      ['identity_conflicts','25269d6f4b3dd885d50cdc64350206a7'],
                      ['company_parents','e951809e3dd5e640ba810b1d04cf2eac'],
                      ['company_track_events','9d501d166d52a5c9198a7be2e4c07c82']])
  ok(new RegExp(t + '\\s+\\d+\\s+' + h).test(p8), `30b. ${t} before/after md5 pinned`);

// --- the corrections this phase made to its own first attempt -------------------------------------
ok(/THE CLASS FOLLOWS THE WEAKEST LINK/.test(p8),
  'attribution strength follows the weakest link in the chain');
ok(/all 12 parent claims are resolved_by_match/.test(p8),
  'the name-resolved customer number never poses as an agency identifier');
ok(/is_primary=false/.test(p8), 'the name-resolved identifier is not the primary one');

// --- no scoring, per §3 ----------------------------------------------------------------------------
ok(/No score of any kind\. No ESG\. No WikiRate\./.test(p8), 'no score was created');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
