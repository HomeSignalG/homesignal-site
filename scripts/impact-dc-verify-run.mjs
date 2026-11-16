#!/usr/bin/env node
// Tab 17 data-center project check: the production entry point (run by .github/workflows/impact-dc-verify.yml).
// Kept apart from scripts/impact-dc-verify.mjs so offline tests import the worker without reaching the browser checker.
import { runOnce } from './impact-dc-verify.mjs';
import { checkProjectPage } from './lib/impact-dc-page-check.mjs';

async function main() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); process.exit(2); }
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const rpc = async (fn, body) => {
    const r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    const t = await r.text();
    if (!r.ok) throw new Error(fn + ' -> HTTP ' + r.status + ': ' + t.slice(0, 200));
    return t ? JSON.parse(t) : null;
  };
  const fetchDoc = async (u) => {
    try {
      const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'JODY-link-check' } });
      const ct = r.headers.get('content-type') || '';
      let title = null;
      if (r.ok && /html/.test(ct)) { const m = /<title[^>]*>([^<]{1,300})<\/title>/i.exec((await r.text()).slice(0, 200000)); title = m ? m[1].trim() : null; }
      const loginWall = /\/(login|signin|sso)\b/i.test(r.url);
      return { ok: r.ok && !loginWall, status: r.status, title };
    } catch (e) { return { ok: false, status: 0, error: String(e.message || e) }; }
  };
  const done = await runOnce({ rpc, fetchDoc, checkPage: checkProjectPage });
  console.log(JSON.stringify(done, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
