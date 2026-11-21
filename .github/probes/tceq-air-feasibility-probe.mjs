// TCEQ AIR-PERMIT SOURCE FEASIBILITY PROBE — READ-ONLY. Approved plan: GET only, 25 requests total, 5 s apart.
// Rules enforced HERE, not by convention:
//   * GET only: never a POST or a form submission. One request at a time, >= SPACING_MS apart.
//   * MAX_REQUESTS counts EVERY HTTP request: robots files, each redirect hop, and each retry.
//   * Every non-robots URL — including each redirect TARGET before it is followed — is checked against that host's robots.txt first.
//     A Disallow match records RESTRICTED and the URL is not requested.
//   * A host whose robots.txt is unreachable (any non-200, network error, redirect) or cannot be parsed is RESTRICTED: nothing is fetched from it.
//   * Honest fixed User-Agent (UA). Never changed, rotated or spoofed. No credentials or cookies.
//   * Stop the whole run at the first 403 or 429 (recorded as an access refusal, never retried). One retry on 5xx only (counts toward the cap).
//   * A redirect to a host outside ROBOTS_HOSTS is not followed (recorded as not followed).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const UA = 'HomeSignal-source-feasibility/1.0 (+https://jodytracks.com; read-only; contact via site)';
export const MAX_REQUESTS = 25, SPACING_MS = 5000, MAX_LINKS = 6, MAX_BYTES = 8_000_000, MAX_HOPS = 3;
export const ROBOTS_HOSTS = ['www.tceq.texas.gov', 'www2.tceq.texas.gov', 'records.tceq.texas.gov', 'data.texas.gov', 'api.us.socrata.com'];
const DOC = (id) => 'https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=' + id + '&searchType=External';
export const SEEDS = [
  'https://www.tceq.texas.gov/permitting/air',
  'https://api.us.socrata.com/api/catalog/v1?domains=data.texas.gov&q=air%20permit&limit=20',
  DOC('10258370'), DOC('10258371'),
  'https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH',
];
const LINK_WORDS = /(open[ -]?data|bulk|download|data ?set|data ?portal|terms|use policy|permit status|nsr|new source review|air permits? (data|search|status)|public notice|rss|feed|api)/i;

/** Returns groups, or null when the text is not a recognisable robots.txt (HTML page, empty, no User-agent line). */
export function parseRobots(text) {
  const s = String(text);
  if (/^\s*</.test(s)) return null;
  const groups = []; let cur = null;
  for (const raw of s.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if ((k === 'disallow' || k === 'allow') && cur) cur.rules.push({ allow: k === 'allow', path: v });
  }
  return groups.length ? groups : null;
}
export function robotsVerdict(groups, path) {
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && UA.toLowerCase().includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const g of use) for (const r of g.rules) {
    if (r.path === '') continue;
    const pat = '^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (new RegExp(pat).test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best && !best.allow ? { allowed: false, rule: 'Disallow: ' + best.path } : { allowed: true, rule: best ? 'Allow: ' + best.path : 'no matching rule' };
}

