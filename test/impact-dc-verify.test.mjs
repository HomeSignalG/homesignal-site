// TAB 17 DATA-CENTER PROJECT CHECK (stage 2) — the worker and its rules, offline, with a fake database and network.
// Run: node test/impact-dc-verify.test.mjs
import * as core from '../scripts/lib/impact-dc-verify-core.mjs';
import { verifyOne, runOnce } from '../scripts/impact-dc-verify.mjs';
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined && !c ? '  [' + JSON.stringify(extra) + ']' : ''));
  if (!c) fails++;
};

// A topic about "CyrusOne Vint Hill" in Fauquier County VA, and Map 1's data-center rows for its ZIPs.
const topic = (over = {}) => Object.assign({
  title: 'CyrusOne wants to expand its Vint Hill campus, neighbors worried', place: 'Fauquier County, VA', subject: 'data center',
  coverage: { places: [{ state: 'VA', county: 'Fauquier', zip_pages: 2 }] }, zips: ['20187', '20186'],
  evidence: { leads: [{ url: 'https://www.fauquiercounty.gov/planning/rezn-24-1.pdf', title: 'REZN-24-1' },
                      { url: 'https://news.example/cyrusone', title: 'CyrusOne plans' }] },
  discovered_at: '2026-11-10T12:00:00Z' }, over);
const row = (over = {}) => Object.assign({ source_key: 'dc:aaa', project_name: 'CyrusOne Vint Hill', developer_or_operator: 'CyrusOne',
  map_status: 'Proposed', raw_status: 'proposed', location_text: 'Vint Hill, VA', source_url: 'https://computeatlas.example/cyrusone-vint-hill',
  source_name: 'Compute Atlas', lat: 38.75, lng: -77.67 }, over);
const other = row({ source_key: 'dc:bbb', project_name: 'Amazon Warrenton', developer_or_operator: 'Amazon Web Services',
  source_url: 'https://computeatlas.example/aws-warrenton' });

function fakeDeps(opt = {}) {
  const calls = [];
  const members = opt.members || { '20187': [row(), other], '20186': [] };
  const deps = {
    calls,
    rpc: async (fn, body) => {
      calls.push([fn, body]);
      if (opt.fail && opt.fail[fn]) throw new Error(opt.fail[fn]);
      switch (fn) {
        case 'map1_dc_zip_members': return members[body.p_zip] || [];
        case 'map1_project_stable_keys': return opt.keys ? opt.keys(body.p_map_key) : ['dcrec:compute_atlas|facilities|cyrusone-vint-hill'];
        case 'map1_project_locate': return opt.locate ? opt.locate(body) :
          { key: body.p_key, kind: 'dcrec', state: 'found', zip: '20187', zips: ['20187'], map_key: 'dc:aaa' };
        case 'map1_project_document_propose': return 'doc-' + calls.length;
        case 'map1_project_documents': return opt.docs || [];
        case 'impact_dc_verification_claim': return opt.jobs || [];
        case 'impact_dc_verification_record': case 'impact_dc_verification_fail': return null;
        default: throw new Error('unexpected rpc ' + fn);
      }
    },
    fetchDoc: async (u) => (opt.dead && opt.dead.includes(u) ? { ok: false, status: 404 } : { ok: true, status: 200, title: 'Doc ' + u.slice(-12) }),
    checkPage: async (link, exp) => (opt.page ? opt.page(link, exp) : { state: 'verified', checks: [{ viewport: 'desktop', ok: true }, { viewport: 'phone', ok: true }] }),
  };
  return deps;
}
const permitDoc = { url: 'https://www.fauquiercounty.gov/bos/res-2026-14.pdf', title: 'Board resolution approving REZN-24-1',
  doc_kind: 'decision', doc_date: '2026-11-01', doc_date_label: 'Decision date' };
const appDoc = { url: 'https://www.fauquiercounty.gov/planning/rezn-24-1.pdf', title: 'Rezoning application REZN-24-1', doc_kind: 'application' };

console.log('\n1. which project the topic is about');
let m = core.matchProject(topic(), [Object.assign({ zip: '20187', map_key: 'dc:aaa' }, row()), Object.assign({ zip: '20187', map_key: 'dc:bbb' }, other)]);
ok(m.state === 'matched' && m.record.map_key === 'dc:aaa' && m.identifiers.includes('name') && m.identifiers.includes('location'), '1a name + place match', m);
m = core.matchProject(topic({ title: 'A new data center campus is planned', evidence: {} }), [Object.assign({ zip: '20187', map_key: 'dc:aaa' }, row())]);
ok(m.state === 'no_match', '1b the place alone, or generic words, never match', m);
m = core.matchProject(topic({ title: 'Data center worries in Fauquier', evidence: { leads: [{ url: 'https://computeatlas.example/cyrusone-vint-hill/' }] } }),
  [Object.assign({ zip: '20187', map_key: 'dc:aaa' }, row())]);
