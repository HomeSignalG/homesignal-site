// TCEQ AIR-PERMIT SOURCE FEASIBILITY PROBE — READ-ONLY, PREPARED, NOT RUN. Plan and approval: docs/air-permits-review-package-2026-11-21.md §1a.
// Hard rules enforced HERE, not by convention:
//   * GET only, never a POST or a form submission. One request at a time, >= SPACING_MS apart. At most MAX_REQUESTS in all (robots fetches count).
//   * Every non-robots URL is checked against that host's robots.txt BEFORE it is requested. A Disallow match records RESTRICTED and the URL is not fetched.
//   * Honest, fixed User-Agent (UA below). It is never changed, rotated or spoofed.
//   * Stop the whole run at the first 403 or 429 (recorded as a technical/automated-access refusal, not retried). One retry on 5xx only.
//   * No credentials, cookies or secrets. Output is a log only; it writes no repository or database state.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const UA = 'HomeSignal-source-feasibility/1.0 (+https://jodytracks.com; read-only; contact via site)';
export const MAX_REQUESTS = 25, SPACING_MS = 5000, MAX_LINKS = 6, MAX_BYTES = 8_000_000;
export const ROBOTS_HOSTS = ['www.tceq.texas.gov', 'www2.tceq.texas.gov', 'records.tceq.texas.gov', 'data.texas.gov', 'api.us.socrata.com'];
const DOC = (id) => 'https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=' + id + '&searchType=External';
export const SEEDS = [
  'https://www.tceq.texas.gov/permitting/air',                                                   // air permitting landing: look for bulk data, feeds, terms
  'https://api.us.socrata.com/api/catalog/v1?domains=data.texas.gov&q=air%20permit&limit=20',   // is there ANY air-permit dataset on the state portal
  DOC('10258370'), DOC('10258371'),                                                              // the two known documents (technical review, final action)
  'https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH',                    // Records Online search entry page: GET only, never submitted
];
const LINK_WORDS = /(open[ -]?data|bulk|download|data ?set|data ?portal|terms|use policy|permit status|nsr|new source review|air permits? (data|search|status)|public notice|rss|feed|api)/i;

export function parseRobots(text) {
  const groups = []; let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if ((k === 'disallow' || k === 'allow') && cur) cur.rules.push({ allow: k === 'allow', path: v });
  }
  return groups;
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

const log = []; let used = 0, stopped = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, kind) {
  if (stopped) return { skipped: 'run stopped after a 403/429' };
  if (used >= MAX_REQUESTS) return { skipped: 'request cap reached' };
  if (used > 0) await sleep(SPACING_MS);
  for (let attempt = 0; attempt < 2; attempt++) {
    used++;
    let r; try { r = await fetch(url, { method: 'GET', headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' }); }
    catch (e) { const row = { url, kind, status: 'NETWORK_ERROR', detail: String(e?.cause?.code || e.message) }; log.push(row); return { row }; }
    const ct = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer()).subarray(0, MAX_BYTES);
    const row = { url, kind, status: r.status, content_type: ct, bytes: buf.length, final_url: r.url !== url ? r.url : undefined };
    if (r.status === 403 || r.status === 429) { row.note = 'REFUSED — stop; not retried; recorded as an access refusal'; stopped = true; log.push(row); return { row, buf }; }
    if (r.status >= 500 && attempt === 0) { row.note = '5xx, one retry'; log.push(row); await sleep(SPACING_MS); continue; }
    log.push(row); return { row, buf };
  }
}
export async function run() {
  const robots = {};
  for (const h of ROBOTS_HOSTS) {
    const { row, buf } = (await get('https://' + h + '/robots.txt', 'robots')) || {};
    robots[h] = row?.status === 200 && buf ? parseRobots(buf.toString('utf8')) : null; // no file / unreadable: recorded as such, not as permission
    if (row) row.robots_note = row.status === 200 ? 'parsed' : 'no robots.txt answered (status ' + row.status + ')';
  }
  async function guarded(url, kind) {
    const u = new URL(url); const g = robots[u.host];
    const v = g ? robotsVerdict(g, u.pathname + u.search) : { allowed: true, rule: 'host answered no robots.txt' };
    if (!v.allowed) { log.push({ url, kind, status: 'RESTRICTED', restriction: 'robots.txt ' + v.rule, fetched: false }); return null; }
    const r = await get(url, kind); if (r?.row) r.row.robots = v.rule; return r;
  }
  const found = [];
  for (const url of SEEDS) {
    const r = await guarded(url, 'seed'); if (!r?.buf) continue;
    const ct = r.row.content_type;
    if (/pdf/i.test(ct)) {
      const dir = mkdtempSync(join(tmpdir(), 'tceqpdf-')); const f = join(dir, 'd.pdf'); writeFileSync(f, r.buf);
      let text = ''; try { text = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8', maxBuffer: 20_000_000 }); } catch (e) { r.row.pdf_text = 'pdftotext failed'; }
      r.row.has_185303 = /185303/.test(text); r.row.has_414660 = /414660/.test(text);
      r.row.lines = (text.match(/^.*(RN\s?\d{9}|County|Latitude|Longitude|Lat\/Long|UTM|Action|Registration|Standard Permit|NSR).*$/gim) || []).slice(0, 12).map((s) => s.trim().slice(0, 160));
    } else if (/html|json|xml|text/i.test(ct)) {
      const body = r.buf.toString('utf8'); r.row.title = (body.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim();
      if (/api\.us\.socrata/.test(url)) { try { const j = JSON.parse(body); r.row.catalog_results = (j.results || []).slice(0, 20).map((x) => x.resource?.name + ' | ' + x.resource?.type); r.row.catalog_total = j.resultSetSize; } catch { r.row.catalog_results = 'unparseable'; } }
      else for (const m of body.matchAll(/<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        let abs; try { abs = new URL(m[1], url); } catch { continue; }
        if (abs.protocol === 'https:' && ROBOTS_HOSTS.includes(abs.host) && LINK_WORDS.test(text + ' ' + abs.pathname) && !found.includes(abs.href) && abs.href !== url) found.push(abs.href);
      }
    }
  }
  r_links: for (const url of found.slice(0, MAX_LINKS)) { const r = await guarded(url, 'followed-link'); if (r?.row && r.buf && /html|text/i.test(r.row.content_type)) r.row.title = (r.buf.toString('utf8').match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim(); if (stopped) break r_links; }
  console.log('----- BEGIN RESULT -----');
  console.log(JSON.stringify({ ua: UA, requests_used: used, cap: MAX_REQUESTS, stopped_on_refusal: stopped, links_discovered: found.length, log }, null, 1));
  console.log('----- END RESULT -----');
}
if (process.argv[1] && process.argv[1].endsWith('tceq-air-feasibility-probe.mjs')) await run();
