// Tab 17 data-center project check (stage 2): the decisions, with no I/O.
//
// The worker (scripts/impact-dc-verify.mjs) gathers facts through Map 1's own readers and hands them here. Nothing in this
// file reads a database or the network, so every rule is tested offline (test/impact-dc-verify.test.mjs).
//
// Reused, never copied: the project link, the project keys, the map's own source assessment and what counts as an
// official document all come from lib/map1-project-panel.js (the same module the Map 1 panel runs).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PANEL = new URL('../../lib/map1-project-panel.js', import.meta.url);
const ctx = { URL };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(PANEL, 'utf8'), ctx);
export const HS = ctx.HS;

const BRAND = JSON.parse(readFileSync(new URL('../../docs/brand/brand-contract.v1.json', import.meta.url), 'utf8'));
/** The public origin from the brand contract (the current identity), e.g. https://jodytracks.com. */
export const SITE_ORIGIN = BRAND.identities[BRAND.current_identity].origin;

// Words that say what kind of thing a project is, or where, rather than which one it is.
const GENERIC = new Set(('data center centre centers campus park project projects facility facilities site sites the and of at in on ' +
  'for a an llc inc corp corporation company co ltd lp new phase building buildings ai hyperscale cloud technology technologies ' +
  'tech digital development developments proposed planned county city town village township north south east west road ' +
  'street drive avenue highway').split(' '));

export function words(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}
export function distinctive(s) {
  return [...new Set(words(s).filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d{1,2}$/.test(w)))];
}
export function normUrl(u) {
  try {
    const x = new URL(String(u));
    if (!/^https?:$/.test(x.protocol)) return null;
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (x.search || '')).toLowerCase();
  } catch { return null; }
}

