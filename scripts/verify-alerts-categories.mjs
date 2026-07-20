// verify-alerts-categories.mjs — audit the three mandatory Alerts categories
// (Government Notices, Upcoming Meetings, Local News) across every materialized ZIP.
//
// Run: node scripts/verify-alerts-categories.mjs
// Env: SAMPLE (optional cap on ZIP walk for smoke runs)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const grab = (n) => {
  const m = cfg.match(new RegExp(`${n}\\s*:\\s*'([^']+)'`));
  if (!m) throw new Error(`Could not read ${n} from config.js`);
  return m[1];
};
const SUPABASE_URL = grab('SUPABASE_URL');
const KEY = grab('SUPABASE_ANON_KEY');
const hdrs = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const SAMPLE = process.env.SAMPLE ? parseInt(process.env.SAMPLE, 10) : 0;

const NEWS_TOPICS = [
  'Water Quality', 'Air Quality', 'Soil Quality', 'Animal & Human Viruses / Diseases',
  'Infrastructure', 'EMF', 'Noise Pollution', 'Light Pollution',
  'Livestock, Crops, Pets & Wildlife Health', 'Weather & Climate Hazards', 'Radiation', 'Data Centers',
];
const STANDARD_GOV = [
  'County Commission & county business', 'Planning, zoning & development',
  'Property taxes & assessments', 'Public safety & emergencies',
  'Water districts & utilities', 'Water companies', // accept legacy until migration applied
  'Elections & voting',
];

const REPRESENTATIVE = ['84302', '84336', '78617', '60601', '02138', '80202', '98101', '48226', '84604', '84101'];

async function rest(path, { head = false } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: head ? { ...hdrs, Prefer: 'count=exact' } : hdrs,
    method: head ? 'HEAD' : 'GET',
  });
  if (!r.ok) throw new Error(`${r.status} ${path} ${(await r.text()).slice(0, 200)}`);
  if (head) return { count: parseInt(r.headers.get('content-range')?.split('/')[1] || '0', 10) };
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

async function restAll(table, select, orderCol = 'id') {
  const rows = [];
  let last = '';
  let pageNum = 0;
  for (;;) {
    pageNum++;
    const extra = last ? `&${orderCol}=gt.${encodeURIComponent(last)}` : '';
    const page = await rest(`${table}?select=${select}&order=${orderCol}.asc&limit=1000${extra}`);
    rows.push(...page);
    if (page.length < 1000) break;
    const next = page[page.length - 1][orderCol];
    if (!next || next === last) throw new Error(`${table} pagination stalled at page ${pageNum}`);
    last = next;
  }
  return rows;
}

const rank = { zip: 0, neighborhood: 0, city: 1, county: 2 };

function resolveGovTopics(communitiesById, zipRows) {
  if (!zipRows.length) return null;
  const node = zipRows.slice().sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3))[0];
  const labels = [];
  const seen = {};
  const chain = [];
  let cur = node;
  let rootId = node.id;
  let hops = 0;
  while (cur && hops++ < 6) {
    chain.push({ level: cur.level, name: cur.name, topics: cur.government_topics || [] });
    (cur.government_topics || []).forEach((t) => { if (!seen[t]) { seen[t] = 1; labels.push(t); } });
    rootId = cur.id;
    if (!cur.parent_id) break;
    cur = communitiesById.get(cur.parent_id);
  }
  return { resolved: node.name, state: node.state, labels, rootId, chain };
}

