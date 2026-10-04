// BILLING — the structural half (Development Activity build step 11). The executable halves are test/brokerage_billing_pg (the real SQL against a
// disposable Postgres, with real concurrent sessions), test/lemon-billing.test.mjs (the processor's shapes), test/billing-functions.test.mjs (the two
// functions and the plan reads), test/national-report-function.test.mjs (the report function's plan handling) and
// test/development-activity-reports.browser.test.mjs §12 (the Billing card in Chromium). What none of them can see is the SHAPE that keeps billing
// from becoming a second way to decide who is paid, a place a payer can leak from, or a door a buyer can walk through:
//   * the SQL: two tables and no column that could hold a person or a price; the cap of 100 is a CONSTRAINT; one owner for the number 100; the
//     system alone can run any of it; one way to charge the paid month; the six ownership readers read the ONE view;
//   * the edge: the plan is read in ONE module and the processor's shapes live in ONE module; the secret and the keys are read from the environment in
//     the two index files alone; the webhook checks the signature of the RAW body BEFORE it parses it, refuses everything when it is not set up, and
//     names no table of the map product; checkout is the OWNER's, for the brokerage the DATABASE names, over no live subscription;
//   * the page: it names no id, sends the browser only to an https address on the provider's domain, and the landing page's buttons are still inert
//     (they go live in build step 13);
//   * the wiring: the deploy workflow, config, CI and the written record exist.
// Pinned on COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/billing-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const count = (s, re) => (s.match(re) || []).length;
function sqlFn(sql, name) {
  const i = sql.search(new RegExp('create or replace function public\\.' + name + '\\('));
  if (i < 0) return '';
  const rest = sql.slice(i);
  const open = /\bas\s+\$(\w*)\$/.exec(rest);
  if (!open) return '';
  const tag = '$' + open[1] + '$';
  const end = rest.indexOf(tag, open.index + open[0].length);
  return end < 0 ? '' : rest.slice(0, end + tag.length);
}
const walk = (dir, out = []) => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const f of readdirSync(abs)) { const p = join(abs, f); if (f === 'node_modules' || f === '.git') continue; if (statSync(p).isDirectory()) walk(join(dir, f), out); else out.push(relative(ROOT, p)); }
  return out;
};

// ---- 1. the billing SQL ---------------------------------------------------------------------------------------------------------------------
const RAW = read('docs/brokerage-billing.sql');
const SQL = stripSql(RAW);
const SQL_NS = SQL.replace(/'(?:[^']|'')*'/g, "''");
const FUNCS = ['billing_report_limit', 'billing_append_only', 'billing_period_index', 'billing_period_end', 'brokerage_paid_credit_guard', 'billing_plan_of', 'billing_event_apply',
  'billing_usage', 'billing_paid_issue', 'brokerage_report_issue', 'billing_check'];
ok(SQL.length > 15000 && FUNCS.every((f) => new RegExp('create or replace function public\\.' + f + '\\(').test(SQL)), '1a the SQL of record defines the eleven functions (positive control)');
ok(count(SQL, /create table if not exists public\.\w+/g) === 2 && count(SQL, /create or replace function/g) === 11 && count(SQL, /create or replace view public\.evaluation_credit_all\b/g) === 1
   && count(SQL, /create (type|policy|sequence|extension|materialized view)\b/gi) === 0,
  '1b it creates exactly two tables, one view and eleven functions: no type, policy, sequence or extension');
ok(!/cron\.schedule|net\.http_|vault\./i.test(SQL_NS), '1c and schedules nothing and calls nothing: no job, no HTTP, no vault (the processor reaches it only through the webhook)');

const tableCols = (name) => {
  const m = new RegExp('create table if not exists public\\.' + name + ' \\(([\\s\\S]*?)\\n\\);').exec(SQL);
  return m ? m[1].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c) && !['constraint', 'check', 'unique', 'primary', 'foreign'].includes(c)) : [];
};
const SUB = tableCols('brokerage_subscription'), PAID = tableCols('brokerage_paid_credit');
ok(JSON.stringify(SUB) === '["binding_id","brokerage_id","processor","subscription_ref","livemode","bound_at"]'
   && JSON.stringify(PAID) === '["binding_id","brokerage_id","period_index","ordinal","number","idempotency_key","report_id","issued_at"]',
  '1d the two tables hold exactly these columns: ids, the processor\'s opaque subscription reference, a mode, a month and times — nothing a person or a price could fit in', [SUB, PAID].map((x) => x.join()).join(' | '));
