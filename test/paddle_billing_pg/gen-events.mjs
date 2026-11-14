// Builds the Paddle deliveries the suite replays, then feeds each through the REAL adapter path (signature check -> translate) so the database sees exactly what
// the webhook would hand it. Usage: node gen-events.mjs <accounts.tsv> > events.sql   (accounts.tsv: label<TAB>brokerage_uuid)
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const P = await import('../../supabase/functions/_shared/paddle-billing.ts');
const LIVE = 'pdl_ntfset_live_0123456789', SBX = 'pdl_ntfset_sandbox_9876543210';
const PRICE = 'pri_01m7d6kede6hqr2kh9b78mb25j', PRICE_S = 'pri_01sandboxprice0000000000000';
const NOW = 1_800_000_000;
const acct = Object.fromEntries(readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => l.split('\t')));
const hmac = (s, m) => createHmac('sha256', s).update(m).digest('hex');
const rows = [];
let seq = 0;
async function deliver(label, { account, sub, status, at, type = 'subscription.updated', env = 'live', eventId, kind = 'sub', adj = {} }) {
  const secret = env === 'live' ? LIVE : SBX, price = env === 'live' ? PRICE : PRICE_S;
  const id = eventId ?? 'evt_' + String(++seq).padStart(26, '0');
  const bind = account ? await P.paddleBinding(secret, acct[account]) : '';
  const payload = kind === 'sub'
    ? { event_id: id, event_type: type, occurred_at: at, data: { id: sub, status, custom_data: { brokerage_id: acct[account], bind }, items: [{ price: { id: price, product_id: 'pro_1' } }] } }
    : { event_id: id, event_type: 'adjustment.updated', occurred_at: at, data: { id: 'adj_1', action: 'refund', type: 'full', status: 'approved', transaction_id: 'txn_1', subscription_id: sub, ...adj } };
  const raw = JSON.stringify(payload);
  const header = `ts=${NOW};h1=${hmac(secret, NOW + ':' + raw)}`;
  const envName = await P.verifyEnvironment({ live: LIVE, sandbox: SBX }, raw, header, NOW);       // the real signature check decides livemode
  if (envName !== env) throw new Error('signature check disagreed for ' + label);
  const t = await P.translate(JSON.parse(raw), { secret, priceId: price, livemode: envName === 'live' });
  if (t.kind !== 'event' && t.kind !== 'adjustment') throw new Error('not translated: ' + label + ' ' + JSON.stringify(t));
  rows.push({ label, kind: t.kind, brokerage: t.kind === 'event' ? t.brokerageId : null, event: t.event });
}
const T = (d, h = '10:00:00') => `2026-11-${d}T${h}Z`;
// A: an individual buys, renews, cancels
await deliver('a_created', { account: 'ind', sub: 'sub_A', status: 'active', at: T('01'), type: 'subscription.created' });
await deliver('a_created_dup', { account: 'ind', sub: 'sub_A', status: 'active', at: T('01'), type: 'subscription.created', eventId: 'evt_' + String(1).padStart(26, '0') });
await deliver('a_past_due', { account: 'ind', sub: 'sub_A', status: 'past_due', at: T('05'), type: 'subscription.past_due' });
await deliver('a_resumed', { account: 'ind', sub: 'sub_A', status: 'active', at: T('06'), type: 'subscription.updated' });
await deliver('a_canceled', { account: 'ind', sub: 'sub_A', status: 'canceled', at: T('10'), type: 'subscription.canceled' });
// B: out of order (arrives canceled FIRST, then the older active)
await deliver('b_canceled_first', { account: 'brk', sub: 'sub_B', status: 'canceled', at: T('08'), type: 'subscription.canceled' });
await deliver('b_active_late', { account: 'brk', sub: 'sub_B', status: 'active', at: T('02'), type: 'subscription.created' });
// C: refund
await deliver('c_created', { account: 'ref', sub: 'sub_C', status: 'active', at: T('02'), type: 'subscription.created' });
await deliver('c_refund', { sub: 'sub_C', at: T('09'), kind: 'adj' });
await deliver('c_older_active', { account: 'ref', sub: 'sub_C', status: 'active', at: T('04'), type: 'subscription.updated' });
await deliver('c_later_active', { account: 'ref', sub: 'sub_C', status: 'active', at: T('12'), type: 'subscription.updated' });
// D: sandbox
await deliver('d_sandbox', { account: 'sbx', sub: 'sub_D', status: 'active', at: T('02'), type: 'subscription.created', env: 'sandbox' });
// E: allowance + monthly reset (binding backdated by the suite)
await deliver('e_active', { account: 'rst', sub: 'sub_E', status: 'active', at: T('02'), type: 'subscription.created' });
// F: a second brokerage claims sub_A
await deliver('f_conflict', { account: 'other', sub: 'sub_A', status: 'active', at: T('11'), type: 'subscription.updated' });
// G: paused then resumed
await deliver('g_active', { account: 'pau', sub: 'sub_G', status: 'active', at: T('02'), type: 'subscription.created' });
await deliver('g_paused', { account: 'pau', sub: 'sub_G', status: 'paused', at: T('03'), type: 'subscription.paused' });
// H: chargeback
await deliver('h_active', { account: 'chb', sub: 'sub_H', status: 'active', at: T('02'), type: 'subscription.created' });
await deliver('h_chargeback', { sub: 'sub_H', at: T('06'), kind: 'adj', adj: { action: 'chargeback' } });

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
console.log('create temp table _fx (n int, label text primary key, kind text, brokerage uuid, event jsonb);');
rows.forEach((r, i) => console.log(`insert into _fx values (${i + 1}, ${q(r.label)}, ${q(r.kind)}, ${r.brokerage ? q(r.brokerage) + '::uuid' : 'null'}, ${q(JSON.stringify(r.event))}::jsonb);`));