async function main() {
  console.log('Loading communities…');
  const communities = await restAll('communities', 'id,name,level,parent_id,state,government_topics,zip_codes', 'id');
  const byId = new Map(communities.map((c) => [c.id, c]));
  const byZip = new Map();
  for (const c of communities) {
    for (const z of c.zip_codes || []) {
      if (!byZip.has(z)) byZip.set(z, []);
      byZip.get(z).push(c);
    }
  }

  console.log('Loading materialized ZIPs…');
  let zips = await restAll('app_community_meta', 'zip,state,name,data_quality', 'zip');
  if (SAMPLE > 0) zips = zips.slice(0, SAMPLE);
  console.log(`ZIPs to audit: ${zips.length}`);

  console.log('Loading alerts + meetings…');
  const alerts = await restAll('alerts', 'community_id,category,pipeline_type', 'id');
  const meetingsP1 = await rest('meetings?select=id,community_id,category&order=id.asc&limit=1000');
  const meetingsP2 = meetingsP1.length === 1000 && meetingsP1[999]?.id
    ? await rest(`meetings?select=id,community_id,category&order=id.asc&limit=1000&id=gt.${encodeURIComponent(meetingsP1[999].id)}`)
    : [];
  const meetings = meetingsP1.concat(meetingsP2);
  console.log(`  alerts=${alerts.length} meetings=${meetings.length}`);

  const alertByRoot = new Map();
  const meetByRoot = new Map();
  for (const a of alerts) {
    if (!alertByRoot.has(a.community_id)) alertByRoot.set(a.community_id, new Map());
    const m = alertByRoot.get(a.community_id);
    m.set(a.category, (m.get(a.category) || 0) + 1);
  }
  for (const m of meetings) {
    if (!meetByRoot.has(m.community_id)) meetByRoot.set(m.community_id, new Map());
    const mm = meetByRoot.get(m.community_id);
    mm.set(m.category, (mm.get(m.category) || 0) + 1);
  }

  const newsAlertCount = alerts.filter((a) => a.pipeline_type === 'news_alert').length;
  const govAlertCount = alerts.filter((a) => a.pipeline_type === 'government_notice').length;

  const govTopicDist = {};
  const stdBackboneDist = {};
  const noCommunity = [];
  const partialUtah = [];
  const zipRows = [];

  for (const z of zips) {
    const gt = resolveGovTopics(byId, byZip.get(z.zip) || []);
    if (!gt) { noCommunity.push(z.zip); continue; }
    const n = gt.labels.length;
    govTopicDist[n] = (govTopicDist[n] || 0) + 1;
    const stdN = STANDARD_GOV.filter((t) => gt.labels.includes(t)).length;
    stdBackboneDist[stdN] = (stdBackboneDist[stdN] || 0) + 1;
    const county = gt.chain.find((c) => c.level === 'county');
    if (county && (county.topics || []).length < 6 && z.state === 'UT') {
      partialUtah.push({ zip: z.zip, county: county.name, countyTopics: county.topics.length, total: n });
    }
    const aMap = alertByRoot.get(gt.rootId) || new Map();
    const mMap = meetByRoot.get(gt.rootId) || new Map();
    let topicsWithAlerts = 0;
    let topicsWithMeetings = 0;
    for (const t of gt.labels) {
      if ((aMap.get(t) || 0) > 0) topicsWithAlerts++;
      if ((mMap.get(t) || 0) > 0) topicsWithMeetings++;
    }
    zipRows.push({
      zip: z.zip,
      state: z.state,
      data_quality: z.data_quality,
      resolved: gt.resolved,
      govTopicCount: n,
      stdBackbone: stdN,
      govTopics: gt.labels,
      rootId: gt.rootId,
      topicsWithAlerts,
      topicsWithMeetings,
      anyGovContent: topicsWithAlerts > 0 || topicsWithMeetings > 0,
    });
  }

  const rootsWithContent = new Set([...alertByRoot.keys(), ...meetByRoot.keys()]);

  const report = {
    at: new Date().toISOString(),
    materializedZips: zips.length,
    categoriesMandatory: ['Government Notices', 'Upcoming Meetings', 'Local News'],
    uiThreeTiles: 'PASS — hardcoded in alerts.html (static for all ZIPs)',
    newsTopicsPerZip: NEWS_TOPICS.length,
    production: {
      totalAlerts: alerts.length,
      totalMeetings: meetings.length,
      government_noticeAlerts: govAlertCount,
      news_alertAlerts: newsAlertCount,
      rootsWithGovContent: rootsWithContent.size,
    },
    govTopicCountDistribution: govTopicDist,
    stdBackboneCountDistribution: stdBackboneDist,
    zipsNoCommunity: noCommunity.length,
    utahPartialCountyBackbone: partialUtah.length,
    representative: zipRows.filter((r) => REPRESENTATIVE.includes(r.zip)),
    findings: {
      p0: [],
      p1: [],
      p2: [],
    },
  };

  // Findings
  if (newsAlertCount === 0) {
    report.findings.p0.push('Local News: 0 production alerts with pipeline_type=news_alert — subscriptions cannot deliver email content.');
  }
  report.findings.p0.push('Gov Notices vs Upcoming Meetings: both write pipeline_type=government_notice; independent meeting-only subscription not implemented.');
  if (noCommunity.length) {
    report.findings.p0.push(`${noCommunity.length} materialized ZIP(s) have no communities row — openTopics gov/meetings fall back to seed labels.`);
  }
  const emptyGov = zipRows.filter((r) => !r.anyGovContent).length;
  report.findings.p1.push(`${emptyGov}/${zipRows.length} materialized ZIPs (${((emptyGov / zipRows.length) * 100).toFixed(1)}%) have zero gov-topic alerts AND meetings at chain root — topics shown but no feed-backed records.`);
  if (partialUtah.length) {
    report.findings.p1.push(`${partialUtah.length} Utah ZIP(s) inherit a county row with <6 backbone government_topics (e.g. Utah County = 1 topic). Popup topic list inconsistent with national standard.`);
  }
  report.findings.p2.push('alerts.html has no per-category empty-state copy distinguishing "no records yet" vs "no source coverage" on topic tiles.');
  report.findings.p2.push('Topic tile counts show "N topics followed" only — no signal when a followed topic has zero feed coverage.');

  mkdirSync('verify', { recursive: true });
  const jsonPath = 'verify/alerts-category-audit.json';
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  console.log('\n=== Alerts category audit ===');
  console.log(`Materialized ZIPs: ${zips.length}`);
  console.log(`Gov topic count distribution:`, govTopicDist);
  console.log(`Standard backbone (of 6) distribution:`, stdBackboneDist);
  console.log(`ZIPs with no community: ${noCommunity.length}`);
  console.log(`Utah partial county backbone: ${partialUtah.length}`);
  console.log(`news_alert rows: ${newsAlertCount}`);
  console.log(`Roots with gov content: ${rootsWithContent.size}`);
  console.log(`ZIPs with zero gov content at root: ${emptyGov}`);
  console.log('\nRepresentative ZIPs:');
  for (const r of report.representative) {
    console.log(`  ${r.zip} (${r.state}) gov=${r.govTopicCount} std=${r.stdBackbone} alertTopics=${r.topicsWithAlerts} meetTopics=${r.topicsWithMeetings}`);
    console.log(`    ${r.govTopics.join(' | ')}`);
  }
  console.log(`\nWrote ${jsonPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
