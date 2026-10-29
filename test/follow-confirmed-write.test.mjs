// A follow says "Following" only after the database confirms the write.
// Run: node test/follow-confirmed-write.test.mjs
//
// supabase-js reports a rejected insert/delete by RESOLVING with { error }, not by throwing.
// HS.toggleFollow used to flip the label and localStorage first and call persistFollow without
// awaiting it, and persistFollow never looked at res.error — so a refused write still read
// "✓ Following in My Places". This file runs the SHIPPED functions out of shell.js (sliced from
// the file, not copied) against a fake client and asserts the order: Saving… → confirm → label.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d) : ''));
  if (!c) fails++;
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shell = readFileSync(join(root, 'shell.js'), 'utf8');

function slice(startRe, endMarker) {
  const m = shell.match(startRe);
  if (!m) throw new Error('not found: ' + startRe);
  const i = m.index;
  const j = shell.indexOf(endMarker, i);
  if (j < 0) throw new Error('end not found for ' + startRe);
  return shell.slice(i, j + endMarker.length);
}
// Everything from the follow-copy constants through HS.toggleFollow, plus the two helpers.
const followBlock = slice(/  HS\.PROJECT_FOLLOW_ADD = /, "    LS.set('follows', [...state.follows]);\n    return res;\n  };\n");
const dupFn = slice(/  function isDuplicateKeyError\(err\)/, '\n  }\n');
const persistFn = slice(/  async function persistFollow\(type, id, on\)/, '\n  }\n');

// ---- a tiny DOM: enough for a button and its sibling status line ----------------------------
function makeDom() {
  class El {
    constructor(tag) { this.tagName = tag; this.children = []; this.parentNode = null; this.attrs = {}; this.dataset = {};
      this.textContent = ''; this.disabled = false; this.style = {}; this._cls = new Set();
      const self = this;
      this.classList = { contains: c => self._cls.has(c), toggle: (c, on) => { if (on === undefined ? !self._cls.has(c) : on) self._cls.add(c); else self._cls.delete(c); }, add: c => self._cls.add(c) }; }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return [...this._cls].join(' '); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) { c.parentNode = this; const k = ref ? this.children.indexOf(ref) : -1; if (k < 0) this.children.push(c); else this.children.splice(k, 0, c); return c; }
    get nextElementSibling() { if (!this.parentNode) return null; const s = this.parentNode.children; return s[s.indexOf(this) + 1] || null; }
    get nextSibling() { return this.nextElementSibling; }
  }
  return { document: { createElement: t => new El(t) }, El };
}

function harness(responder, opts = {}) {
  const { document, El } = makeDom();
  const store = {};
  const calls = [];
  const state = { follows: new Set(opts.follows || []), session: opts.session === undefined ? { user: { id: 'u1' } } : opts.session };
  const CFG = { DATA_SOURCE: opts.dataSource || 'supabase' };
  const LS = { set: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, get: (k, d) => (k in store ? store[k] : d) };
  const client = {
    from(table) {
      return {
        insert(row) { calls.push({ op: 'insert', table, row }); return responder('insert', row); },
        delete() { return { match(row) { calls.push({ op: 'delete', table, row }); return responder('delete', row); } }; }
      };
    }
  };
  const HS = { requireAuth: () => opts.signedIn !== false, sb: () => client };
  const ctx = vm.createContext({ HS, state, CFG, LS, document, console: { warn() {} }, Promise, String, Set });
  vm.runInContext(dupFn + '\n' + persistFn + '\n' + followBlock + '\nthis.persistFollow = persistFollow;', ctx);
  const parent = new El('div');
  const btn = parent.appendChild(new El('button'));
  btn.textContent = opts.label || HS.PROJECT_FOLLOW_ADD;
  return { HS, state, store, calls, btn, parent, ctx };
}
const deferred = () => { let resolve; const p = new Promise(r => { resolve = r; }); return { p, resolve }; };
const msgOf = (btn) => { const n = btn.nextElementSibling; return n && n.classList.contains('hs-follow-msg') ? n : null; };

