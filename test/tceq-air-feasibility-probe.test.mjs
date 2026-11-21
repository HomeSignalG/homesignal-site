// Offline checks of the probe's own guarantees (no network; fetch is injected). Run: node test/tceq-air-feasibility-probe.test.mjs
import { readFileSync } from 'node:fs';
import { parseRobots, robotsVerdict, makeProbe, MAX_REQUESTS, SPACING_MS, SEEDS, ROBOTS_HOSTS, UA } from '../.github/probes/tceq-air-feasibility-probe.mjs';
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) bad++; };
const g = parseRobots('User-agent: *\nDisallow: /\nAllow: /public/\n');
ok(!robotsVerdict(g, '/airperm/x').allowed && robotsVerdict(g, '/public/a').allowed, 'P1 Disallow: / blocks, a longer Allow wins');
ok(robotsVerdict(parseRobots('User-agent: *\nDisallow:\n'), '/x').allowed, 'P2 an empty Disallow allows');
ok(robotsVerdict(parseRobots('User-agent: other\nDisallow: /\n'), '/x').allowed, 'P3 a rule for another agent does not apply');
ok(MAX_REQUESTS === 25 && SPACING_MS >= 5000, 'P4 the approved cap and spacing');
ok(SEEDS.every((u) => ROBOTS_HOSTS.includes(new URL(u).host) && u.startsWith('https://')), 'P5 every seed host is robots-checked and https');
ok(parseRobots('<html><body>Not found</body></html>') === null && parseRobots('') === null && parseRobots('hello world') === null, 'P6 an HTML page, empty text or text with no User-agent is unparseable');
const src = readFileSync(new URL('../.github/probes/tceq-air-feasibility-probe.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
ok(!/method:\s*'POST'|FormData|\.submit\(|spoof/i.test(src) && /method: 'GET'/.test(src) && /redirect: 'manual'/.test(src), 'P7 GET only, never POST/form, redirects are handled by hand');
ok(UA.startsWith('HomeSignal-source-feasibility') && !/Mozilla|Chrome/.test(UA) && (src.match(/'User-Agent'/g) || []).length === 1, 'P8 one honest fixed User-Agent');

// ---- behaviour with an injected fetch ----
const R = (body, status = 200, headers = {}) => new Response(body, { status, headers });
const OPEN = 'User-agent: *\nDisallow:\n', CLOSED = 'User-agent: *\nDisallow: /\n';
const base = (robotsBy, pages) => (url) => {
  const u = new URL(url); const call = { url };
  if (u.pathname === '/robots.txt') { const r = robotsBy[u.host]; return Promise.resolve(r instanceof Response ? r : R(r ?? '', r === undefined ? 404 : 200)); }
  const p = pages[url]; return Promise.resolve(p ? (typeof p === 'function' ? p() : p) : R('nope', 404));
};
const T = { spacingMs: 0 };
{ // www2 restricted by Disallow: /  — nothing is requested from it, no way around it
  const seen = []; const f = (u) => { seen.push(u); return base({ 'www.tceq.texas.gov': OPEN, 'www2.tceq.texas.gov': CLOSED, 'records.tceq.texas.gov': OPEN, 'data.texas.gov': OPEN, 'api.us.socrata.com': OPEN }, {
    'https://www.tceq.texas.gov/permitting/air': R('<title>Air</title><a href="https://www2.tceq.texas.gov/airperm/x">NSR permit status</a>', 200, { 'content-type': 'text/html' }) })(u); };
  const out = await makeProbe({ ...T, fetchImpl: f, seeds: ['https://www.tceq.texas.gov/permitting/air'] }).run();
  ok(out.log.some((r) => r.url.includes('www2.tceq') && r.status === 'RESTRICTED' && /Disallow: \//.test(r.restriction)) && !seen.some((u) => u.includes('www2.tceq.texas.gov/airperm')), 'B1 a Disallow: / host (www2) is recorded RESTRICTED and never requested');
}
{ // unreachable and unparseable robots => RESTRICTED host
  const f = base({ 'www.tceq.texas.gov': R('', 500), 'records.tceq.texas.gov': R('<html>oops</html>'), 'data.texas.gov': OPEN, 'api.us.socrata.com': OPEN, 'www2.tceq.texas.gov': CLOSED }, {});
  const seen = []; const out = await makeProbe({ ...T, fetchImpl: (u) => { seen.push(u); return f(u); }, seeds: ['https://www.tceq.texas.gov/permitting/air', 'https://records.tceq.texas.gov/cs/idcplg?x=1'] }).run();
  ok(out.hosts_restricted.includes('www.tceq.texas.gov') && out.hosts_restricted.includes('records.tceq.texas.gov') && !seen.some((u) => !u.endsWith('/robots.txt')), 'B2 unreachable (500) or unparseable (HTML) robots.txt restricts the host: nothing fetched from it');
}
{ // 404 robots also counts as unreachable
  const out = await makeProbe({ ...T, fetchImpl: base({}, {}), seeds: ['https://www.tceq.texas.gov/permitting/air'] }).run();
  ok(out.log.filter((r) => r.kind === 'seed').every((r) => r.status === 'RESTRICTED'), 'B3 a 404 robots.txt is treated as unreachable: the host is RESTRICTED');
}
{ // redirect target is robots-checked BEFORE it is followed; hops count toward the cap
  const seen = []; const f = (u) => { seen.push(u); return base({ 'www.tceq.texas.gov': OPEN, 'records.tceq.texas.gov': CLOSED, 'www2.tceq.texas.gov': OPEN, 'data.texas.gov': OPEN, 'api.us.socrata.com': OPEN },
    { 'https://www.tceq.texas.gov/permitting/air': R('', 302, { location: 'https://records.tceq.texas.gov/cs/secret' }) })(u); };
  const p = makeProbe({ ...T, fetchImpl: f, seeds: ['https://www.tceq.texas.gov/permitting/air'] }); const out = await p.run();
  ok(out.log.some((r) => r.status === 302 && r.redirect_to) && out.log.some((r) => r.url === 'https://records.tceq.texas.gov/cs/secret' && r.status === 'RESTRICTED') && !seen.includes('https://records.tceq.texas.gov/cs/secret'), 'B4 a redirect target disallowed by its own robots is not followed');
  ok(out.requests_used === seen.length, 'B5 every request, robots and redirect hop included, is counted: used = requests made (' + out.requests_used + ')');
}
{ // redirect to an unlisted host is not followed
  const seen = []; const f = (u) => { seen.push(u); return base({ 'www.tceq.texas.gov': OPEN, 'records.tceq.texas.gov': OPEN, 'www2.tceq.texas.gov': OPEN, 'data.texas.gov': OPEN, 'api.us.socrata.com': OPEN }, { 'https://www.tceq.texas.gov/permitting/air': R('', 301, { location: 'https://elsewhere.example/x' }) })(u); };
  const out = await makeProbe({ ...T, fetchImpl: f, seeds: ['https://www.tceq.texas.gov/permitting/air'] }).run();
  ok(!seen.some((u) => u.includes('elsewhere.example')) && out.log.some((r) => r.status === 'NOT_FOLLOWED'), 'B6 a redirect to a host outside the approved list is not followed');
}
{ // cap: retries and hops count; the run never exceeds 25
  let n = 0; const f = (u) => { n++; return base({ 'www.tceq.texas.gov': OPEN, 'records.tceq.texas.gov': OPEN, 'www2.tceq.texas.gov': OPEN, 'data.texas.gov': OPEN, 'api.us.socrata.com': OPEN },
    Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['https://www.tceq.texas.gov/s' + i, R('', 503)])))(u); };
  const out = await makeProbe({ ...T, fetchImpl: f, seeds: Array.from({ length: 40 }, (_, i) => 'https://www.tceq.texas.gov/s' + i) }).run();
  ok(n <= 25 && out.requests_used <= 25, 'B7 5xx retries count toward the 25-request cap (made ' + n + ')');
}
{ // 403 stops the run
  let n = 0; const f = (u) => { n++; return base({ 'www.tceq.texas.gov': OPEN, 'records.tceq.texas.gov': OPEN, 'www2.tceq.texas.gov': OPEN, 'data.texas.gov': OPEN, 'api.us.socrata.com': OPEN }, { 'https://www.tceq.texas.gov/a': R('x', 403) })(u); };
  const out = await makeProbe({ ...T, fetchImpl: f, seeds: ['https://www.tceq.texas.gov/a', 'https://www.tceq.texas.gov/b'] }).run();
  ok(out.stopped_on_refusal && !out.log.some((r) => r.url === 'https://www.tceq.texas.gov/b' && typeof r.status === 'number'), 'B8 the first 403 stops the run and nothing further is requested');
}
if (bad) { console.log(bad + ' FAILURE(S)'); process.exit(1); } console.log('tceq probe: all checks pass');
