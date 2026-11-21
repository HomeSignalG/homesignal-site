// Offline checks of the probe's own guarantees (no network). Run: node test/tceq-air-feasibility-probe.test.mjs
import { readFileSync } from 'node:fs';
import { parseRobots, robotsVerdict, MAX_REQUESTS, SPACING_MS, SEEDS, ROBOTS_HOSTS, UA } from '../scripts/tceq-air-feasibility-probe.mjs';
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) bad++; };
const g = parseRobots('User-agent: *\nDisallow: /\nAllow: /public/\n');
ok(!robotsVerdict(g, '/airperm/x').allowed && robotsVerdict(g, '/public/a').allowed, 'P1 Disallow: / blocks, a longer Allow wins');
ok(robotsVerdict(parseRobots('User-agent: *\nDisallow:\n'), '/x').allowed, 'P2 an empty Disallow allows');
ok(robotsVerdict(parseRobots('User-agent: other\nDisallow: /\n'), '/x').allowed, 'P3 a rule for another agent does not apply');
ok(MAX_REQUESTS <= 25 && SPACING_MS >= 5000, 'P4 request cap and spacing are the approved ones');
ok(SEEDS.every((u) => { const h = new URL(u).host; return ROBOTS_HOSTS.includes(h) && u.startsWith('https://'); }), 'P5 every seed host is robots-checked and https');
const src = readFileSync(new URL('../scripts/tceq-air-feasibility-probe.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
ok(!/method:\s*'POST'|method:\s*"POST"|FormData|\.submit\(|setHeader\('User-Agent'|spoof/i.test(src) && /method: 'GET'/.test(src), 'P6 GET only: no POST, no form submission');
ok(UA.startsWith('HomeSignal-source-feasibility') && !/Mozilla|Chrome/.test(UA) && (src.match(/'User-Agent'/g) || []).length === 1, 'P7 one honest fixed User-Agent, never a browser identity');
ok(/r\.status === 403 \|\| r\.status === 429/.test(src) && /stopped = true/.test(src), 'P8 the run stops at the first 403/429');
ok(/robotsVerdict\(g, u\.pathname/.test(src) && /RESTRICTED/.test(src), 'P9 every non-robots URL is checked against robots first and a Disallow is recorded RESTRICTED, not fetched');
if (bad) { console.log(bad + ' FAILURE(S)'); process.exit(1); } console.log('tceq probe: all checks pass');
