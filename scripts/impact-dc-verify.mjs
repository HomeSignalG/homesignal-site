#!/usr/bin/env node
// Tab 17 data-center project check (stage 2): the worker.
//
// Claims due jobs (public.impact_dc_verification_claim), and for each data-center topic:
//   1. takes the ZIP pages of the topic's own places (the claim computes them with public.impact_dc_topic_zips, the same
//      place rule Hot Topics' coverage uses) and reads Map 1's data-center reader for each (map1_dc_zip_members);
//   2. matches the topic to one drawn project (scripts/lib/impact-dc-verify-core.mjs::matchProject);
//   3. turns its map key into the stable project key (map1_project_stable_keys) and looks the key up the way a link does
//      (map1_project_locate), so the link points at the project, not at today's map key;
//   4. reads the approved documents (map1_project_documents) and proposes official links from the topic as PENDING
//      documents (map1_project_document_propose); it never approves one;
//   5. checks every document link, and opens the project link in a real browser at desktop and phone width;
//   6. records the result (impact_dc_verification_record), or the failure (impact_dc_verification_fail).
// It writes nothing else. It is started by public.impact_dc_verification_tick() through .github/workflows/impact-dc-verify.yml,
// which runs scripts/impact-dc-verify-run.mjs (the production wiring).
//
// Every outside call goes through `deps`, so test/impact-dc-verify.test.mjs runs the whole flow with no network.
import { HS, SITE_ORIGIN, matchProject, zipsNamedByTopic, chooseProjectKey, assessDocuments, activityFor, decide, isOfficialHost }
  from './lib/impact-dc-verify-core.mjs';

const MAX_ZIPS = 150;

/** ZIP pages of the topic's places, as the claim computed them. */
export function zipsForCandidate(candidate) {
  return [...new Set((Array.isArray(candidate.zips) ? candidate.zips : []).map(String).filter((z) => /^\d{5}$/.test(z)))].sort();
}

/** Two-letter states of the topic's places, as the claim computed them. */
export function statesForCandidate(candidate) {
  return [...new Set((Array.isArray(candidate.states) ? candidate.states : []).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))].sort();
}

export async function verifyOne(deps, job) {
  const candidate = job.candidate || {};
  let zips = zipsForCandidate(candidate);
  let scope = 'place';
  const states = statesForCandidate(candidate);
  if (!zips.length && states.length) {
    // the topic names a state, not a county or city: pick only the ZIPs whose drawn project the topic names
    zips = zipsNamedByTopic(candidate, await deps.rpc('impact_dc_state_name_points', { p_states: states }));
    scope = 'state';
  }
  const search = { scope, states, zips: zips.length };
  if (!zips.length) {
    return Object.assign(decide({ match: { state: 'no_match', alternatives: [] }, candidate }), { search });
  }
  if (zips.length > MAX_ZIPS) throw new Error('The topic\'s place covers ' + zips.length + ' ZIP pages; more than ' + MAX_ZIPS + ' is not searched.');
  const records = [];
  for (const z of zips) {
    const rows = await deps.rpc('map1_dc_zip_members', { p_zip: z });   // throws on a failed read: no partial answer
    for (const r of rows || []) records.push(Object.assign({ zip: z, map_key: r.source_key, status: r.map_status }, r));
  }
  const match = matchProject(candidate, records, { requireName: scope === 'state' });
  if (match.state !== 'matched') return Object.assign(decide({ match, candidate }), { search });

  const keys = await deps.rpc('map1_project_stable_keys', { p_map_key: match.record.map_key });
  const key = chooseProjectKey(Array.isArray(keys) ? keys : []);
  if (!key) {
    return decide({ match: { state: 'no_match', alternatives: [{ map_key: match.record.map_key, name: match.record.project_name,
      identifiers: match.identifiers, note: 'no stable project key' }] }, candidate });
  }
  const locate = await deps.rpc('map1_project_locate', { p_key: key, p_zip: match.record.zip });
  const link = locate && locate.state === 'found' ? HS.map1ProjectLink(SITE_ORIGIN, locate.zip, key) : null;

  // documents: propose official topic links (pending), read approved ones
  const proposed = [];
  for (const u of candidateUrls(candidate)) {
    if (!isOfficialHost(u)) continue;
    const head = await deps.fetchDoc(u);                              // { ok, status, title }
    if (!head || !head.ok) continue;
    const id = await deps.rpc('map1_project_document_propose', {
      p_project_key: key, p_url: u, p_title: (head.title || u).slice(0, 300), p_publisher: new URL(u).hostname,
      p_doc_kind: 'other_official', p_doc_date: null, p_doc_date_label: null,
      p_supports: 'Linked from the Bluesky topic. A person must confirm it concerns ' + (match.record.project_name || 'this project') + '.',
      p_evidence_quote: null, p_proposed_by: 'verification:impact-dc-verify' });
    proposed.push({ url: u, document_id: id, state: 'pending' });
  }
  const approved = (await deps.rpc('map1_project_documents', { p_map_keys: [match.record.map_key] })) || [];
  // The record as Map 1 draws it (lib/data.js HS.map1DcSite: a directory listing, with the source's own URL).
  const site = { record_kind: 'national_project', record_url: match.record.source_url || null, source_name: match.record.source_name,
    status: match.record.map_status };
  const urls = [site.record_url].concat(approved.map((d) => d.url)).filter(Boolean);
  const checked = new Map();
  for (const u of urls) { const r = await deps.fetchDoc(u); checked.set(u, r ? !!r.ok : null); }
  const docs = assessDocuments(site, approved, (u) => (checked.has(u) ? checked.get(u) : null));
  docs.proposed = proposed;

  // Only the data-center plane is searched, so Activity is "not applicable" for every match (activityFor says why).
  const activity = activityFor(match.record.map_key, null);

  let page = null;
  if (link) {
    try { page = await deps.checkPage(link, { mapKey: locate.map_key, name: match.record.project_name, docUrls: urls }); }
    catch (e) { page = { state: 'error', error: String(e && e.message || e).slice(0, 200), checks: [] }; }
  }
  return Object.assign(decide({ match, locate: Object.assign({ key }, locate), link, page, docs, activity, candidate }), { search });
}

function candidateUrls(c) {
  const ev = c.evidence || {};
  return [...new Set([].concat((ev.leads || []).map((l) => l && l.url), (ev.sources || []).map((s) => s && s.url))
    .filter((u) => typeof u === 'string' && /^https:\/\//.test(u)))].slice(0, 10);
}

export async function runOnce(deps, worker = 'impact-dc-verify') {
  const jobs = (await deps.rpc('impact_dc_verification_claim', { p_worker: worker, p_limit: 5 })) || [];
  const done = [];
  for (const job of jobs) {
    try {
      const result = await verifyOne(deps, job);
      result.checked_at = deps.now ? deps.now() : new Date().toISOString();
      await deps.rpc('impact_dc_verification_record', { p_run: job.run_id, p_result: result });
      done.push({ candidate_id: job.candidate_id, outcome: result.outcome });
    } catch (e) {
      await deps.rpc('impact_dc_verification_fail', { p_run: job.run_id, p_error: String(e && e.message || e).slice(0, 900) });
      done.push({ candidate_id: job.candidate_id, outcome: 'failed', error: String(e && e.message || e) });
    }
  }
  return done;
}
