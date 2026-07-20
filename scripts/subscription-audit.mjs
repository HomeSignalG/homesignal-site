#!/usr/bin/env node
/**
 * Read-only subscription database audit.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
 * Outputs JSON sections to stdout for operator review.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SB_URL = (process.env.SUPABASE_URL || 'https://qwnnmljucajnexpxdgxr.supabase.co').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'subscription-audit.sql');
const sql = readFileSync(sqlPath, 'utf8');

// Split on section headers; each block is one or more statements ending before next section comment.
const blocks = sql.split(/^-- ={10,}/m).map((b) => b.trim()).filter(Boolean);

async function runQuery(query) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`RPC exec_sql HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function restGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SB_URL}/rest/v1/${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: 'count=exact',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} HTTP ${res.status}: ${text.slice(0, 500)}`);
  const range = res.headers.get('content-range') || '';
  const total = range.includes('/') ? Number(range.split('/')[1]) : null;
  return { data: text ? JSON.parse(text) : [], total };
}

const UNIVERSAL_TOPICS = [
  'Water Quality', 'Air Quality', 'Soil Quality',
  'Animal & Human Viruses / Diseases', 'Infrastructure', 'EMF',
  'Noise Pollution', 'Light Pollution', 'Livestock, Crops, Pets & Wildlife Health',
  'Weather & Climate Hazards', 'Radiation', 'Data Centers',
];
const VALID_PIPELINES = new Set([
  'government_notice', 'news_alert', 'emerging_technology', 'global_best_practices',
  'permit_filing', 'news', // legacy aliases seen in older rows
]);
const TEST_RE = /(^demo@|@homesignal\.net$|@example\.com$|@test\.|test@|mailinator|yopmail|tempmail|\+test)/i;
const KNOWN = {
  'sdsutca@proton.me': 'founder_doc_ref',
  'cheryltownsend2525@gmail.com': 'reconnect_doc_ref',
};

function isTest(email) {
  const e = String(email || '').toLowerCase();
  return TEST_RE.test(e) || e === 'demo@homesignal.net';
}

async function paginate(path, select, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data } = await restGet(path, {
      select,
      limit: String(pageSize),
      offset: String(offset),
    });
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function listAuthUsers() {
  const rows = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`auth admin users HTTP ${res.status}: ${text.slice(0, 300)}`);
      return rows;
    }
    const body = JSON.parse(text);
    const batch = body.users || [];
    rows.push(...batch.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at })));
    if (batch.length < 200) break;
    page += 1;
  }
  return rows;
}

async function main() {
  const [users, subs, communities, emailEvents, appFollows, appTopicPrefs, authUsers, dashAdmins] = await Promise.all([
    paginate('users', '*'),
    paginate('user_subscriptions', '*'),
    paginate('communities', 'id,name,state,zip_codes,government_topics'),
    paginate('email_events', '*').catch(() => []),
    paginate('app_follows', 'user_id,target_type,target_id,created_at'),
    paginate('app_topic_prefs', 'user_id,category,topics,updated_at'),
    listAuthUsers(),
    paginate('dashboard_admins', 'email,note,added_at').catch(() => []),
  ]);

  const liveZips = new Set();
  const govTopics = new Set();
  const commById = new Map();
  for (const c of communities) {
    commById.set(c.id, c);
    for (const z of c.zip_codes || []) liveZips.add(z);
    for (const t of c.government_topics || []) govTopics.add(t);
  }
  const canonicalTopics = new Set([...UNIVERSAL_TOPICS, ...govTopics]);

  const authById = new Map((authUsers || []).map((u) => [u.id, u]));
  const authEmailById = new Map((authUsers || []).map((u) => [u.id, (u.email || '').toLowerCase()]));

  const lastEmail = new Map();
  for (const ev of emailEvents) {
    const e = (ev.user_email || ev.email || '').toLowerCase();
    if (!e) continue;
    const kind = ev.status || ev.event_type;
    if (!['sent', 'delivered'].includes(kind)) continue;
    const ts = ev.created_at;
    if (!lastEmail.has(e) || ts > lastEmail.get(e)) lastEmail.set(e, ts);
  }

  const subsByUser = new Map();
  for (const s of subs) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id).push(s);
  }

  const usersByEmail = new Map();
  for (const u of users) {
    const e = (u.email || '').toLowerCase();
    if (!usersByEmail.has(e)) usersByEmail.set(e, []);
    usersByEmail.get(e).push(u);
  }

  const appFollowsByAuth = new Map();
  for (const f of appFollows) {
    if (f.target_type !== 'community') continue;
    const email = authEmailById.get(f.user_id);
    if (!email) continue;
    if (!appFollowsByAuth.has(email)) appFollowsByAuth.set(email, new Set());
    appFollowsByAuth.get(email).add(f.target_id);
  }

  const appPrefsByAuth = new Map();
  for (const p of appTopicPrefs) {
    const email = authEmailById.get(p.user_id);
    if (!email) continue;
    if (!appPrefsByAuth.has(email)) appPrefsByAuth.set(email, {});
    appPrefsByAuth.get(email)[p.category] = p.topics;
  }

  const report = [];
  const allEmails = new Set([...usersByEmail.keys()]);
  for (const [id, au] of authById) {
    if (au.email) allEmails.add(au.email.toLowerCase());
  }

  for (const email of [...allEmails].sort()) {
    const digestRows = usersByEmail.get(email) || [];
    const userIds = digestRows.map((u) => u.id);
    const zips = new Set();
    const states = new Set();
    const topics = new Set();
    const topicPairs = new Set();
    const pipelines = new Set();
    let subCount = 0;
    let active = digestRows.length === 0;
    let marketingConsent = false;
    let firstCreated = null;
    let lastCreated = null;
    const communityNames = new Set();

    for (const u of digestRows) {
      if (!u.unsubscribed) active = true;
      if (u.marketing_consent) marketingConsent = true;
      if (u.zip_code) zips.add(u.zip_code);
      const c = commById.get(u.community_id);
      if (c?.state) states.add(c.state);
      if (c?.name) communityNames.add(c.name);
      if (!firstCreated || u.created_at < firstCreated) firstCreated = u.created_at;
      if (!lastCreated || u.created_at > lastCreated) lastCreated = u.created_at;
      for (const s of subsByUser.get(u.id) || []) {
        subCount++;
        if (s.topic) topics.add(s.topic);
        topicPairs.add(`${s.pipeline_type}::${s.topic}`);
        pipelines.add(s.pipeline_type);
      }
    }

    const appZips = appFollowsByAuth.get(email) || new Set();
    for (const z of appZips) zips.add(z);

    const authRow = [...authById.values()].find((u) => (u.email || '').toLowerCase() === email);
    report.push({
      email,
      user_id: userIds[0] || authRow?.id || null,
      user_ids: userIds,
      zips: [...zips].sort(),
      states: [...states].sort(),
      topics: [...topics].sort(),
      topic_pairs: [...topicPairs].sort(),
      pipelines: [...pipelines].sort(),
      subscription_rows: subCount,
      active: digestRows.length ? active : null,
      marketing_consent: marketingConsent,
      last_email_sent: lastEmail.get(email) || null,
      first_created: firstCreated,
      last_created: lastCreated,
      auth_created: authRow?.created_at || null,
      community_names: [...communityNames].sort(),
      app_topic_prefs: appPrefsByAuth.get(email) || null,
      test_account: isTest(email),
      known_account_tag: KNOWN[email] || null,
      digest_identity_rows: digestRows.length,
      has_digest: digestRows.length > 0,
      has_auth: !!authRow,
    });
  }

  const dupSubs = [];
  const seen = new Map();
  for (const s of subs) {
    const k = `${s.user_id}|${s.community_id}|${s.pipeline_type}|${s.topic}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const [k, cnt] of seen) {
    if (cnt > 1) dupSubs.push({ key: k, count: cnt });
  }

  const orphanSubs = subs.filter((s) => !users.some((u) => u.id === s.user_id));
  const digestNoSubs = users.filter((u) => !(subsByUser.get(u.id)?.length));
  const appOnly = [...authById.values()].filter((au) => au.email && !usersByEmail.has(au.email.toLowerCase()));

  const invalidTopics = subs.filter((s) => s.topic && !canonicalTopics.has(s.topic)).map((s) => {
    const u = users.find((x) => x.id === s.user_id);
    const c = commById.get(s.community_id);
    return {
      email: (u?.email || '').toLowerCase(),
      topic: s.topic,
      pipeline_type: s.pipeline_type,
      community_name: c?.name,
    };
  });

  const invalidPipelines = subs.filter((s) => !VALID_PIPELINES.has(s.pipeline_type));
  const invalidDigestZips = users.filter((u) => u.zip_code && !liveZips.has(u.zip_code));
  const invalidAppZips = appFollows.filter((f) => f.target_type === 'community' && !liveZips.has(f.target_id));
  const topicMismatch = subs.filter((s) => {
    if (s.pipeline_type !== 'government_notice' || !s.topic) return false;
    const c = commById.get(s.community_id);
    return !(c?.government_topics || []).includes(s.topic);
  }).map((s) => {
    const u = users.find((x) => x.id === s.user_id);
    const c = commById.get(s.community_id);
    return { email: (u?.email || '').toLowerCase(), topic: s.topic, community_name: c?.name };
  });

  const out = {
    generated_at: new Date().toISOString(),
    table_counts: {
      public_users: users.length,
      public_users_distinct_emails: usersByEmail.size,
      user_subscriptions: subs.length,
      auth_users: authUsers.length,
      app_follows: appFollows.length,
      app_topic_prefs: appTopicPrefs.length,
      email_events: emailEvents.length,
    },
    main_report: report,
    app_only_no_digest: appOnly.map((au) => ({
      email: au.email.toLowerCase(),
      auth_user_id: au.id,
      auth_created: au.created_at,
    })),
    digest_no_subscriptions: digestNoSubs.map((u) => ({
      email: u.email.toLowerCase(),
      user_id: u.id,
      zip_code: u.zip_code,
      community_name: commById.get(u.community_id)?.name,
      marketing_consent: u.marketing_consent,
      unsubscribed: u.unsubscribed,
    })),
    duplicate_subscriptions: dupSubs,
    orphan_subscriptions: orphanSubs,
    invalid_topics: invalidTopics,
    invalid_pipelines: invalidPipelines,
    invalid_digest_zips: invalidDigestZips,
    invalid_app_follow_zips: invalidAppZips,
    topic_community_mismatch: topicMismatch,
    dashboard_admins: dashAdmins,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