ok(m.state === 'matched' && m.identifiers.includes('source_link'), '1c a shared source link identifies the project', m);
m = core.matchProject(topic({ title: 'CyrusOne campus fight' }), [Object.assign({ zip: '20187', map_key: 'dc:aaa' }, row({ project_name: 'CyrusOne Site A' })),
  Object.assign({ zip: '20187', map_key: 'dc:ccc' }, row({ source_key: 'dc:ccc', project_name: 'CyrusOne Site B', source_url: 'https://x.example/b' }))]);
ok(m.state === 'ambiguous' && m.alternatives.length === 2, '1d two equally good projects: ambiguous, never a guess', m);
m = core.matchProject(topic(), [Object.assign({ zip: '20187', map_key: 'dc:aaa' }, row()), Object.assign({ zip: '20186', map_key: 'dc:aaa' }, row())]);
ok(m.state === 'matched' && [...m.record.zips].length === 2, '1e one project on two ZIP pages is one project');

console.log('\n2. the link is the stable project key');
ok(core.chooseProjectKey(['dc:72e5', 'dcrec:b|x', 'dcrec:a|x']) === 'dcrec:a|x', '2a never an entity id; deterministic order');
ok(core.SITE_ORIGIN === 'https://jodytracks.com', '2b the origin comes from the brand contract', core.SITE_ORIGIN);
let r = await verifyOne(fakeDeps({ docs: [appDoc] }), { candidate: topic() });
ok(r.link.url === 'https://jodytracks.com/map/20187/?project=dcrec%3Acompute_atlas%7Cfacilities%7Ccyrusone-vint-hill', '2c the link', r.link);
// merged entity: Map 1 now draws it under a new entity id; the stable key (from the record key) is unchanged
const merged = await verifyOne(fakeDeps({ docs: [appDoc], members: { '20187': [row({ source_key: 'dc:new-after-merge' }), other], '20186': [] },
  keys: (mk) => (mk === 'dc:new-after-merge' ? ['dcrec:compute_atlas|facilities|cyrusone-vint-hill', 'dcrec:epoch|dc|cyrusone-vh'] : []),
  locate: (b) => ({ key: b.p_key, state: 'found', zip: '20187', zips: ['20187'], map_key: 'dc:new-after-merge' }) }), { candidate: topic() });
ok(merged.link.url === r.link.url && merged.match.map_key === 'dc:new-after-merge', '2d after a merge the link is the same', merged.match);
// Proposed -> Approved: same project key, same link; the status claim then needs a decision or permit
const approvedDir = await verifyOne(fakeDeps({ docs: [appDoc], members: { '20187': [row({ map_status: 'Approved', raw_status: 'approved' })], '20186': [] } }), { candidate: topic() });
ok(approvedDir.link.url === r.link.url, '2e Proposed to Approved keeps the link');
ok(approvedDir.outcome === 'missing_documentation' && approvedDir.link.available && !approvedDir.reply.ready &&
   approvedDir.gaps.some((g) => /shows this project as Approved/.test(g)), '2f an Approved status with only an application is not supported', approvedDir.gaps);
const approvedOk = await verifyOne(fakeDeps({ docs: [appDoc, permitDoc], members: { '20187': [row({ map_status: 'Approved' })], '20186': [] } }), { candidate: topic() });
ok(approvedOk.outcome === 'verified' && approvedOk.reply.ready, '2g with an approved decision record it is verified', approvedOk.gaps);

console.log('\n3. documents by evidence, not count');
const dirOnly = await verifyOne(fakeDeps({ docs: [] }), { candidate: topic({ evidence: { leads: [] } }) });
ok(dirOnly.outcome === 'missing_documentation' && dirOnly.link.available === true && dirOnly.reply.ready === false,
  '3a directory listing only: link available, reply not ready', dirOnly);
ok(dirOnly.gaps.some((g) => /directory listing/.test(g)), '3b the gap names the directory listing');
r = await verifyOne(fakeDeps({ docs: [appDoc] }), { candidate: topic() });
ok(r.outcome === 'verified' && r.reply.ready, '3c a Proposed project with an official application is ready', r.gaps);
r = await verifyOne(fakeDeps({ docs: [appDoc], dead: [appDoc.url] }), { candidate: topic() });
ok(!r.reply.ready && r.gaps.some((g) => /does not open/.test(g)), '3d a dead official link does not count');
const many = Array.from({ length: 6 }, (_, i) => ({ url: 'https://news.example/' + i, title: 'News ' + i, doc_kind: 'news' }));
r = await verifyOne(fakeDeps({ docs: many }), { candidate: topic({ evidence: { leads: [] } }) });
ok(!r.reply.ready, '3e six news articles are not one official document');
const s = core.assessDocuments({ zip_authoritative: true, record_url: 'https://apps.phoenix.gov/p/1', status: 'Proposed' }, [], () => true);
ok(s.sufficient, '3f an agency\'s own record is enough for a Proposed project (the map\'s source can qualify)');