// 1. success: no "Following" before the database answers, then Following.
{
  const d = deferred();
  const h = harness(() => d.p);
  const run = h.HS.toggleFollow(h.btn, 'project', 'p1');
  ok(h.btn.textContent === 'Saving…', '1a while the insert is pending the button reads Saving…', h.btn.textContent);
  ok(h.btn.disabled === true && h.btn.getAttribute('aria-busy') === 'true', '1b button is disabled and aria-busy while saving');
  ok(!h.state.follows.has('project:p1') && !(h.store.follows || []).includes('project:p1'),
    '1c nothing is marked followed before the database confirms', h.store);
  ok(!/Following/.test(h.btn.textContent), '1d no "Following" text before confirmation');
  d.resolve({ data: null, error: null });
  const res = await run;
  ok(res && res.ok === true, '1e toggleFollow returns ok after a clean insert');
  ok(h.btn.textContent === h.HS.PROJECT_FOLLOW_ON, '1f label is ✓ Following in My Places after confirm', h.btn.textContent);
  ok(h.state.follows.has('project:p1') && h.store.follows.includes('project:p1'), '1g state and localStorage updated after confirm');
  ok(h.btn.disabled === false && h.btn.getAttribute('aria-busy') === null, '1h button usable again');
  ok(h.calls.length === 1 && h.calls[0].op === 'insert' && h.calls[0].row.target_type === 'project', '1i one insert on app_follows', h.calls);
}

// 2. refused insert (resolves with { error }): previous state kept, message shown, retry works.
{
  let fail = true;
  const h = harness(() => Promise.resolve(fail ? { error: { code: '42501', message: 'permission denied' } } : { error: null }));
  const res = await h.HS.toggleFollow(h.btn, 'project', 'p1');
  ok(res && res.ok === false, '2a a resolved { error } is a failure');
  ok(h.btn.textContent === h.HS.PROJECT_FOLLOW_ADD, '2b label returns to Add to My Places to follow', h.btn.textContent);
  ok(!h.state.follows.has('project:p1') && !(h.store.follows || []).includes('project:p1'), '2c nothing saved locally on failure');
  const m = msgOf(h.btn);
  ok(m && m.textContent === h.HS.PROJECT_FOLLOW_SAVE_ERROR, '2d error message shown next to the button', m && m.textContent);
  ok(m && m.getAttribute('role') === 'status' && m.getAttribute('aria-live') === 'polite', '2e message is an accessible status line');
  ok(h.btn.disabled === false, '2f button left usable for retry');
  fail = false;
  const res2 = await h.HS.toggleFollow(h.btn, 'project', 'p1');
  ok(res2.ok && h.btn.textContent === h.HS.PROJECT_FOLLOW_ON, '2g retry succeeds and reads Following', h.btn.textContent);
  ok(msgOf(h.btn).textContent === '', '2h retry clears the error message');
}

// 3. a thrown error is a failure too.
{
  const h = harness(() => Promise.reject(new Error('network')));
  const res = await h.HS.toggleFollow(h.btn, 'project', 'p1');
  ok(res.ok === false && h.btn.textContent === h.HS.PROJECT_FOLLOW_ADD && !h.state.follows.has('project:p1'),
    '3 a thrown error restores the previous state');
}

// 4. duplicate key (23505) means the row is already saved: success.
{
  const h = harness(() => Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }));
  const res = await h.HS.toggleFollow(h.btn, 'project', 'p1');
  ok(res.ok === true && h.btn.textContent === h.HS.PROJECT_FOLLOW_ON && h.state.follows.has('project:p1'),
    '4 23505 duplicate is treated as already saved', { res, label: h.btn.textContent });
}

