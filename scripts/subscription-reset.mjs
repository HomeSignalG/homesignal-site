#!/usr/bin/env node
/**
 * Founder-approved subscription reset (2026-07-20).
 * 1) Export backup JSON
 * 2) Delete user_subscriptions, app_topic_prefs, app_follows
 * 3) Clear public.users digest state (delete rows — auth.users preserved)
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { writeFileSync } from 'node:fs';

const SB_URL = (process.env.SUPABASE_URL || 'https://qwnnmljucajnexpxdgxr.supabase.co').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DRY_RUN = process.argv.includes('--dry-run');

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function restGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SB_URL}/rest/v1/${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { ...headers, Prefer: 'count=exact' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

async function paginate(path, select = '*', pageSize = 1000) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const batch = await restGet(path, { select, limit: String(pageSize), offset: String(offset) });
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function restDelete(path, filter) {
  const url = `${SB_URL}/rest/v1/${path}?${filter}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=representation' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DELETE ${path} HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

async function countTable(path, col = 'id') {
  const res = await fetch(`${SB_URL}/rest/v1/${path}?select=${col}&limit=1`, {
    headers: { ...headers, Prefer: 'count=exact' },
  });
  if (!res.ok) return -1;
  const range = res.headers.get('content-range') || '';
  return range.includes('/') ? Number(range.split('/')[1]) : 0;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== SUBSCRIPTION RESET ===');
  console.log('Exporting backup...');

  const backup = {
    exported_at: new Date().toISOString(),
    user_subscriptions: await paginate('user_subscriptions'),
    users: await paginate('users'),
    app_topic_prefs: await paginate('app_topic_prefs'),
    app_follows: await paginate('app_follows'),
  };

  writeFileSync('subscription-backup.json', JSON.stringify(backup, null, 2));
  console.log('Backup written: subscription-backup.json');
  console.log(JSON.stringify({
    user_subscriptions: backup.user_subscriptions.length,
    users: backup.users.length,
    app_topic_prefs: backup.app_topic_prefs.length,
    app_follows: backup.app_follows.length,
  }));

  if (DRY_RUN) {
    console.log('Dry run — no deletes performed.');
    return;
  }

  // Order matters: subs before users (FK).
  console.log('Deleting user_subscriptions...');
  const deletedSubs = await restDelete('user_subscriptions', 'user_id=not.is.null');
  console.log('Deleted user_subscriptions:', deletedSubs.length);

  console.log('Deleting app_topic_prefs...');
  const deletedPrefs = await restDelete('app_topic_prefs', 'user_id=not.is.null');
  console.log('Deleted app_topic_prefs:', deletedPrefs.length);

  console.log('Deleting app_follows...');
  const deletedFollows = await restDelete('app_follows', 'user_id=not.is.null');
  console.log('Deleted app_follows:', deletedFollows.length);

  console.log('Deleting public.users digest identities...');
  const deletedUsers = await restDelete('users', 'id=not.is.null');
  console.log('Deleted public.users:', deletedUsers.length);

  const verify = {
    user_subscriptions: await countTable('user_subscriptions', 'user_id'),
    app_topic_prefs: await countTable('app_topic_prefs', 'user_id'),
    app_follows: await countTable('app_follows', 'id'),
    users: await countTable('users', 'id'),
  };
  console.log('----- VERIFY -----');
  console.log(JSON.stringify(verify, null, 2));

  const ok = verify.user_subscriptions === 0
    && verify.app_topic_prefs === 0
    && verify.app_follows === 0
    && verify.users === 0;

  if (!ok) {
    console.error('VERIFY FAILED — counts not zero');
    process.exit(1);
  }
  console.log('RESET COMPLETE — zero subscriptions, zero topic prefs, zero digest users.');
  console.log('auth.users preserved. alerts/meetings/feeds/email_events/communities untouched.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
