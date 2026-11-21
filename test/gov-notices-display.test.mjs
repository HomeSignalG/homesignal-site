// Government notices on the ZIP page: what is listed and in what order.
// Run: node test/gov-notices-display.test.mjs
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const held = reg.county_cases.flatMap((e) => (e.hold_cases || []).map((h) => h.case_id.toLowerCase()));
const js = readFileSync(join(root, 'lib/community-page.js'), 'utf8');
const m = js.match(/var GN_HELD_CASES = (\[[^\]]*\]);/);
ok(held.length > 0, 'the registry holds at least one case (control)');
ok(!!m && JSON.stringify(JSON.parse(m[1])) === JSON.stringify(held), 'the hydrated page holds exactly the registry hold_cases');
ok(/gnMtgKeys\[\(x\.source_ref\|\|''\) \+ '\|' \+ gnTitleKey\(x\.title\)\]/.test(js), 'hydrated dedupe needs the same link AND the same title');
ok(/data-gn-all/.test(js), 'hydrated page lists every remaining notice under Show all');

const py = `
import sys; sys.path.insert(0,'scripts')
import gen_zip_pages as g
um=[{"title":"Board Meeting","url":"https://x/event/1/overview"}]
gn=[{"title":"Board Meeting","url":"https://x/event/1/overview","date":"2026-12-02"},
    {"title":"Board Meeting","url":"https://generic/","date":"2026-12-03"},
    {"title":"Hearing B","url":"https://generic/","date":"2027-02-17"},
    {"title":"Subdivision — 851-25-000549-PLNG","url":"https://t/1139/x","date":"2025-12-09"},
    {"title":"Conditional Use — 851-26-000190-PLNG","url":"https://t/2612","date":"2026-10-13"}]+[{"title":"Old %d"%i,"url":"u%d"%i,"date":"2026-0%d-01"%(1+i%9)} for i in range(12)]
s,r=g.gn_for_display(gn,um,"2026-11-20")
al=s+r
print(int(sum(1 for x in al if x["url"]=="https://x/event/1/overview")==0), int(not any("000549" in x["title"] for x in al)),
      int(s[0]["url"]=="https://generic/"), int(any(x["title"]=="Hearing B" for x in r)), int(len(s)==10), int(len(al)==len(gn)-2),
      int("Show all" in g._items(s,"Government notices","e","gn",rest=r)))
only=g.gn_for_display([{"title":"Far","url":"f","date":"2027-06-01"}],[],"2026-11-20")
print(int(len(only[0])==1))
`;
const r = spawnSync('python3', ['-c', py], { cwd: root, encoding: 'utf8' });
const lines = (r.stdout || '').trim().split('\n');
ok(r.status === 0, 'generator helper runs' + (r.stderr ? ': ' + r.stderr.slice(-200) : ''));
const names = ['same link and title as a listed meeting is dropped', 'held case is dropped', 'a distinct notice sharing a generic link stays and the soonest-in-30-days leads', 'far future hearing is still reachable', 'at most 10 shown', 'only the dropped ones are missing', 'Show all control appears'];
(lines[0] || '').split(' ').forEach((v, i) => ok(v === '1', names[i]));
ok((lines[1] || '') === '1', 'only far-future notices are still listed, never "none on file"');
if (fails) { console.error(fails + ' FAILURE(S)'); process.exit(1); }
