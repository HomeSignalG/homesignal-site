// C7 — THE SHARED DERIVED-POINT VERDICT REJECTS A CONTRADICTED STREET DIRECTION AND A MISSING HOUSE NUMBER.
// The structural half; the executable half is test/dc_verdict_pg/offline.sh (gate + apply on a stand-in).
//
// Why: 3 Atlas pins were WITHHELD from Map 1 on a geocode of the wrong street (5500 W County Rd 200 S matched
// as 5500 E ..., 17.9 km away; 300 S Fish Lake Rd matched as 300 N; '31st Avenue East' read as house no. 31),
// and 5 pins carried a CORROBORATED flag earned from the opposite side of the road. One rule, in the ONE
// verdict every source uses; no source is named. Each pin below has a positive control.
// Run: node test/dc-verdict-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const D3 = stripSql(read('docs/dc-step3d-derived-location.sql'));
const verdict = (D3.match(/create or replace function public\.dc_derived_point_verdict\([\s\S]*?\$fn\$;/) || [''])[0];
ok(verdict.length > 1000 && /REJECTED_MATCH_DIVERGES/.test(verdict), '0: the verdict is located (positive control)');

// ── the rule ─────────────────────────────────────────────────────────────────────────────────────
ok(/q_no text := substring\(coalesce\(p_query, ''\) from '\^\(\\d\+\)\[A-Za-z\]\?\\s'\);/.test(verdict)
   && /m_no text := substring\(coalesce\(p_matched, ''\) from '\^\(\\d\+\)\[A-Za-z\]\?\\s'\);/.test(verdict),
  'R1: a house number is digits, one optional letter, then a SPACE, on both sides ("31st Avenue" carries none)');
ok(/q_dir text := upper\(left\(substring\(coalesce\(p_query, ''\) from '\(\?i\)\^\\d\+\[A-Za-z\]\?\\s\+\(north\|south\|east\|west\|n\|s\|e\|w\)\\M'\), 1\)\);/.test(verdict)
   && /m_dir text := upper\(left\(substring\(coalesce\(p_matched, ''\)/.test(verdict),
  'R2: the leading street direction is read from both the query and the match, as a compass letter');
const dirBranch = verdict.indexOf('elsif q_dir is not null and m_dir is not null and q_dir <> m_dir then');
const noBranch = verdict.indexOf('elsif q_no is null or m_no is null or q_no <> m_no then');
const stBranch = verdict.indexOf('elsif q_st is not null and m_st is not null and q_st <> m_st then');
ok(dirBranch > 0 && noBranch > 0 && stBranch > 0 && noBranch < dirBranch && dirBranch < stBranch
   && /q_dir <> m_dir then\s+return query select 'REJECTED_MATCH_DIVERGES'::text, null::double precision,/.test(verdict),
  'R3: a contradicted direction is REJECTED_MATCH_DIVERGES, after the house-number check and before the state check');
ok(!/q_dir is null|m_dir is null|q_dir is distinct from/.test(verdict),
  'R4: a direction present on ONE side only is never a rejection (3043 Black Horse Pike -> S BLACK HORSE PIKE stays accepted)');
ok(!/'(epoch_ai|compute_atlas|openstreetmap)'/.test(verdict) && !/\bST_/.test(verdict),
  'R5: the verdict names no source and does no distance math: one rule for every publisher');

// ── generated, gated, reversible ─────────────────────────────────────────────────────────────────
let check = '';
try { check = execFileSync('python3', [join(ROOT, 'test/dc_verdict_pg/build_verdict.py'), '--check'], { encoding: 'utf8' }); } catch (e) { check = String(e.stdout || e); }
ok(/C7 apply \+ rollback files are current/.test(check), 'G1: docs/dc-verdict-apply.sql and -rollback.sql are what the builder emits from the DDL of record', check.trim());
const APPLY = read('docs/dc-verdict-apply.sql');
ok((APPLY.match(/create or replace function/g) || []).length === 1 && /^begin;$/m.test(APPLY) && /^commit;$/m.test(APPLY)
   && /DRIFT: production is not the pre-C7 state/.test(APPLY) && /POST-CONDITION failed:%\. Rolled back\./.test(APPLY)
   && /'4cd5b97def7d6179900cd95ec452d9a7'/.test(APPLY),
  'G2: the apply is one transaction defining ONLY the verdict, guarded on the pre-C7 fingerprint, with a post-condition');
const SH = read('scripts/dc-verdict-apply.sh');
const sha = (f) => execFileSync('sha256sum', [join(ROOT, f)], { encoding: 'utf8' }).split(' ')[0];
ok(SH.includes('EXPECTED_SHA256=' + sha('docs/dc-verdict-apply.sql')) && SH.includes('EXPECTED_SHA256=' + sha('docs/dc-verdict-rollback.sql')),
  'G3: the apply script pins the sha256 of BOTH committed artifacts');
ok(/\[ "\$min" -ge 18 \] && \[ "\$min" -le 45 \]/.test(SH) && /REFUSED: inside the :25\/:35 resolver window/.test(SH),
  'G4: the apply refuses the :25/:35 resolver window');
const WF = read('.github/workflows/dc-verdict-apply.yml');
ok(/apply:\n    needs: \[offline, gate\]/.test(WF) && /inputs\.confirm == 'APPLY-VERDICT-C7'/.test(WF)
   && /inputs\.confirm == 'ROLLBACK-VERDICT-C7'/.test(WF) && /github\.ref == 'refs\/heads\/main'/.test(WF),
  'G5: production apply needs the offline proof AND the gate in the same run, from main, with the typed confirmation');
const GATE = read('docs/dc-verdict-gate.sql');
const gates = GATE.match(/^select 'G\d\d_[A-Z0-9_]+'/gm) || [];
ok(gates.length === 12 && /\[ "\$n_g" = 12 \]/.test(read('scripts/dc-verdict-gate.sh')),
  'G6: the gate runs 12 checks and the script refuses unless all 12 ran', String(gates.length));
ok(!/dc_derived_point_verdict\(|q_dir|m_dir/.test(GATE.split('create temp table _pred as')[1].split('create temp table _ent')[0])
   && /split_part\(btrim\(geocoder_query\), ' ', 1\)/.test(GATE),
  'G7: the gate\'s prediction is worded independently (tokens), never by calling the verdict it checks');
ok(existsSync(join(ROOT, 'test/dc_verdict_pg/offline.sh')) && /run: bash test\/dc_verdict_pg\/offline\.sh/.test(WF),
  'G8: the offline proof exists and runs on every pull request touching the verdict');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
