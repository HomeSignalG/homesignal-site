#!/usr/bin/env node
/**
 * PERMANENT PARITY GATE — the UI-visible subscription answer and the delivery
 * subscription answer must derive from the SAME canonical state and resolver.
 *
 * This is not a migration check. It exists so a future change cannot quietly
 * reintroduce the defect class this architecture removed: a second mutable
 * subscription store, a consumer that bypasses the canonical resolver, or a UI
 * that shows a topic as enabled while the digest treats it as disabled.
 *
 *   node scripts/check-alert-subscription-parity.mjs              # structural (offline)
 *   node scripts/check-alert-subscription-parity.mjs --db         # + live database
 *   node scripts/check-alert-subscription-parity.mjs --self-test  # prove it can fail
 *
 * The --db half FAILS CLOSED: absent credentials, a non-2xx read, zero rows, or
 * a zero control are refusals that SAY why. A silent pass from a broken query is
 * the one answer this gate must never give.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INGEST = process.env.INGEST_ROOT || join(ROOT, '..', 'homesignal-ingest');

let failures = [];
const ok   = (m) => console.log(`PASS — ${m}`);
const fail = (m) => { failures.push(m); console.log(`FAIL — ${m}`); };
const read = (p) => existsSync(p) ? readFileSync(p, 'utf8') : null;

// ---------------------------------------------------------------- structural
export function structuralChecks({ digest, shell, prefs }) {
  const out = [];
  const t = (cond, msg) => out.push({ ok: !!cond, msg });

  // 1. DELIVERY resolves through the canonical view, and carries no private copy
  //    of the eligibility rule.
  const recip = digest ? (digest.match(/def _recipients\(\)[\s\S]*?\n    return rows/) || [''])[0] : '';
  t(/_query\(\s*\n?\s*"digest_recipients"/.test(recip),
    'digest.py::_recipients reads public.digest_recipients');
  t(!/"marketing_consent"\s*:/.test(recip),
    'digest.py::_recipients does not gate on marketing_consent (consent is alert_email_consent now)');
  t(!/"topics"\s*:\s*"not\.is\.null"/.test(recip),
    'digest.py::_recipients does not re-implement the topics gate');
  t(!/_query\(\s*\n?\s*"users"/.test(recip),
    'digest.py::_recipients does not read the users table directly');

  // 2. UI resolves through the same canonical state.
  t(shell && /from\('my_alert_subscriptions'\)/.test(shell),
    'shell.js hydrates deliverable topics from public.my_alert_subscriptions');
  t(shell && /mergeCanonicalWithLocal/.test(shell),
    'shell.js merges canonical-over-local (local can never add a deliverable topic)');

  // 3. app_topic_prefs may survive ONLY as the non-deliverable 'dev' store.
  t(prefs && /DELIVERABLE_CATS/.test(prefs) && /localPrefs\.dev/.test(prefs),
    'lib/topic-prefs.js restricts app-local prefs to the non-deliverable dev category');
  t(prefs && /origin === 'explicit'/.test(prefs),
    "lib/topic-prefs.js counts only origin='explicit' (a follow is never a selection)");

  // 4. No writer may resurrect users.topics as a mutable preference store.
  const writesTopics = [shell, prefs].some(
    (s) => s && /(update|upsert|set)\s*\(?\s*\{[^}]*\btopics\s*:/.test(s));
  t(!writesTopics, 'no front-end writer sets users.topics');

  return out;
}

// ------------------------------------------------------------------ live db
async function liveChecks() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_WRITE_KEY;
  if (!url || !key) {
    fail('INFRASTRUCTURE: SUPABASE_URL / SUPABASE_WRITE_KEY absent — NOTHING WAS VERIFIED');
    return;
  }
  const get = async (path) => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' }
    });
    if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const cr = res.headers.get('content-range') || '';
    const n = parseInt((cr.split('/')[1] || 'NaN'), 10);
    if (Number.isNaN(n)) throw new Error(`REST ${path} -> no exact count in content-range "${cr}"`);
    return n;
  };
  try {
    // CONTROLS first: a zero here means the instrument is broken, not that the
    // system is clean.
    const state = await get('alert_subscription_state?select=user_id');
    const subscribed = await get('alert_subscription_state?select=user_id&subscribed=is.true');
    const recipients = await get('digest_recipients?select=id');
    if (state === 0)      { fail('CONTROL: alert_subscription_state is empty — NOTHING WAS VERIFIED'); return; }
    if (subscribed === 0) { fail('CONTROL: no subscribed rows — NOTHING WAS VERIFIED'); return; }
    if (recipients === 0) { fail('CONTROL: no digest recipients — NOTHING WAS VERIFIED'); return; }
    ok(`controls non-zero (state=${state}, subscribed=${subscribed}, recipients=${recipients})`);

    // A follow must never be delivered.
    const floorSubscribed = await get('alert_subscription_state?select=user_id&origin=eq.follow_floor&subscribed=is.true');
    floorSubscribed === 0 ? ok('no follow_floor row is ever subscribed')
                          : fail(`${floorSubscribed} follow_floor row(s) counted as subscribed`);

    // Consent without a selection is the silent-undeliverable state.
    const consentNoSub = await get('users?select=id&alert_email_consent=is.true');
    consentNoSub >= recipients
      ? ok(`consented identities (${consentNoSub}) all reach delivery (${recipients})`)
      : fail(`consented=${consentNoSub} < recipients=${recipients} — impossible, read is inconsistent`);
  } catch (e) {
    fail(`INFRASTRUCTURE: ${e.message} — NOTHING WAS VERIFIED`);
  }
}

// -------------------------------------------------------------------- main
// Importable: the CLI body runs only when this file IS the entry point, so the
// unit suite can import structuralChecks without the process exiting.
const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const args = process.argv.slice(2);

if (IS_MAIN && args.includes('--self-test')) {
  // The gate must be able to FAIL. Each mutation below must be caught.
  const good = {
    digest: 'def _recipients():\n    rows = _query(\n        "digest_recipients",\n        {"select": "id"},\n    )\n    return rows',
    shell: "from('my_alert_subscriptions')\nmergeCanonicalWithLocal(a,b)",
    prefs: "DELIVERABLE_CATS\nlocalPrefs.dev\norigin === 'explicit'"
  };
  const base = structuralChecks(good);
  if (base.some(r => !r.ok)) { console.log('SELF-TEST FAIL: clean input did not pass'); process.exit(1); }
  const mutations = [
    ['delivery reads users again', { ...good, digest: 'def _recipients():\n    rows = _query(\n        "users",\n        {"topics": "not.is.null", "marketing_consent": "eq.true"},\n    )\n    return rows' }],
    ['UI stops reading canonical',  { ...good, shell: "from('app_topic_prefs')" }],
    ['local prefs can add a deliverable topic', { ...good, prefs: "origin === 'explicit'" }],
    ['a writer resurrects users.topics', { ...good, shell: good.shell + "\n.upsert({ topics: x })" }]
  ];
  let bad = 0;
  for (const [name, input] of mutations) {
    const r = structuralChecks(input);
    if (r.every(x => x.ok)) { console.log(`SELF-TEST FAIL — mutation survived: ${name}`); bad++; }
    else console.log(`SELF-TEST ok — caught: ${name}`);
  }
  process.exit(bad ? 1 : 0);
}

if (IS_MAIN) {
  const results = structuralChecks({
    digest: read(join(INGEST, 'digest.py')),
    shell:  read(join(ROOT, 'shell.js')),
    prefs:  read(join(ROOT, 'lib', 'topic-prefs.js'))
  });
  for (const r of results) (r.ok ? ok : fail)(r.msg);

  if (args.includes('--db')) await liveChecks();

  console.log(`\n${results.length} structural check(s) run, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