/** One probe run. `opts.fetchImpl` and `opts.spacingMs` exist so the rules can be tested offline; production uses fetch and SPACING_MS. */
export function makeProbe(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch, spacing = opts.spacingMs ?? SPACING_MS, seeds = opts.seeds || SEEDS, hosts = opts.hosts || ROBOTS_HOSTS;
  const log = []; let used = 0, stopped = false, last = 0; const robots = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function req(url, kind) { // ONE counted request; no redirect following here
    if (stopped) return { skipped: 'run stopped after a 403/429' };
    if (used >= MAX_REQUESTS) return { skipped: 'request cap reached' };
    const wait = last + spacing - Date.now(); if (used > 0 && wait > 0) await sleep(wait);
    used++; last = Date.now();
    let r; try { r = await fetchImpl(url, { method: 'GET', headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'manual' }); }
    catch (e) { return { row: { url, kind, status: 'NETWORK_ERROR', detail: String(e?.cause?.code || e.message) } }; }
    const buf = Buffer.from(await r.arrayBuffer()).subarray(0, MAX_BYTES);
    const row = { url, kind, status: r.status, content_type: r.headers.get('content-type') || '', bytes: buf.length };
    if (r.status === 403 || r.status === 429) { row.note = 'REFUSED — stop; not retried; recorded as an access refusal'; stopped = true; }
    return { row, buf, location: r.headers.get('location') };
  }
  async function robotsFor(host) { // returns groups or null (null => host RESTRICTED)
    if (host in robots) return robots[host];
    if (!hosts.includes(host)) return (robots[host] = null);
    const res = await req('https://' + host + '/robots.txt', 'robots');
    let groups = null;
    if (res.row) {
      if (res.row.status === 200 && res.buf) groups = parseRobots(res.buf.toString('utf8'));
      res.row.robots_result = groups ? 'parsed' : (res.row.status === 200 ? 'UNPARSEABLE -> host RESTRICTED' : 'unreachable (status ' + res.row.status + ') -> host RESTRICTED');
      log.push(res.row);
    }
    return (robots[host] = groups);
  }
  /** GET a URL following redirects by hand; every target is robots-checked first. */
  async function guarded(url, kind) {
    let cur = url;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const u = new URL(cur);
      if (u.protocol !== 'https:') { log.push({ url: cur, kind, status: 'NOT_FOLLOWED', note: 'non-https target' }); return null; }
      if (!hosts.includes(u.host)) { log.push({ url: cur, kind, status: 'NOT_FOLLOWED', note: 'host outside the approved list' }); return null; }
      const g = await robotsFor(u.host);
      if (!g) { log.push({ url: cur, kind, status: 'RESTRICTED', restriction: 'robots.txt unreachable or unparseable for ' + u.host, fetched: false }); return null; }
      const v = robotsVerdict(g, u.pathname + u.search);
      if (!v.allowed) { log.push({ url: cur, kind, status: 'RESTRICTED', restriction: 'robots.txt ' + v.rule, fetched: false }); return null; }
      let res = await req(cur, kind);
      if (res.row && typeof res.row.status === 'number' && res.row.status >= 500) { res.row.note = '5xx, one retry (counted)'; log.push(res.row); res = await req(cur, kind); }
      if (!res.row) { log.push({ url: cur, kind, status: 'SKIPPED', note: res.skipped }); return null; }
      res.row.robots = v.rule; log.push(res.row);
      if (res.row.status >= 300 && res.row.status < 400 && res.location) { res.row.redirect_to = res.location; cur = new URL(res.location, cur).href; kind = kind + ':redirect'; continue; }
      return res;
    }
    log.push({ url: cur, kind, status: 'NOT_FOLLOWED', note: 'too many redirects' }); return null;
  }
  async function run() {
    for (const h of hosts) await robotsFor(h);
    const found = [];
    for (const url of seeds) {
      const r = await guarded(url, 'seed'); if (!r?.buf) continue;
      const ct = r.row.content_type;
      if (/pdf/i.test(ct)) {
        const dir = mkdtempSync(join(tmpdir(), 'tceqpdf-')); const f = join(dir, 'd.pdf'); writeFileSync(f, r.buf);
        let text = ''; try { text = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8', maxBuffer: 20_000_000 }); } catch { r.row.pdf_text = 'pdftotext failed'; }
        r.row.has_185303 = /185303/.test(text); r.row.has_414660 = /414660/.test(text);
        r.row.lines = (text.match(/^.*(RN\s?\d{9}|County|Latitude|Longitude|Lat\/Long|UTM|Action|Registration|Standard Permit|NSR).*$/gim) || []).slice(0, 12).map((s) => s.trim().slice(0, 160));
      } else if (/html|json|xml|text/i.test(ct)) {
        const body = r.buf.toString('utf8'); r.row.title = (body.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim();
        if (/api\.us\.socrata/.test(url)) { try { const j = JSON.parse(body); r.row.catalog_results = (j.results || []).slice(0, 20).map((x) => x.resource?.name + ' | ' + x.resource?.type); r.row.catalog_total = j.resultSetSize; } catch { r.row.catalog_results = 'unparseable'; } }
        else for (const m of body.matchAll(/<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
          const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          let abs; try { abs = new URL(m[1], url); } catch { continue; }
          if (abs.protocol === 'https:' && hosts.includes(abs.host) && LINK_WORDS.test(text + ' ' + abs.pathname) && !found.includes(abs.href) && abs.href !== url) found.push(abs.href);
        }
      }
    }
    for (const url of found.slice(0, MAX_LINKS)) {
      const r = await guarded(url, 'followed-link');
      if (r?.row && r.buf && /html|text/i.test(r.row.content_type)) r.row.title = (r.buf.toString('utf8').match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim();
      if (stopped) break;
    }
    return { ua: UA, requests_used: used, cap: MAX_REQUESTS, stopped_on_refusal: stopped, hosts_restricted: Object.keys(robots).filter((h) => !robots[h]), links_discovered: found.length, log };
  }
  return { run, log, get used() { return used; } };
}
if (process.argv[1] && process.argv[1].endsWith('tceq-air-feasibility-probe.mjs')) {
  const out = await makeProbe().run();
  console.log('----- BEGIN RESULT -----'); console.log(JSON.stringify(out, null, 1)); console.log('----- END RESULT -----');
}