// 5. unfollow: confirmed delete only.
{
  const h = harness(() => Promise.resolve({ error: { code: '500', message: 'boom' } }),
    { follows: ['project:p1'], label: '✓ Following in My Places' });
  const res = await h.HS.toggleFollow(h.btn, 'project', 'p1');
  ok(res.ok === false && h.state.follows.has('project:p1') && h.btn.textContent === '✓ Following in My Places',
    '5a a refused delete keeps Following', h.btn.textContent);
  ok(msgOf(h.btn).textContent === h.HS.PROJECT_FOLLOW_REMOVE_ERROR, '5b remove error message shown');
  const d = deferred();
  const h2 = harness(() => d.p, { follows: ['project:p1'], label: '✓ Following in My Places' });
  const run = h2.HS.toggleFollow(h2.btn, 'project', 'p1');
  ok(h2.btn.textContent === 'Removing…' && h2.state.follows.has('project:p1'), '5c Removing… and still followed while pending');
  d.resolve({ error: null });
  await run;
  ok(!h2.state.follows.has('project:p1') && h2.btn.textContent === h2.HS.PROJECT_FOLLOW_ADD, '5d confirmed delete unfollows');
  ok(h2.calls[0].op === 'delete', '5e unfollow issued a delete');
}

// 6. HS.unfollowProject (My Places) shares the confirmed path.
{
  const bad = harness(() => Promise.resolve({ error: { message: 'denied' } }), { follows: ['project:p9'] });
  const r = await bad.HS.unfollowProject('p9');
  ok(r.ok === false && bad.state.follows.has('project:p9'), '6a unfollowProject keeps the follow when the delete is refused');
  const good = harness(() => Promise.resolve({ error: null }), { follows: ['project:p9'] });
  const r2 = await good.HS.unfollowProject('p9');
  ok(r2.ok === true && !good.state.follows.has('project:p9'), '6b unfollowProject removes it after a clean delete');
}

// 7. local-only modes (seed data, demo session) need no database and confirm immediately.
{
  const h = harness(() => { throw new Error('must not be called'); }, { dataSource: 'seed' });
  const res = await h.HS.toggleFollow(h.btn, 'project', 'p1');
  ok(res.ok && h.calls.length === 0 && h.btn.textContent === h.HS.PROJECT_FOLLOW_ON, '7a seed mode follows locally');
  const d = harness(() => { throw new Error('must not be called'); }, { session: { user: { id: 'demo' }, demo: true } });
  const res2 = await d.HS.toggleFollow(d.btn, 'project', 'p1');
  ok(res2.ok && d.calls.length === 0, '7b demo session never writes to the database');
}

// 8. signed out: nothing changes (requireAuth opens sign-in).
{
  const h = harness(() => Promise.resolve({ error: null }), { signedIn: false });
  await h.HS.toggleFollow(h.btn, 'project', 'p1');
  ok(h.calls.length === 0 && h.btn.textContent === h.HS.PROJECT_FOLLOW_ADD && !h.btn.disabled, '8 signed-out click writes nothing');
}

// 9. a second click while saving does not send a second write.
{
  const d = deferred();
  const h = harness(() => d.p);
  const run = h.HS.toggleFollow(h.btn, 'project', 'p1');
  await h.HS.toggleFollow(h.btn, 'project', 'p1');
  d.resolve({ error: null }); await run;
  ok(h.calls.length === 1, '9 one write per button at a time', h.calls.length);
}

// 10. account sync push inspects res.error and keeps the local save.
{
  const sync = slice(/  async function syncProjectFollowsFromAccount\(\)/, '\n  }\n');
  ok(/const res = await HS\.sb\(\)\.from\('app_follows'\)\.insert/.test(sync) && /res\.error && !isDuplicateKeyError\(res\.error\)/.test(sync),
    '10a sync push reads res.error (duplicate is not an error)');
  ok(!/state\.follows\.delete/.test(sync), '10b sync never deletes a local save');
}

console.log(fails ? '\n' + fails + ' failed' : '\nAll follow confirmed-write assertions passed.');
process.exit(fails ? 1 : 0);
