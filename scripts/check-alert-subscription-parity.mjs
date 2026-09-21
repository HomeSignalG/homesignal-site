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
 *   (the LIVE database half runs in homesignal-ingest, which holds the key)
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
// Strip SQL line comments, so "is this migration executable" cannot be answered by
// the prose that describes it. The repo has already paid for this once: a parked
// migration that reproduced its own writer AS A COMMENT replayed as a no-op while
// looking complete.
const sqlCode = (s) => (s || '').replace(/--[^\n]*/g, '');

export function structuralChecks({ digest, shell, prefs, sqlA6, sqlA8, sqlA9 }) {
  const out = [];
  const t = (cond, msg) => out.push({ ok: !!cond, msg });
  const skip = (msg) => out.push({ ok: true, skip: true, msg });

  // 1. DELIVERY resolves through the canonical view, and carries no private copy
  //    of the eligibility rule.
  //
  //    digest.py lives in the SIBLING repo, so it is only checked when that repo
  //    is actually on disk. The checks are SKIPPED, never silently passed, when
  //    it is absent: three of the four are negative assertions and would pass
  //    vacuously against an empty string -- an absence reading as an answer,
  //    which is the exact failure mode this gate exists to prevent. (It did:
  //    the first CI run reported 3 PASS and 1 FAIL against a file that was not
  //    there.) homesignal-ingest pins its own half in
  //    tests/test_alert_confirmation_contract.py, which is where digest.py is.
  const recip = digest ? (digest.match(/def _recipients\(\)[\s\S]*?\n    return rows/) || [''])[0] : '';
  if (!recip) {
    out.push({ ok: true, skip: true, msg: 'digest.py not on disk — delivery half SKIPPED (pinned in homesignal-ingest)' });
  } else {
    t(/_query\(\s*\n?\s*"digest_recipients"/.test(recip),
      'digest.py::_recipients reads public.digest_recipients');
    t(!/"marketing_consent"\s*:/.test(recip),
      'digest.py::_recipients does not gate on marketing_consent (consent is alert_email_consent now)');
    t(!/"topics"\s*:\s*"not\.is\.null"/.test(recip),
      'digest.py::_recipients does not re-implement the topics gate');
    t(!/_query\(\s*\n?\s*"users"/.test(recip),
      'digest.py::_recipients does not read the users table directly');
  }

  // 2. UI resolves through the same canonical state.
  t(shell && /from\('my_alert_subscriptions'\)/.test(shell),
    'shell.js hydrates deliverable topics from public.my_alert_subscriptions');
  t(shell && /mergeCanonicalWithLocal/.test(shell),
    'shell.js merges canonical-over-local (local can never add a deliverable topic)');
  //    ⚠️ The canonical read must NOT be scoped by ZIP equality. Every live community
  //    is a COUNTY with many ZIPs while users.zip_code holds exactly one of them, so
  //    a resident on a sibling ZIP of their own county would see nothing while
  //    delivery still emails them. Scoped by community, with ZIP only a fallback
  //    inside selectPlaceRows.
  t(shell && /selectPlaceRows/.test(shell)
    && !/my_alert_subscriptions'\)[\s\S]{0,240}\.eq\('zip_code'/.test(shell),
    'shell.js picks the place with selectPlaceRows, never by ZIP equality on the canonical read');

  // 3. app_topic_prefs may survive ONLY as the non-deliverable 'dev' store.
  t(prefs && /DELIVERABLE_CATS/.test(prefs) && /localPrefs\.dev/.test(prefs),
    'lib/topic-prefs.js restricts app-local prefs to the non-deliverable dev category');
  t(prefs && /origin === 'explicit'/.test(prefs),
    "lib/topic-prefs.js counts only origin='explicit' (a follow is never a selection)");

  // 4. No writer may resurrect users.topics as a mutable preference store.
  const writesTopics = [shell, prefs].some(
    (s) => s && /(update|upsert|set)\s*\(?\s*\{[^}]*\btopics\s*:/.test(s));
  t(!writesTopics, 'no front-end writer sets users.topics');


  // 5. THE TOPIC CATALOG MUST STAY A SUPERSET OF WHAT COMMUNITIES OFFER.
  //    A3's (stream, topic) FK turned a previously-silent topic drop into a HARD
  //    ABORT at signup, so a community offering a label the catalog has never seen
  //    makes that topic unselectable. A6 repaired the snapshot; A8 makes the repair
  //    continuous so a community build stays pure data (site CLAUDE.md §0).
  //    Checked as EXECUTABLE statements, never as prose.
  if (sqlA6 == null || sqlA8 == null) {
    skip('a6/a8 SQL of record not on disk — catalog-superset half SKIPPED');
  } else {
    const a6 = sqlCode(sqlA6), a8 = sqlCode(sqlA8);
    t(/insert\s+into\s+public\.alert_topic_catalog/i.test(a6),
      'a6.sql executably inserts into public.alert_topic_catalog');
    t(/government_topics/.test(a6) && !/'City government \(/.test(a6),
      'a6.sql computes the set in the database and transcribes no topic list (claims rule 7)');
    t(/create\s+trigger\s+communities_absorb_offered_topics_ins/i.test(a8)
      && /create\s+trigger\s+communities_absorb_offered_topics_upd/i.test(a8),
      'a8.sql wires BOTH community triggers (insert and update), not just one');
    t(/on\s+conflict\s*\(stream,\s*topic\)\s*do\s+nothing/i.test(a8),
      'a8.sql is additive — ON CONFLICT DO NOTHING, so it can never downgrade an active topic');
    t(/,\s*false\s*$|,\s*false\b/m.test(a8) && !/,\s*true\s*\n\s*from\s+newrows/i.test(a8),
      'a8.sql lands new topics active=false (OFFERABLE is not DELIVERABLE)');
    t(!/raise\s+exception/i.test(a8.split('create trigger')[0] || ''),
      'a8.sql refuses nothing at write time — a blocked community build is worse than the defect');
  }

  // 6. THE LEGACY STORE STAYS FROZEN AND RETAINED (founder mandatory change 1).
  if (sqlA9 == null) {
    skip('a9 SQL of record not on disk — freeze half SKIPPED');
  } else {
    const a9 = sqlCode(sqlA9);
    t(/rename\s+column\s+topics\s+to\s+topics_pre_migration/i.test(a9),
      'a9.sql renames users.topics to users.topics_pre_migration');
    t(!/drop\s+column\s+topics/i.test(a9),
      'a9.sql RETAINS the snapshot — it never drops the column');
    t(/create\s+trigger\s+users_topics_pre_migration_frozen/i.test(a9),
      'a9.sql freezes it with a trigger (a column-privilege revoke stops covering a later column)');
  }

  // 7. The delivery docstring must not name the retired store as the source.
  //    A stale docstring is how the next session writes to a frozen column.
  if (digest == null) {
    skip('digest.py not on disk — docstring half SKIPPED');
  } else {
    const claims = /(reads|from|storage is)[^\n]{0,80}`?users\.topics`?(?!_pre_migration)/i;
    const line = (digest.split('\n').find((l) => claims.test(l) && !/NOT `users\.topics`/.test(l)) || '');
    t(!line, `digest.py does not name users.topics as the store${line ? ` (found: ${line.trim().slice(0, 70)})` : ''}`);
  }

  return out;
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
    shell: "from('my_alert_subscriptions')\nmergeCanonicalWithLocal(a,b)\nselectPlaceRows(rows, o)",
    prefs: "DELIVERABLE_CATS\nlocalPrefs.dev\norigin === 'explicit'",
    sqlA6: 'insert into public.alert_topic_catalog (stream, topic, active)\nselect distinct s.stream, t.topic, false from public.communities c, lateral unnest(c.government_topics) t(topic)\non conflict (stream, topic) do nothing;',
    sqlA8: "create trigger communities_absorb_offered_topics_ins after insert on public.communities\nreferencing new table as newrows for each statement execute function public.alert_catalog_absorb_offered_topics();\ncreate trigger communities_absorb_offered_topics_upd after update on public.communities\nreferencing new table as newrows for each statement execute function public.alert_catalog_absorb_offered_topics();\ninsert into public.alert_topic_catalog (stream, topic, active) select distinct s.stream, t.topic, false\non conflict (stream, topic) do nothing;",
    sqlA9: 'alter table public.users rename column topics to topics_pre_migration;\ncreate trigger users_topics_pre_migration_frozen before insert or update on public.users for each row execute function public.refuse_topics_pre_migration_write();'
  };
  const base = structuralChecks(good);
  if (base.some(r => !r.ok)) { console.log('SELF-TEST FAIL: clean input did not pass'); process.exit(1); }
  const mutations = [
    ['delivery reads users again', { ...good, digest: 'def _recipients():\n    rows = _query(\n        "users",\n        {"topics": "not.is.null", "marketing_consent": "eq.true"},\n    )\n    return rows' }],
    ['UI stops reading canonical',  { ...good, shell: "from('app_topic_prefs')" }],
    ['local prefs can add a deliverable topic', { ...good, prefs: "origin === 'explicit'" }],
    ['a writer resurrects users.topics', { ...good, shell: good.shell + "\n.upsert({ topics: x })" }],
    // The whole point of sqlCode(): prose that DESCRIBES a migration must not pass
    // for the migration. This mutation is the a6 file with every statement commented
    // out -- exactly the shape that replayed as a no-op once before.
    ['a6 becomes comment-only', { ...good, sqlA6: good.sqlA6.split('\n').map(l => '-- ' + l).join('\n') }],
    ['a6 transcribes the topic list instead of computing it', { ...good, sqlA6: "insert into public.alert_topic_catalog (stream, topic, active) values ('notices','City government (Orem)',false);" }],
    ['a8 wires only the insert trigger', { ...good, sqlA8: good.sqlA8.replace(/create trigger communities_absorb_offered_topics_upd[\s\S]*?;\n/, '') }],
    ['a8 starts downgrading active topics', { ...good, sqlA8: good.sqlA8.replace('do nothing', 'do update set active = false') }],
    ['a9 drops the snapshot instead of freezing it', { ...good, sqlA9: 'alter table public.users drop column topics;' }],
    ['a9 loses the freeze trigger', { ...good, sqlA9: 'alter table public.users rename column topics to topics_pre_migration;' }],
    ['digest.py still names users.topics as the store', { ...good, digest: good.digest + "\n# this module reads each recipient's follows from `users.topics` (jsonb)" }]
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
  const sql = (n) => read(join(ROOT, 'docs', `alert-subscription-canonical-${n}.sql`));
  const results = structuralChecks({
    digest: read(join(INGEST, 'digest.py')),
    shell:  read(join(ROOT, 'shell.js')),
    prefs:  read(join(ROOT, 'lib', 'topic-prefs.js')),
    sqlA6:  sql('a6'),
    sqlA8:  sql('a8'),
    sqlA9:  sql('a9')
  });
  for (const r of results) r.skip ? console.log(`SKIP — ${r.msg}`) : (r.ok ? ok : fail)(r.msg);

  console.log(`\n${results.length} structural check(s) run, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