console.log('\n4. proposals are pending, never approved');
const d = fakeDeps({ docs: [] });
await verifyOne(d, { candidate: topic() });
const props = d.calls.filter((c) => c[0] === 'map1_project_document_propose');
ok(props.length === 1 && props[0][1].p_url === appDoc.url && /^verification:/.test(props[0][1].p_proposed_by), '4a only the official .gov lead is proposed', props);
ok(!d.calls.some((c) => /decide|approve/.test(c[0])), '4b the worker never decides a document');
ok(!readFileSync(new URL('../scripts/impact-dc-verify.mjs', import.meta.url), 'utf8').match(/hs_map1_project_document_decide/), '4c no decide call in the worker');

console.log('\n5. link availability and failures');
r = await verifyOne(fakeDeps({ locate: (b) => ({ key: b.p_key, state: 'not_on_map', zips: [] }) }), { candidate: topic() });
ok(r.outcome === 'missing_website_connection' && !r.link.available && !r.reply.ready, '5a a key the map does not find: no link', r);
r = await verifyOne(fakeDeps({ page: () => ({ state: 'mismatch', error: 'phone: The project panel did not open.', checks: [] }) }), { candidate: topic() });
ok(r.outcome === 'missing_website_connection' && !r.link.available && r.gaps.some((g) => /did not open the project/.test(g)), '5b the page did not open the project', r.gaps);
r = await verifyOne(fakeDeps({ page: () => { throw new Error('browser crashed'); } }), { candidate: topic() });
ok(r.outcome === 'check_failed' && !r.link.available, '5c the page check could not run: check_failed, never verified', r);
r = await verifyOne(fakeDeps(), { candidate: topic({ zips: [] }) });
ok(r.outcome === 'needs_review' && r.match.state === 'no_match', '5d no ZIP page for the place: needs review');
r = await verifyOne(fakeDeps({ members: { '20187': [Object.assign(row(), {}), row({ source_key: 'dc:ccc', project_name: 'CyrusOne Vint Hill', source_url: 'https://y.example' })], '20186': [] } }), { candidate: topic() });
ok(r.outcome === 'needs_review' && r.match.state === 'ambiguous', '5e ambiguous: needs review', r.match);

console.log('\n6. the reply');
const rep = core.composeReply('https://jodytracks.com/map/20187/?project=dcrec%3Aa');
ok(rep.fits && rep.text.endsWith('https://jodytracks.com/map/20187/?project=dcrec%3Aa'), '6a ends with the link');
ok(!/approv|will be built|guarantee/i.test(rep.text), '6b names no approval');
ok(core.graphemes('é👩‍👩‍👧') === 2, '6c graphemes as Bluesky counts them');
ok(core.activityFor('dc:aaa', null).state === 'not_applicable', '6d a data center has no Activity entry, and says why');
ok(core.activityFor('n5:x:1', { complete: true, rows: [{ source_key: 'x:1' }] }).state === 'listed' &&
   core.activityFor('n5:x:1', { complete: false, rows: [] }).state === 'unknown', '6e a development record: listed, or unknown when unread');
r = await verifyOne(fakeDeps({ docs: [appDoc] }), { candidate: topic() });
ok(r.discovered_at === '2026-11-10T12:00:00Z' && !('event_date' in r), '6f the discovery date is kept apart; no event is made');

console.log('\n7. runOnce records or fails each job');
let d7 = fakeDeps({ jobs: [{ run_id: 'r1', candidate_id: 'c1', candidate: topic() }], docs: [appDoc] });
let done = await runOnce(d7);
ok(done[0].outcome === 'verified' && d7.calls.some((c) => c[0] === 'impact_dc_verification_record' && c[1].p_run === 'r1'), '7a a result is recorded');
d7 = fakeDeps({ jobs: [{ run_id: 'r2', candidate_id: 'c2', candidate: topic() }], fail: { map1_dc_zip_members: 'HTTP 500' } });
done = await runOnce(d7);
ok(done[0].outcome === 'failed' && d7.calls.some((c) => c[0] === 'impact_dc_verification_fail' && /HTTP 500/.test(c[1].p_error)) &&
   !d7.calls.some((c) => c[0] === 'impact_dc_verification_record'), '7b a failed read is a failed attempt, never a partial result');

console.log('\n8. the workflow');
const wf = readFileSync(new URL('../.github/workflows/impact-dc-verify.yml', import.meta.url), 'utf8');
ok(!/^\s*schedule:/m.test(wf) && /workflow_dispatch:/.test(wf), '8a dispatch only, no schedule');
ok(['disabled','enabled'].includes(readFileSync(new URL('../.github/impact-dc-verify', import.meta.url), 'utf8').trim()), '8b the switch reads enabled or disabled (switched on 2026-11-13 after the SQL was applied)');
ok(/\.github\/impact-dc-verify/.test(wf) && /"enabled"/.test(wf), '8c the job refuses unless switched on');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
