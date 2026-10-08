// Canonical email-subscription model — the invariants that must not drift.
//
// The architecture this pins: ONE mutable store (public.user_subscriptions),
// ONE resolver (public.alert_subscription_state / is_subscribed), and two
// consumers that both read it — public.digest_recipients for delivery and
// public.my_alert_subscriptions for the UI. These tests fail if a change
// reintroduces a second mutable source or lets the two consumers disagree.
import { structuralChecks } from '../scripts/check-alert-subscription-parity.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`PASS — ${m}`)) : (fail++, console.log(`FAIL — ${m}`)); };
const ROOT = new URL('..', import.meta.url).pathname;
const INGEST = process.env.INGEST_ROOT || join(ROOT, '..', 'homesignal-ingest');
const read = (p) => existsSync(p) ? readFileSync(p, 'utf8') : null;

// 1) The repo as it stands satisfies the contract.
const digest = read(join(INGEST, 'digest.py'));
const sql = (n) => read(join(ROOT, 'docs', `alert-subscription-canonical-${n}.sql`));
if (digest) {
  for (const r of structuralChecks({
    digest,
    shell: read(join(ROOT, 'shell.js')),
    prefs: read(join(ROOT, 'lib', 'topic-prefs.js')),
    sqlA6: sql('a6'),
    sqlA8: sql('a8'),
    sqlA9: sql('a9')
  })) r.skip ? console.log(`SKIP — ${r.msg}`) : ok(r.ok, r.msg);
} else {
  // The SQL-of-record half does not depend on the sibling repo, so it still runs.
  console.log('SKIP — homesignal-ingest not checked out; digest.py half not evaluated');
  for (const r of structuralChecks({
    shell: read(join(ROOT, 'shell.js')),
    prefs: read(join(ROOT, 'lib', 'topic-prefs.js')),
    sqlA6: sql('a6'),
    sqlA8: sql('a8'),
    sqlA9: sql('a9')
  })) r.skip ? console.log(`SKIP — ${r.msg}`) : ok(r.ok, r.msg);
}

// 1b) The SQL of record must exist AS FILES. structuralChecks SKIPs a missing one
//     rather than failing -- correct for a gate that runs in two repos, wrong as the
//     only statement about whether the migration was ever written down. Deleting
//     a6.sql must not read as a clean run.
for (const n of ['a1', 'a2', 'a3', 'a4', 'a6', 'a7', 'a8', 'a9', 'a10']) {
  ok(!!sql(n), `docs/alert-subscription-canonical-${n}.sql is committed`);
}

// 2) The gate is LOAD-BEARING: each mutation must be caught. A test that only
//    proves the happy path cannot tell a working gate from a disabled one.
const good = {
  digest: 'def _recipients():\n    rows = _query(\n        "digest_recipients",\n        {"select": "id"},\n    )\n    return rows',
  shell: "from('my_alert_subscriptions')\nmergeCanonicalWithLocal(a,b)\nselectPlaceRows(rows, o)",
  prefs: "DELIVERABLE_CATS\nlocalPrefs.dev\norigin === 'explicit'",
  sqlA6: 'insert into public.alert_topic_catalog (stream, topic, active)\nselect distinct s.stream, t.topic, false from public.communities c, lateral unnest(c.government_topics) t(topic)\non conflict (stream, topic) do nothing;',
  sqlA8: "create trigger communities_absorb_offered_topics_ins after insert on public.communities\nreferencing new table as newrows for each statement execute function public.alert_catalog_absorb_offered_topics();\ncreate trigger communities_absorb_offered_topics_upd after update on public.communities\nreferencing new table as newrows for each statement execute function public.alert_catalog_absorb_offered_topics();\ninsert into public.alert_topic_catalog (stream, topic, active) select distinct s.stream, t.topic, false\non conflict (stream, topic) do nothing;",
  sqlA9: 'alter table public.users rename column topics to topics_pre_migration;\ncreate trigger users_topics_pre_migration_frozen before insert or update on public.users for each row execute function public.refuse_topics_pre_migration_write();'
};
ok(structuralChecks(good).every(r => r.ok), 'clean input passes the gate');
const mutations = {
  'delivery reverts to the users table + old gate':
    { ...good, digest: 'def _recipients():\n    rows = _query(\n        "users",\n        {"topics": "not.is.null", "marketing_consent": "eq.true"},\n    )\n    return rows' },
  'UI stops reading canonical state':
    { ...good, shell: "from('app_topic_prefs')" },
  'the canonical read goes back to ZIP-equality scoping':
    { ...good, shell: "from('my_alert_subscriptions')\n.eq('zip_code', zip)\nmergeCanonicalWithLocal(a,b)\nselectPlaceRows(r,o)" },
  'a second mutable store can add a deliverable topic':
    { ...good, prefs: "origin === 'explicit'" },
  'a writer resurrects users.topics':
    { ...good, shell: good.shell + "\n.upsert({ topics: x })" },
  // The catalog-superset half. A3's (stream, topic) FK turns an uncatalogued topic
  // into a HARD ABORT at signup, so these are not tidiness checks.
  'the a6 repair becomes prose instead of a migration':
    { ...good, sqlA6: good.sqlA6.split('\n').map(l => '-- ' + l).join('\n') },
  'a6 transcribes a topic list instead of computing it in the database':
    { ...good, sqlA6: "insert into public.alert_topic_catalog (stream, topic, active) values ('notices','City government (Orem)',false);" },
  'a8 wires only one of the two community triggers':
    { ...good, sqlA8: good.sqlA8.replace(/create trigger communities_absorb_offered_topics_upd[\s\S]*?;\n/, '') },
  'a8 starts downgrading an already-deliverable topic':
    { ...good, sqlA8: good.sqlA8.replace('do nothing', 'do update set active = false') },
  'a9 drops the retained snapshot instead of freezing it':
    { ...good, sqlA9: 'alter table public.users drop column topics;' },
  'a9 renames without installing the freeze':
    { ...good, sqlA9: 'alter table public.users rename column topics to topics_pre_migration;' },
  'digest.py goes back to naming users.topics as the store':
    { ...good, digest: good.digest + "\n# this module reads each recipient's follows from `users.topics` (jsonb)" }
};
for (const [name, input] of Object.entries(mutations)) {
  ok(structuralChecks(input).some(r => !r.ok), `gate CATCHES: ${name}`);
}