/** The text and the links a topic offers. Only what the candidate row itself carries. */
export function topicEvidence(c) {
  const ev = (c && c.evidence) || {};
  const leads = Array.isArray(ev.leads) ? ev.leads : [];
  const text = [c.title, c.subject, c.place].concat(leads.map((l) => l && l.title)).filter(Boolean).join(' \n ');
  const urls = [].concat(leads.map((l) => l && l.url), Array.isArray(ev.sources) ? ev.sources.map((s) => s && s.url) : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  return { text, words: new Set(words(text)), urls: [...new Set(urls)], urlKeys: new Set(urls.map(normUrl).filter(Boolean)) };
}

/**
 * Which drawn project the topic is about.
 * records: rows a ZIP of the topic's own place returns from Map 1's readers, each { map_key, zip, project_name,
 *   developer_or_operator, source_url, ... }. Being in the topic's place is the LOCATION identifier; a project also needs a
 *   NAME, OPERATOR or shared SOURCE LINK to match. A name or a place alone is never enough. A tie is ambiguous, never a guess.
 */
export function matchProject(candidate, records, opts) {
  const requireName = !!(opts && opts.requireName);
  const t = topicEvidence(candidate);
  const byKey = new Map();
  for (const r of records || []) {
    if (!r || !r.map_key) continue;
    const prev = byKey.get(r.map_key);
    if (prev) { prev.zips.add(r.zip); continue; }
    byKey.set(r.map_key, Object.assign({}, r, { zips: new Set([r.zip]) }));
  }
  const scored = [];
  for (const r of byKey.values()) {
    const ids = [];
    const nameTok = distinctive(r.project_name);
    if (requireName ? namesProjectStatewide(t, r.project_name) : (nameTok.length && nameTok.every((w) => t.words.has(w)))) ids.push('name');
    const opTok = distinctive(r.developer_or_operator);
    if (opTok.length && t.words.has(opTok[0])) ids.push('operator');
    const su = normUrl(r.source_url);
    if (su && t.urlKeys.has(su)) ids.push('source_link');
    if (!ids.length || (requireName && !ids.includes('name'))) continue;
    ids.push('location');
    scored.push({ record: r, identifiers: ids, score: ids.length + (ids.includes('name') ? 0.5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || String(a.record.map_key).localeCompare(String(b.record.map_key)));
  const summary = (s) => ({ map_key: s.record.map_key, name: s.record.project_name || null, zips: [...s.record.zips].sort(),
    identifiers: s.identifiers });
  if (!scored.length) return { state: 'no_match', alternatives: [] };
  if (scored.length > 1 && scored[1].score === scored[0].score) {
    return { state: 'ambiguous', alternatives: scored.filter((s) => s.score === scored[0].score).map(summary) };
  }
  return { state: 'matched', record: scored[0].record, identifiers: scored[0].identifiers,
    alternatives: scored.slice(1, 4).map(summary) };
}

/**
 * A name that is only a brand ("Google", "NTT", "Google Data Center") says who, not which site: across a whole state it
 * is an operator match in disguise. Statewide, a name counts only with at least TWO distinctive words, all in the topic
 * ("Amazon Project Rainier", "Google Michigan City Data Center").
 */
export const STATEWIDE_MIN_NAME_WORDS = 2;
export function namesProjectStatewide(t, name) {
  const tok = distinctive(name);
  return tok.length >= STATEWIDE_MIN_NAME_WORDS && tok.every((w) => t.words.has(w));
}

/**
 * STATEWIDE SEARCH (2026-11-13). A topic that names only a state has too many ZIP pages to read, so the worker asks
 * public.impact_dc_state_name_points for every data-center point Map 1 could draw in those states, with its names, and
 * keeps the ZIPs whose project the topic names IN FULL (every distinctive word of a name is in the topic). This only
 * chooses ZIPs; map1_dc_zip_members still decides what is drawn, and matchProject (with requireName) what is matched.
 */
export function zipsNamedByTopic(candidate, points) {
  const t = topicEvidence(candidate);
  const out = new Set();
  for (const p of points || []) {
    if (!p || !/^\d{5}$/.test(String(p.zip || ''))) continue;
    if (namesProjectStatewide(t, p.project_name)) out.add(String(p.zip));
  }
  return [...out].sort();
}

/** One project key per matched project, from the keys public.map1_project_stable_keys returns. Deterministic. */
export function chooseProjectKey(keys) {
  const ok = (keys || []).filter((k) => HS.map1ProjectKeyOk(k));
  ok.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ok[0] || null;
}

const APPROVAL_STATUSES = new Set(['Approved', 'Operating']);
const STATUS_DOC_KINDS = new Set(['decision', 'permit', 'other_official']);

/**
 * What the documents support. By evidence, not count.
 *  - The map's own source counts when it is an official record (an agency's permit or case record).
 *  - A directory listing (Compute Atlas, Epoch, OpenStreetMap) names the project; it never establishes a status.
 *  - A Proposed project needs an official application, planning, meeting or other official document (or an agency record).
 *  - An Approved or Operating status needs a decision, permit or other official record, or an agency record.
 * linkOk: url -> true | false | null (null = not checked).
 */
export function assessDocuments(site, approvedDocs, linkOk) {
  const src = HS.map1SourceAssessment(site);
  const sources = [];
  if (src.url) sources.push({ kind: src.kind, official: !!src.official, url: src.url, label: src.label,
    status_support: src.kind === 'official_record', link_ok: linkOk(src.url) });
  for (const d of approvedDocs || []) {
    sources.push({ kind: d.doc_kind, official: HS.map1DocIsOfficial(d.doc_kind), url: d.url, label: d.title,
      status_support: STATUS_DOC_KINDS.has(d.doc_kind), link_ok: linkOk(d.url), doc_date: d.doc_date || null,
      doc_date_label: d.doc_date_label || null, document_id: d.document_id || null });
  }
  const working = sources.filter((s) => s.link_ok === true);
  const broken = sources.filter((s) => s.link_ok === false);
  const officialWorking = working.filter((s) => s.official);
  const status = site && site.status;
  const needsStatusDoc = APPROVAL_STATUSES.has(status);
  const statusSupported = !needsStatusDoc || officialWorking.some((s) => s.status_support);
  const gaps = [];
  if (!officialWorking.length) {
    gaps.push(src.kind === 'directory'
      ? 'Only a directory listing is on file. A listing names the project but does not establish its status.'
      : 'No working official document is on file for this project.');
  } else if (!statusSupported) {
    gaps.push('Map 1 shows this project as ' + status + ', but no working official decision or permit record is on file to support it.');
  }
  for (const b of broken) gaps.push('A document link does not open: ' + b.url);
  return { sources, sufficient: officialWorking.length > 0 && statusSupported, status_claim_supported: statusSupported, gaps };
}

/** Activity (the ZIP page's lists). Only records the ZIP page's Development list draws can be on it; nothing is made up. */
export function activityFor(mapKey, devList) {
  if (!/^n5:/.test(String(mapKey || ''))) {
    return { state: 'not_applicable', reason: 'Data-center directory records appear on Map 1. The ZIP page\'s Development list shows official development records only, so this project has no Activity entry.' };
  }
  if (!devList || !devList.complete) return { state: 'unknown', reason: 'The ZIP page\'s Development list could not be read.' };
  const body = mapKey.slice(3);
  return devList.rows.some((r) => r && r.source_key === body)
    ? { state: 'listed', reason: 'The project is in the ZIP page\'s Development list.' }
    : { state: 'not_listed', reason: 'Map 1 draws this record but the ZIP page\'s Development list does not include it.' };
}

/** Graphemes, as Bluesky counts them (code points when Intl.Segmenter is missing: never fewer). */
export function graphemes(s) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length;
  return [...String(s)].length;
}
export const REPLY_LIMIT = 300;
/** The suggested reply. It names no status and promises nothing about an approval. */
export function composeReply(link) {
  const text = 'You can follow this project on JODY\'s Development Map, including its current status and supporting documents: ' + link;
  return { text, graphemes: graphemes(text), fits: graphemes(text) <= REPLY_LIMIT };
}

/**
 * The verdict. A project link is AVAILABLE when the project is identified, Map 1 draws it and the link opened it on a real
 * page. The reply is READY only when, in addition, the documents support it and it fits Bluesky's limit.
 */
export function decide({ match, locate, link, page, docs, activity, candidate }) {
  const gaps = [];
  const out = { version: 1, discovered_at: (candidate && candidate.discovered_at) || null };
  if (match.state !== 'matched') {
    out.outcome = 'needs_review';
    out.match = { state: match.state, alternatives: match.alternatives || [] };
    gaps.push(match.state === 'ambiguous' ? 'The topic matches more than one project on Map 1.'
      : 'No project on Map 1 in the topic\'s place matches the topic by name, operator or source link.');
    out.link = { available: false }; out.reply = { ready: false };
    out.gaps = gaps;
    return out;
  }
  out.match = { state: 'matched', identifiers: match.identifiers, alternatives: match.alternatives || [],
    project_key: locate && locate.key || null, map_key: match.record.map_key,
    zip: locate && locate.zip || null, zips: (locate && locate.zips) || [] };
  out.project = { name: match.record.project_name || null, location_text: match.record.location_text || null,
    status: match.record.map_status || match.record.status || null, raw_status: match.record.raw_status || null,
    source_name: match.record.source_name || null };
  if (!locate || locate.state !== 'found' || locate.map_key !== match.record.map_key) {
    out.outcome = 'missing_website_connection';
    gaps.push(!locate ? 'The project link could not be checked.'
      : locate.state !== 'found' ? 'The project link does not find this project on Map 1 (' + locate.state + ').'
      : 'The project link opens a different project.');
    out.link = { available: false, state: locate ? locate.state : 'unchecked' };
  } else {
    out.link = { url: link, available: page && page.state === 'verified', state: page ? page.state : 'unchecked',
      checks: page ? page.checks : [] };
    if (!page || page.state === 'error') { gaps.push('The project page could not be opened to check it: ' + ((page && page.error) || 'not checked') + '.'); }
    else if (page.state !== 'verified') gaps.push('The project page did not open the project: ' + (page.error || page.state) + '.');
  }
  out.documents = docs;
  out.activity = activity;
  gaps.push(...docs.gaps);
  const reply = out.link.available ? composeReply(link) : null;
  if (reply && !reply.fits) gaps.push('The reply is longer than Bluesky allows.');
  out.reply = { ready: !!(out.link.available && docs.sufficient && reply && reply.fits), text: reply ? reply.text : null,
    graphemes: reply ? reply.graphemes : null };
  out.outcome = out.link.available ? (docs.sufficient ? 'verified' : 'missing_documentation')
    : (out.link.state === 'error' ? 'check_failed' : 'missing_website_connection');
  out.gaps = gaps;
  return out;
}

/** Official government hosts (proposals only; a person still decides). */
export function isOfficialHost(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return /\.(gov|mil|us)$/.test(h) || /\.state\.[a-z]{2}\./.test(h);
  } catch { return false; }
}
