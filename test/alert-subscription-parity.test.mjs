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
if (digest) {
  for (const r of structuralChecks({
    digest,
    shell: read(join(ROOT, 'shell.js')),
    prefs: read(join(ROOT, 'lib', 'topic-prefs.js'))
  })) ok(r.ok, r.msg);
} else {
  console.log('SKIP — homesignal-ingest not checked out; digest.py half not evaluated');
}

// 2) The gate is LOAD-BEARING: each mutation must be caught. A test that only
//    proves the happy path cannot tell a working gate from a disabled one.
const good = {
  digest: 'def _recipients():\n    rows = _query(\n        "digest_recipients",\n        {"select": "id"},\n    )\n    return rows',
  shell: "from('my_alert_subscriptions')\nmergeCanonicalWithLocal(a,b)",
  prefs: "DELIVERABLE_CATS\nlocalPrefs.dev\norigin === 'explicit'"
};
ok(structuralChecks(good).every(r => r.ok), 'clean input passes the gate');
const mutations = {
  'delivery reverts to the users table + old gate':
    { ...good, digest: 'def _recipients():\n    rows = _query(\n        "users",\n        {"topics": "not.is.null", "marketing_consent": "eq.true"},\n    )\n    return rows' },
  'UI stops reading canonical state':
    { ...good, shell: "from('app_topic_prefs')" },
  'a second mutable store can add a deliverable topic':
    { ...good, prefs: "origin === 'explicit'" },
  'a writer resurrects users.topics':
    { ...good, shell: good.shell + "\n.upsert({ topics: x })" }
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