ok([...SUB, ...PAID].every((c) => !/email|name|card|address|customer|price|amount|plan_name|phone|note|text|payload|json|detail/i.test(c)),
  '1e no column of either table could hold a payer\'s email, name, card, address, customer, price or free text (the founder\'s rule: customer context never enters an immutable table)');
ok(/constraint brokerage_paid_credit_pkey\s+primary key \(binding_id, period_index, ordinal\)/.test(SQL) && /check \(ordinal between 1 and public\.billing_report_limit\(\)\)/.test(SQL)
   && /constraint brokerage_subscription_unique\s+unique \(processor, livemode, subscription_ref\)/.test(SQL) && /constraint brokerage_paid_credit_report_unique\s+unique \(report_id\)/.test(SQL)
   && /constraint brokerage_paid_credit_key_unique\s+unique \(brokerage_id, idempotency_key\)/.test(SQL) && /constraint brokerage_paid_credit_number\s+check \(number > public\.evaluation_report_limit\(\)\)/.test(SQL),
  '1f the cap of 100 a month, one binding per subscription, one report per credit, one credit per key and a number above the free 20 are CONSTRAINTS of the tables, not counts that a writer could skip');
ok(/create or replace function public\.billing_report_limit\(\) returns integer\s+language sql immutable as \$\$ select 100 \$\$;/.test(SQL) && count(SQL_NS, /\b100\b/g) === 2
   && /if public\.billing_report_limit\(\) <> 100 then/.test(SQL),
  '1g the number 100 is DEFINED once in executable SQL (billing_report_limit) and every other place asks the function; its one other appearance is the post-condition that refuses to apply if the definition is not the founder\'s 100');
{
  const trig = sqlFn(SQL, 'brokerage_paid_credit_guard');
  ok(/new\.period_index := public\.billing_period_index\(/.test(trig) && /raise exception/.test(trig),
    '1h the month a paid credit belongs to is STAMPED by a trigger from the binding and the clock, so no writer can name another month to get another 100');
}
ok(count(SQL, /\balter\s+table\s+public\.(brokerage_subscription|brokerage_paid_credit)\s+enable row level security;/g) === 2
   && count(SQL, /revoke all on public\.(brokerage_subscription|brokerage_paid_credit|evaluation_credit_all)\s+from public, anon, authenticated, service_role;/g) === 3
   && count(SQL, /create policy/gi) === 0,
  '1i both tables have RLS on and no policy, and every privilege on the two tables and the view is revoked from public, anon, authenticated AND service_role');
{
  const grants = [...SQL.matchAll(/grant execute on function public\.(\w+)\(([^)]*)\)\s+to (\w+(?:, \w+)*);/g)].map((m) => m[1] + '->' + m[3]);
  ok(JSON.stringify(grants.sort()) === JSON.stringify(['billing_check->service_role', 'billing_event_apply->service_role', 'billing_period_end->service_role', 'billing_period_index->service_role',
    'billing_plan_of->service_role', 'billing_report_limit->service_role', 'billing_usage->service_role', 'brokerage_report_issue->service_role'].sort()) && !/grant[^;]*\sto\s[^;]*\b(anon|authenticated|public)\b/i.test(SQL_NS.replace(/revoke[^;]*;/gi, '')),
    '1j exactly eight functions are executable, by service_role alone: not the trigger functions, and not the helper that charges the paid month (billing_paid_issue)', grants.join());
}
{
  const definers = FUNCS.filter((f) => /security definer/i.test(sqlFn(SQL, f)));
  ok(JSON.stringify(definers.sort()) === JSON.stringify(['billing_check', 'billing_event_apply', 'billing_paid_issue', 'billing_plan_of', 'billing_usage', 'brokerage_report_issue'])
     && definers.every((f) => /set search_path = public, pg_temp/.test(sqlFn(SQL, f))),
    '1k every function that reads or writes a table is SECURITY DEFINER with a pinned search_path (six), and the pure and trigger functions are not', definers.join());
}
{
  const issue = sqlFn(SQL, 'brokerage_report_issue');
  ok(count(SQL.replace(/revoke[^;]*;/gi, ''), /public\.billing_paid_issue\(/g) === 2 && count(issue, /public\.billing_paid_issue\(/g) === 1 && !/\bgrant\s[^;]*billing_paid_issue/i.test(SQL),
    '1l there is ONE way to charge the paid month: billing_paid_issue is called from brokerage_report_issue alone, and is granted to nobody');
  ok(/transaction_isolation[\s\S]{0,80}read committed/.test(issue) && /for update/.test(issue) && /IDEMPOTENCY_KEY_REQUIRED/.test(issue)
     && issue.indexOf('from public.brokerage_paid_credit c where c.brokerage_id') < issue.indexOf('billing_plan_of(m.brokerage_id)'),
    '1m the issuing entry refuses a transaction above READ COMMITTED, locks the evaluation row, requires a key, and answers a retried key from the paid ledger BEFORE it asks the plan');
  const plan = sqlFn(SQL, 'billing_plan_of');
  ok(/when not b\.livemode then 'test_only'/.test(plan) && /when e\.mapped_status = 'active' then 'paid'/.test(plan) && count(plan, /'paid'/g) === 1 && /payment_event_latest_id\(/.test(plan)
     && /a\.status = 'active'/.test(plan) && !/\bupdate\b|\binsert\b|\bdelete\b/i.test(plan),
    '1n a plan is PAID only when the latest LIVE event of the brokerage\'s own binding maps to active (the ledger\'s ordering and mapping, asked and never re-derived); a test binding is test_only; nothing is stored or written');
  const apply = sqlFn(SQL, 'billing_event_apply');
  ok(/pg_advisory_xact_lock\(/.test(apply) && /BINDING_CONFLICT/.test(apply) && count(apply, /public\.payment_event_record\(/g) === 1 && apply.indexOf('BINDING_CONFLICT') < apply.indexOf('payment_event_record('),
    '1o the webhook\'s writer serialises calls for one subscription, refuses a subscription that belongs to another brokerage BEFORE it records anything, and records through the ledger\'s one writer, once');
}
{
  // the splice: six readers, from the live bodies, anchor-counted, fail closed
  ok(/do \$splice\$/.test(SQL) && /public\.evaluation_credit_all\b/.test(SQL) && count(SQL, /pg_get_functiondef\(/g) >= 1 && /exactly once|ANCHOR/i.test(RAW) && /raise exception/.test(SQL.slice(SQL.indexOf('do $splice$'))),
    '1p the six ownership readers are re-pointed at the ONE view by a splice computed from their LIVE definitions (never retyped), which refuses unless its anchor appears exactly once');
  const rb = RAW.slice(RAW.indexOf('ROLLBACK'));
  ok(/ROLLBACK-BEGIN/.test(RAW) && /ROLLBACK-END/.test(RAW) && /drop table if exists public\.brokerage_paid_credit/.test(RAW) && /drop table if exists public\.brokerage_subscription/.test(RAW) && rb.length > 200,
    '1q the rollback is written at the foot of the file: it re-points the readers back at the free ledger, then drops what the file made');
}

// ---- 2. the edge ------------------------------------------------------------------------------------------------------------------------------
const FN = 'supabase/functions';
const BR = read(FN + '/_shared/billing-reads.ts'), LB = read(FN + '/_shared/lemon-billing.ts');
const MB = { index: read(FN + '/manage-billing/index.ts'), data: read(FN + '/manage-billing/data.ts'), handler: read(FN + '/manage-billing/handler.ts') };
const WB = { index: read(FN + '/development-activity-billing-webhook/index.ts'), data: read(FN + '/development-activity-billing-webhook/data.ts'), handler: read(FN + '/development-activity-billing-webhook/handler.ts') };
ok([BR, LB, ...Object.values(MB), ...Object.values(WB)].every((t) => t.length > 500), '2-control: the two shared modules and the two functions are all found');
{
  const fnFiles = walk(FN).filter((f) => /\.(ts|js|mjs)$/.test(f));
  const naming = (re) => fnFiles.filter((f) => re.test(stripJs(read(f)))).sort();
  ok(JSON.stringify(naming(/\bbilling_usage\b/)) === JSON.stringify([FN + '/_shared/billing-reads.ts']) && JSON.stringify(naming(/\bbilling_event_apply\b/)) === JSON.stringify([FN + '/_shared/billing-reads.ts']),
    '2a ONE module asks the database for a plan and ONE module records an event: billing_usage and billing_event_apply are named in _shared/billing-reads.ts and nowhere else in any edge function');
  ok(JSON.stringify(naming(/rpc\('brokerage_report_issue'/)) === JSON.stringify([FN + '/_shared/report-snapshot.ts']) && JSON.stringify(naming(/\bbilling_plan_of\b|\bbilling_paid_issue\b|\bbrokerage_subscription\b|\bbrokerage_paid_credit\b|\bevaluation_credit_all\b/)) === '[]',
    '2b the report is charged only through brokerage_report_issue, called from the one snapshot module; no edge function names the plan function, the paid helper, the binding, the paid ledger or the ownership view');
  ok(JSON.stringify(naming(/lemonsqueezy/i)) === JSON.stringify([FN + '/_shared/lemon-billing.ts', FN + '/development-activity-billing-webhook/index.ts', FN + '/manage-billing/index.ts'].sort()),
    '2c the processor is named in the one shared module (and, as environment variable names, in the two index files): the handlers, the data layers and every other function know no processor word', naming(/lemonsqueezy/i).join());
  const envReaders = fnFiles.filter((f) => /Deno\.env\.get\('(LEMONSQUEEZY_[A-Z_]+)'\)/.test(read(f))).sort();
  ok(JSON.stringify(envReaders) === JSON.stringify([FN + '/development-activity-billing-webhook/index.ts', FN + '/manage-billing/index.ts'].sort())
     && JSON.stringify([...stripJs(MB.index).matchAll(/Deno\.env\.get\('(\w+)'\)/g)].map((m) => m[1])) === '["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","LEMONSQUEEZY_API_KEY","LEMONSQUEEZY_STORE_ID","LEMONSQUEEZY_BILLING_VARIANT_ID","LEMONSQUEEZY_BILLING_WEBHOOK_SECRET","LEMONSQUEEZY_TEST_MODE"]'
     && JSON.stringify([...stripJs(WB.index).matchAll(/Deno\.env\.get\('(\w+)'\)/g)].map((m) => m[1])) === '["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","LEMONSQUEEZY_BILLING_WEBHOOK_SECRET","LEMONSQUEEZY_BILLING_VARIANT_ID"]',
    '2d the processor\'s settings are read from the environment in the two index files alone, and each reads only what it needs (the webhook never holds the API key)');
  ok(stripJs(MB.index).includes("testMode: (Deno.env.get('LEMONSQUEEZY_TEST_MODE') ?? '') === 'true'") && !/LEMONSQUEEZY_TEST_MODE/.test(stripJs(WB.index)),
    '2d2 test mode is OFF unless the environment says exactly "true" (a missing setting never turns it on), and only the Billing function reads it');
  ok(/return timingSafeEqual\(given, await hmacHex\(secret, rawBody\)\);/.test(stripJs(LB)) && /return timingSafeEqual\(bind, await hmacHex\(secret, BINDING_CONTEXT \+ brokerageId\)\);/.test(stripJs(LB))
     && /if \(typeof a !== 'string' \|\| typeof b !== 'string' \|\| a\.length !== b\.length\) return false;/.test(stripJs(LB)),
    '2d3 the signature and the checkout binding are compared in constant time (timingSafeEqual, which refuses a different length), never with ===');
  ok([MB.handler, MB.data, WB.handler, WB.data, BR, LB].every((t) => !/\bDeno\b|process\.env/.test(stripJs(t))) && [MB.handler, MB.data, WB.handler, WB.data, BR, LB].every((t) => !/\bconsole\./.test(stripJs(t))),
    '2e the handlers, the data layers and both shared modules name no Deno global and never log: a secret, a key or a payload has no path to a log');
}
{
  const h = stripJs(WB.handler);
  const iConf = h.indexOf('!configured()'), iText = h.indexOf('req.text()'), iSig = h.indexOf('verifySignature('), iParse = h.indexOf('JSON.parse('), iTrans = h.indexOf('translate('), iApply = h.indexOf('deps.applyEvent(');
  ok(iConf > 0 && iText > iConf && iSig > iText && iParse > iSig && iTrans > iParse && iApply > iTrans,
    '2f the webhook\'s order is fixed: refuse everything when it is not set up, read the RAW text, check the signature of that raw text, only then parse it, translate it and record it', [iConf, iText, iSig, iParse, iTrans, iApply].join());
  ok(count(h, /JSON\.parse\(/g) === 1 && count(h, /req\.json\(\)/g) === 0 && count(h, /deps\.applyEvent\(/g) === 1,
    '2g the body is parsed once and only from the text that was signed (never req.json()), and one event is recorded per request');
  ok(!/\bsubscriptions\b|user_id|users\b|\bemail\b|\bprofiles?\b/i.test(h + stripJs(WB.data)) && !/public\.subscriptions|user_id|\busers\b|\bemail\b|\bprofiles?\b/i.test(stripJs(LB)) && !/lemonsqueezy-webhook/.test(h),
    '2h the webhook names no table or id of the map product (subscriptions, users, a user id) and never calls the other webhook: the two ignore each other\'s events');
  const t = stripJs(LB);
  ok(/verifyBinding\(cfg\.secret, custom\.brokerage_id, custom\.bind\)/.test(t) && t.indexOf('verifyBinding(') < t.indexOf('const attrs = data.attributes') && /livemode: !testMode/.test(t) && !/livemode: true/.test(t),
    '2i an event is acted on only when the checkout carried a valid signature for the brokerage id it names (a public buy link cannot name one), and livemode is the processor\'s own flag, never assumed');
}
{
  const h = stripJs(MB.handler), d = stripJs(MB.data);
  ok(/authorizeSignedIn\(req, deps\)/.test(h) && h.indexOf('authorizeSignedIn(') < h.indexOf('readBounded(') && h.indexOf('readBounded(') < h.indexOf('deps.usageOf('),
    '2j the gate refuses BEFORE the body is read, and the body is read before anything about billing is asked');
  ok(/deps\.createCheckout\(usage\.brokerage_id\)/.test(h) && !/\bb\.(brokerage|url|price|plan|email)/.test(h) && /const FIELDS: Record<string, string\[\]> = \{ status: \['action'\], checkout: \['action'\] \};/.test(h),
    '2k a checkout is made for the brokerage the DATABASE names for the signed-in person, never one the request names, and each action\'s field set is closed to the word "action"');
  const iOwner = h.indexOf("availability === 'not_owner'"), iPaid = h.indexOf("availability === 'already_paid'"), iExists = h.indexOf("availability === 'subscription_exists'"), iSet = h.indexOf("availability === 'not_set_up'"), iMake = h.indexOf('deps.createCheckout(');
  ok(iOwner > 0 && iPaid > iOwner && iExists > iPaid && iSet > iExists && iMake > iSet, '2l the checkout is refused for a non-owner, over a paid or live subscription and when the processor is not set up, in that order, and only then asked for', [iOwner, iPaid, iExists, iSet, iMake].join());
  ok(/u\.state !== 'none' && u\.state !== 'canceled' && u\.state !== 'test_only'/.test(h), '2m a checkout is offered only where a NEW subscription is needed: never subscribed, ended, or test-only (a second one over a live subscription would bill twice)');
  ok(count(d, /fetchFn\(/g) === 1 && /checkoutUrlFrom\(await r\.json\(\)/.test(d) && d.indexOf('if (!r.ok)') < d.indexOf('r.json()') && !/return[^;]*r\.(text|json)\(\)[^;]*\bthrow\b/.test(d),
    '2n the one request to the processor is the checkout; its answer is read only when it succeeded (a refusal\'s body can name the buyer) and only its address is kept, after the domain check');
  ok(!/brokerage_id|bind|secret|apiKey/.test(h.replace(/usage\.brokerage_id/g, '').replace(/deps\.configured/g, '').replace(/BillingUsage/g, '')) || count(h, /reply\([^)]*\b(secret|apiKey|bind)\b/g) === 0,
    '2o no reply of the Billing function carries a secret, a key or a signature');
}
{
  const g = stripJs(read(FN + '/_shared/billing-reads.ts'));
  ok(/export function planSummary\(/.test(g) && !/brokerage_id/.test(g.slice(g.indexOf('export function planSummary('), g.indexOf('export type AppliedEvent'))),
    '2p what a browser is told about a plan is built in one function that names no brokerage id');
}

// ---- 3. the report function ------------------------------------------------------------------------------------------------------------------
{
  const h = stripJs(read(FN + '/get-development-activity-report/handler.ts'));
  ok(/planOf: \(userId: string\) => Promise<BillingUsage \| null>;/.test(h) && count(h, /deps\.planOf\(/g) === 1 && h.indexOf('deps.planOf(') > h.indexOf('authorizeReportCaller(') && h.indexOf('deps.planOf(') < h.indexOf('deps.geocode('),
    '3a the report function reads the plan ONCE, after the gate and before any address is looked up');
  ok(/if \(trial && trial\.complete && !paid\)/.test(h) && /if \(trial && paid && plan!\.credits_remaining <= 0\)/.test(h) && !/credits_remaining\s*[-+*]|\bplan!?\.credits_used\s*[-+]/.test(h.replace(/credits_used: c\.credits_used/g, '')),
    '3b a complete trial with no paid plan, and a paid month with nothing left, are refused before any work; the page and the handler only COMPARE the database\'s figures, never calculate one');
  ok(/c\.allotment === 'paid'/.test(h) && !/allotment\s*=\s*['"]/.test(h) && !/plan\.state\s*=/.test(h),
    '3c which allotment a report used is read from the database\'s answer; the handler never sets one');
}

// ---- 4. the page and the landing page ----------------------------------------------------------------------------------------------------------
{
  const page = read('development-activity-reports.html');
  const js = stripJs(page.slice(page.indexOf('<script>\n// ====')));
  ok(page.length > 30000 && /id="billing"/.test(page) && /id="subscribe"/.test(page) && /Subscribe for \$79\/month/.test(page), '4-control: the page carries the Billing card and its button');
  ok(count(js, /location\.assign\(/g) === 1 && js.indexOf('checkoutOk(b.url)') > 0 && js.indexOf('checkoutOk(b.url)') < js.indexOf('location.assign(b.url)'),
    '4a the browser is sent anywhere by ONE call, after the address passed the page\'s own check');
  ok(/h === 'lemonsqueezy\.com' \|\| \/\\\.lemonsqueezy\\\.com\$\/\.test\(h\)/.test(js) && /u\.protocol === 'https:' && !u\.username && !u\.password/.test(js),
    '4b that check is: https, no credentials, the provider\'s own domain');
  ok(!/brokerage_id|b0b0|\.brokerage_id/.test(js) && count(js, /BILLING_FN/g) >= 3 && !/JSON\.stringify\(\{ action: 'checkout'[^}]*,/.test(js),
    '4c the page names no brokerage id and sends the checkout request with the action alone');
  ok(!/credits_remaining\s*[-+]\s*1|credits_used\s*\+\s*1|plan\.credits_(used|remaining)\s*(\+\+|--|[-+]=)/.test(js),
    '4d the page never works out a count: every figure it shows is the one the database gave');
  const landing = read('development-activity.html');
  ok(!/manage-billing|lemonsqueezy|checkout/i.test(stripJs(landing.replace(/<!--[\s\S]*?-->/g, ''))) && /data-cta="join" aria-disabled="true">Join for \$79\/month/.test(landing),
    '4e the landing page still has NO checkout: its buttons stay inert (they go live in build step 13, after the end-to-end test)');
  const landingPrice = /\$79\/month/.test(landing) && /100 new Development Activity reports each month/.test(landing) && /Cancel anytime\./.test(landing);
  ok(landingPrice && /\$79\/month gives your brokerage 100 new reports each month\. Cancel anytime\./.test(page),
    '4f the page\'s offer says the same thing as the landing page: $79/month, 100 new reports each month, cancel anytime');
}

// ---- 5. the wiring and the written record ------------------------------------------------------------------------------------------------------
{
  const noYaml = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const DEPLOY = noYaml(read('.github/workflows/deploy-edge-functions.yml'));
  ok(count(DEPLOY, /--no-verify-jwt/g) === 3 && /elif \[ "\$FN" = "development-activity-billing-webhook" \]/.test(DEPLOY) && !/manage-billing/.test(DEPLOY),
    '5a the deploy workflow turns JWT off for the webhook (the processor sends no token) and for no other new function; manage-billing keeps it on');
  const cfg = read('supabase/config.toml');
  ok(/\[functions\.manage-billing\]\s*\nverify_jwt = true/.test(cfg) && /\[functions\.development-activity-billing-webhook\]\s*\nverify_jwt = false/.test(cfg),
    '5b config.toml records the Billing function with JWT on and the webhook with it off');
  const ci = noYaml(read('.github/workflows/report-snapshot-suite.yml'));
  ok(/bash test\/brokerage_billing_pg\/run\.sh/.test(ci) && count(ci, /docs\/brokerage-billing\.sql/g) >= 2 && count(ci, /supabase\/functions\/manage-billing\/\*\*/g) >= 2 && count(ci, /supabase\/functions\/development-activity-billing-webhook\/\*\*/g) >= 2
     && count(ci, /test\/brokerage_billing_pg\/\*\*/g) >= 2,
    '5c the CI job runs the billing SQL suite against a disposable Postgres and is triggered by every file of the billing layer, in both the pull-request and the push lists');
  ok(existsSync(join(ROOT, 'test/brokerage_billing_pg/run.sh')) && existsSync(join(ROOT, 'test/brokerage_billing_pg/suite.sql')) && existsSync(join(ROOT, 'test/brokerage_billing_pg/mutate.py'))
     && existsSync(join(ROOT, 'test/billing_mutants.py')), '5d the SQL suite, its harness, its mutation harness and the edge mutation harness exist');
  const DOC = read('docs/development-activity-billing-2026-10-04.md');
  ok(/Canonical truth path/.test(DOC) && /Decision owner/.test(DOC) && /Shortcut check/.test(DOC) && /D-11-1/.test(DOC) && /D-11-8/.test(DOC) && /Founder actions/.test(DOC) && /NOT exercised live/i.test(DOC) && /unverified/i.test(DOC),
    '5e the written record states the canonical truth path, the decision owners, the defaults taken, the founder\'s actions, what was not exercised live and what is unverified about the processor');
  const steps = read('docs/development-activity-build-steps-100526.md');
  ok(/\$79\/month checkout/.test(steps), '5f the build-steps record still names the step');
  // the real handler is driven over the real SQL by test/trial_report_pg, and a member's report is now stored by brokerage_report_issue: that suite
  // must stand on the billing file, list the plan read and the ONE issue function, and must NOT list the free evaluation's own issue function (a
  // handler that called it directly would be a second way to charge a report, and an unlisted call stops the run)
  const TRIP = read('test/trial_report_pg/run.sh'), TRIR = stripJs(read('test/trial_report_pg/roundtrip.mjs'));
  ok(count(stripSql(TRIP.replace(/^#.*$/gm, '')), /docs\/brokerage-billing\.sql/g) === 2 && /payment-event-ledger/.test(TRIP) && /report-share-delivery/.test(TRIP) && /property-watch/.test(TRIP)
     && /^\s*brokerage_report_issue: /m.test(TRIR) && /^\s*billing_usage: /m.test(TRIR) && !/^\s*evaluation_report_issue: /m.test(TRIR),
    '5h the trial suite (the real handler over the real SQL) applies the billing file twice on top of the layers it stands on, answers the plan read and the ONE issue function, and does not answer the free function called directly');
  // the other webhook is not in this repo and is untouched
  const dirs = readdirSync(join(ROOT, FN));
  ok(!dirs.includes('lemonsqueezy-webhook') && !/lemonsqueezy-webhook/.test(stripJs([BR, LB, ...Object.values(MB), ...Object.values(WB)].join('\n'))),
    '5g the map product\'s own webhook (homesignal-ingest) is not in this repo and nothing here calls or replaces it');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
