// A CANCELLED PUBLIC MEETING STAYS LISTED, WITH A "Cancelled" BADGE (founder ruling 2026-10-19).
// Run: node test/meeting-cancelled-badge.test.mjs
//
// The ONE decision owner is the database: the PostgREST computed field `is_cancelled` on
// public.meetings (function public.is_cancelled(public.meetings), SQL of record
// homesignal-ingest supabase/migrations/20261019190000_meetings_is_cancelled.sql). This file pins:
//   1. no site file decides "cancelled" on its own (no cancel regex / keyword test on a title);
//   2. every reader of the meetings table selects is_cancelled (`*` does NOT include it);
//   3. the shipped templates render the badge, and drop the countdown, from the flag alone;
//   4. every meeting renderer carries the flag through to the badge;
//   5. the static ZIP-page generator selects the field and prints the badge.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── 1. no second cancel decision ─────────────────────────────────────────────────────────────
// A cancel pattern applied in code: a JS regex literal or RegExp containing "cancel", a string
// search for it, or a Python re.* call / `in` test on it. Comments are stripped first.
const JS_PATTERNS = [
  /\/(?:[^/\n\\]|\\.)*cancel(?:[^/\n\\]|\\.)*\/[gimsuy]*\s*\.(?:test|exec)\s*\(/i,
  /\.(?:match|search|replace|split)\s*\(\s*\/(?:[^/\n\\]|\\.)*cancel/i,
  /new\s+RegExp\s*\([^)]*cancel/i,
  /\.(?:includes|indexOf|startsWith|endsWith)\s*\(\s*['"`][^'"`]*cancel/i
];
const PY_PATTERNS = [
  /re\.\w+\(\s*r?["'][^"'\n]*cancel/i,
  /["'][^"'\n]*cancel[^"'\n]*["']\s+in\s+/i
];
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1');
const stripPy = (s) => s.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '$1')).join('\n');
const detects = (src, kind) => (kind === 'py' ? PY_PATTERNS : JS_PATTERNS).some((re) => re.test(kind === 'py' ? stripPy(src) : stripJs(src)));

// Positive controls: the detector must catch the shapes it exists to refuse.
ok(detects("if (/cancel/i.test(m.title)) x = 1;", 'js'), '1a control: a JS /cancel/i.test(title) is detected');
ok(detects("var c = (m.title || '').toLowerCase().includes('cancel');", 'js'), '1b control: a JS .includes("cancel") is detected');
ok(detects("c = bool(re.search(r'cancel', title, re.I))", 'py'), '1c control: a Python re.search(r"cancel") is detected');
ok(detects('c = "cancelled" in title.lower()', 'py'), '1d control: a Python `"cancelled" in title` is detected');
ok(!detects("// a /cancel/i.test(title) would be wrong\nvar x = m.is_cancelled === true;", 'js'), '1e control: a comment and the flag read are NOT flagged');

const files = [];
for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) if (f.endsWith('.js')) files.push('lib/' + f);
for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.html') || f === 'shell.js') files.push(f);
for (const f of fs.readdirSync(path.join(ROOT, 'scripts'))) if (/\.(py|mjs|js)$/.test(f)) files.push('scripts/' + f);
ok(files.length > 40 && files.includes('lib/data.js') && files.includes('scripts/gen_zip_pages.py') && files.includes('alerts.html'),
  '1f the scan covers lib/, scripts/ and the pages (' + files.length + ' files)');
const offenders = files.filter((f) => detects(read(f), f.endsWith('.py') ? 'py' : 'js'));
ok(offenders.length === 0, '1g no site file decides "cancelled" from text; the flag comes from is_cancelled' + (offenders.length ? ' — offenders: ' + offenders.join(', ') : ''));

// ── 2. every meetings reader selects is_cancelled ────────────────────────────────────────────
const DATA = read('lib/data.js');
const reads = DATA.match(/from\('meetings'\)\s*\.select\(\s*'[^']*'/g) || [];
ok(reads.length === 3, '2a lib/data.js reads the meetings table exactly three times (found ' + reads.length + ')');
ok(reads.every((r) => /is_cancelled/.test(r)), '2b every lib/data.js meetings read selects is_cancelled');
ok(!/from\('meetings'\)\s*\.select\('\*'\)/.test(DATA), '2c no bare select(\'*\') on meetings (a computed field is not in *)');
ok(/cancelled:\s*m\.is_cancelled === true/.test(DATA.slice(DATA.indexOf('function normMeeting'), DATA.indexOf('function normMeeting') + 2000)),
  '2d normMeeting carries cancelled from is_cancelled');
ok(/zips: hits, cancelled: m\.is_cancelled === true/.test(DATA), '2e meetingsForZips carries cancelled on its rows');
const GEN = read('scripts/gen_zip_pages.py');
ok(/fetch_all\("meetings", key,\s*"[^"]*\bis_cancelled\b[^"]*"/.test(GEN), '2f gen_zip_pages.py selects is_cancelled');

// ── 3. the shipped templates ─────────────────────────────────────────────────────────────────
const ctx = { URL, console, Date, Intl }; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('lib/templates.js'), ctx);
const T = ctx.HS.tpl;
const soon = new Date(Date.now() + 3 * 86400000).toISOString();
const base = { id: 1, title: 'County Commission Regular Meeting', starts_at: soon, location: 'Courthouse' };
const live = T.meetingRow(Object.assign({}, base, { cancelled: false }));
const off = T.meetingRow(Object.assign({}, base, { cancelled: true }));
ok(/days? away/.test(live) && !/Cancelled/.test(live), '3a a live meeting shows its countdown and no badge');
ok(/<span class="mtg-cancelled">Cancelled<\/span>/.test(off), '3b a cancelled meeting shows the "Cancelled" badge');
ok(!/days? away|Today/.test(off), '3c a cancelled meeting shows no countdown');
ok(off.includes('County Commission Regular Meeting') && off.includes('Courthouse'), '3d a cancelled meeting keeps its title and location');
const offLink = T.meetingRowLink(Object.assign({}, base, { cancelled: true }), 'https://example.gov/m/1');
ok(/Cancelled/.test(offLink) && !/days? away/.test(offLink) && offLink.includes('href="https://example.gov/m/1"'), '3e meetingRowLink: badge, no countdown, link kept');
const titled = T.meetingRow(Object.assign({}, base, { title: 'CANCELLED - Board Meeting', cancelled: false }));
ok(!/mtg-cancelled/.test(titled), '3f a title saying "cancelled" does NOT make a badge: only the flag does');
const pillOff = T.windowPill({ cancelled: true, window_closes_at: soon });
ok(/mtg-cancelled">Cancelled</.test(pillOff) && !/Window closes/.test(pillOff), '3g story cards (alerts.html) show the badge and no closing countdown');
ok(/Window closes/.test(T.windowPill({ cancelled: false, window_closes_at: soon })), '3h a live window still counts down');

// ── 4. every renderer carries the flag ───────────────────────────────────────────────────────
const ALERTS = read('alerts.html');
const mac = ALERTS.slice(ALERTS.indexOf('function meetingAsChange'), ALERTS.indexOf('function dedupeMeetings'));
ok(/cancelled: m\.cancelled === true/.test(mac), '4a alerts.html meetingAsChange carries the flag');
ok(/window_closes_at: m\.cancelled === true \? null/.test(mac), '4b a cancelled meeting is not put in the "needs you soon" band');
const CP = read('lib/community-page.js');
ok(/m\.cancelled === true \? ' ' \+ HS\.tpl\.cancelledBadge\(m\)/.test(CP), '4c the ZIP page civic card badges a cancelled meeting');
ok(/cancelled: m\.cancelled === true \|\| m\.is_cancelled === true/.test(read('lib/dashboard-aggregate.js'))
  && /d\.cancelled === true \? ' ' \+ HS\.tpl\.cancelledBadge\(d\)/.test(read('dashboard.html')), '4d the dashboard official dates carry and badge the flag');
ok(/mtg\.cancelled === true/.test(read('development.html')) && /mtg\.cancelled !== true/.test(read('lib/why.js')),
  '4e the project timeline and "why" panel never call a cancelled meeting scheduled');
ok(/\.mtg-cancelled\{/.test(read('app.css')), '4f the badge style ships in app.css');

// ── 5. the generated ZIP page ────────────────────────────────────────────────────────────────
const py = execFileSync('python3', ['-I', '-c',
  'import sys, json\nsys.path.insert(0, "scripts")\nimport gen_zip_pages as g\n'
  + 'a = [{"title": "Board", "url": "https://example.gov/a", "date": "2026-10-20", "cancelled": True}]\n'
  + 'b = [{"title": "Board", "url": "https://example.gov/a", "date": "2026-10-20", "cancelled": False}]\n'
  + 'print(json.dumps([g._items(a, "Upcoming public meetings", "E", "um"), g._items(b, "Upcoming public meetings", "E", "um")]))'],
  { cwd: ROOT, encoding: 'utf8' });
const [genOff, genLive] = JSON.parse(py);
ok(/<span class="mtg-cancelled">Cancelled<\/span>/.test(genOff) && genOff.includes('https://example.gov/a') && genOff.includes('2026-10-20'),
  '5a the generated list shows "Cancelled" and keeps the title, link and date');
ok(!/Cancelled/.test(genLive), '5b a live meeting in the generated list has no badge');
ok(/"cancelled": m\.get\("is_cancelled"\) is True/.test(GEN), '5c the generator reads the flag from is_cancelled');

if (fails) { console.log('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nALL PASS');