// 3) The pure helpers enforce the two product rules the UI must not get wrong.
const rows = [
  { stream: 'notices',  topic: 'Elections & voting',                 origin: 'explicit',     sort_order: 2 },
  { stream: 'notices',  topic: 'County Commission & county business', origin: 'explicit',     sort_order: 1 },
  { stream: 'meetings', topic: 'Planning, zoning & development',      origin: 'explicit',     sort_order: 1 },
  { stream: 'notices',  topic: 'Public safety & emergencies',         origin: 'follow_floor', sort_order: 0 }
];
const prefsSrc = readFileSync(join(ROOT, 'lib', 'topic-prefs.js'), 'utf8');
globalThis.window = { HS: {} };
new Function(prefsSrc)();
const util = globalThis.window.HS.topicPrefsUtil;

const p = util.topicPrefsFromCanonicalRows(rows);
ok(p.gov.topics.length === 2, 'a follow_floor row is NOT shown as a chosen topic');
ok(p.gov.topics[0] === 'County Commission & county business',
   'topics render in stored order (sort_order), the order the digest uses');
ok(p.meetings.topics.length === 1 && p.gov.topics.indexOf('Planning, zoning & development') < 0,
   'notices and meetings stay INDEPENDENT — never collapsed into one answer');

const merged = util.mergeCanonicalWithLocal(
  { gov: { topics: ['a'] } },
  { gov: { topics: ['STALE'] }, dev: { topics: ['d'] } });
ok(merged.gov.topics[0] === 'a', 'canonical beats a stale local cache for deliverable categories');
ok(merged.dev.topics[0] === 'd', "the non-deliverable 'dev' category still comes from app-local prefs");


// 4) selectPlaceRows — the place-picking rule, which is where a resident can lose
//    topics they actually have. Every community in production is a COUNTY with many
//    ZIPs (Travis 85, Box Elder 18) and users.zip_code holds exactly one of them.
const placeRows = [
  { community_id: 'box-elder', zip_code: '84302', stream: 'notices',  topic: 'Elections & voting',                 origin: 'explicit', sort_order: 1 },
  { community_id: 'box-elder', zip_code: '84302', stream: 'meetings', topic: 'Planning, zoning & development',      origin: 'explicit', sort_order: 1 },
  { community_id: 'travis',    zip_code: '78617', stream: 'notices',  topic: 'County Commission & county business', origin: 'explicit', sort_order: 1 }
];
const topicsOf = (rs) => rs.map(r => r.topic).sort().join('|');
const util2 = globalThis.window.HS.topicPrefsUtil;
ok(topicsOf(util2.selectPlaceRows(placeRows, { communityId: 'box-elder', zip: '84312' }))
   === 'Elections & voting|Planning, zoning & development',
   'the resolved community wins — a SIBLING ZIP of the same county still shows its topics');
ok(topicsOf(util2.selectPlaceRows(placeRows, { communityId: null, zip: '78617' }))
   === 'County Commission & county business',
   'when the community cannot be resolved, an exact ZIP match still identifies the place');
ok(topicsOf(util2.selectPlaceRows(placeRows.slice(0, 2), { communityId: null, zip: '84312' }))
   === 'Elections & voting|Planning, zoning & development',
   'one place on file: no lookup needed, nothing is hidden by a failed resolution');
ok(util2.selectPlaceRows(placeRows, { communityId: null, zip: '84312' }).length === 0,
   'several places and none identified: show NOTHING rather than another place\'s topics');
ok(util2.selectPlaceRows([], { communityId: 'box-elder', zip: '84302' }).length === 0,
   'no rows in, no rows out');
ok(topicsOf(util2.selectPlaceRows(placeRows, { communityId: 'not-a-community', zip: '84302' }))
   === 'Elections & voting|Planning, zoning & development',
   'a STALE community id falls through to the ZIP rather than returning empty');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
