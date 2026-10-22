// No workflow holds the deploy key or pushes to main (2026-10-22, founder "remove deploy key").
//
// Until then sitemap.yml and source-monitor.yml pushed straight to main with an SSH deploy key
// (the DEPLOY_KEY secret) that the "Protect Main" ruleset let bypass (bypass_actors: DeployKey,
// always). sitemap.yml is deleted and source-monitor.yml reports instead of pushing; the founder
// deletes the key, the secret and the bypass once that lands. This test keeps it that way: a
// workflow that reads secrets.DEPLOY_KEY, passes `ssh-key:` to a checkout, or runs a `git push`
// that can land on main fails the unit suite.
//
// "Can land on main" is decided per `git push` line (full-line comments ignored):
//   - its destination names main (`main`, `HEAD:main`, `refs/heads/main`), or
//   - it pushes to the run's own branch (bare `git push`, `HEAD`, `${{ github.ref_name }}`,
//     `${{ github.ref }}`, or any other `$`-variable) in a workflow that can run on main
//     (schedule, workflow_dispatch, workflow_run, or a push trigger whose branches can match
//     main), unless the SAME step tests the ref against main and exits before that push.
// A push to a named other branch (verify-dev-tracker, verify-maps-live) is not a push to main.
// Not read, stated: a push made inside a script the workflow calls, or through the GitHub API.
// The ruleset is the boundary; this is the tripwire that stops a workflow from needing a bypass.
//
// Run: node test/no-deploy-key-push.test.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wfDir = join(root, '.github', 'workflows');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail !== undefined ? '\n     ' + JSON.stringify(detail) : ''));
  if (!c) fails++;
};

const isComment = (l) => /^\s*#/.test(l);
// `${{ github.ref_name }}` -> `${{github.ref_name}}`, so one token per expression.
const norm = (l) => l.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, e) => '${{' + e.replace(/\s+/g, '') + '}}');

const DEPLOY_KEY_RE = /secrets\s*(?:\.\s*DEPLOY_KEY\b|\[\s*['"]DEPLOY_KEY['"]\s*\])/i;
const SSH_KEY_RE = /^\s*(?:-\s*)?ssh-key\s*:/;
const PUSH_RE = /\bgit\s+(?:-C\s+\S+\s+)?push\b(.*)$/;
const REF_RE = String.raw`(?:\$\{\{github\.ref(?:_name)?\}\}|\$\{?GITHUB_REF(?:_NAME)?\}?)`;
const MAIN_RE = String.raw`["']?(?:refs/heads/)?main["']?`;
const MAIN_TEST_RE = new RegExp(String.raw`${REF_RE}["']?\s*==?\s*${MAIN_RE}|${MAIN_RE}\s*==?\s*["']?${REF_RE}`);

function onText(text) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (i < 0) return '';
  const out = [lines[i]];
  for (const l of lines.slice(i + 1)) { if (l === '' || /^\s/.test(l)) out.push(l); else break; }
  return out.join('\n');
}

const globMatchesMain = (pat) => {
  const p = pat.trim().replace(/^['"]|['"]$/g, '');
  if (!p || p.startsWith('!')) return false;
  const re = '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.').replace(/\u0000/g, '.*') + '$';
  return new RegExp(re).test('main');
};

function listValue(bodyLines, key) {
  const i = bodyLines.findIndex((l) => new RegExp(`^\\s*${key}\\s*:`).test(l));
  if (i < 0) return null;
  const inline = bodyLines[i].replace(new RegExp(`^\\s*${key}\\s*:\\s*`), '').trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  const ind = bodyLines[i].match(/^\s*/)[0].length;
  const out = [];
  for (const l of bodyLines.slice(i + 1)) {
    if (!l.trim()) continue;
    if (l.match(/^\s*/)[0].length <= ind) break;
    const m = l.match(/^\s*-\s*(.+?)\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

export function canRunOnMain(text) {
  const on = onText(text);
  if (/\b(schedule|workflow_dispatch|workflow_run)\b/.test(on)) return true;
  const lines = on.split('\n');
  if (/^(on|"on"|'on'):\s*\S/.test(lines[0])) return /\bpush\b/.test(lines[0]);   // on: push / on: [push, …]
  const pi = lines.findIndex((l) => /^\s+push\s*:/.test(l));
  if (pi < 0) return false;
  const ind = lines[pi].match(/^\s*/)[0].length;
  const body = [];
  for (const l of lines.slice(pi + 1)) { if (!l.trim() || l.match(/^\s*/)[0].length > ind) body.push(l); else break; }
  const branches = listValue(body, 'branches');
  const ignore = listValue(body, 'branches-ignore');
  if (branches) return branches.some(globMatchesMain);
  if (ignore) return !ignore.some(globMatchesMain);
  return !listValue(body, 'tags');   // a push trigger with no branch filter runs on every branch
}

// Where one `git push` line sends its commits: 'main', 'own' (the run's branch) or 'named'.
export function pushDestination(line) {
  const m = norm(line).match(PUSH_RE);
  if (!m) return null;
  const toks = [];
  for (const raw of m[1].trim().split(/\s+/).filter(Boolean)) {
    if (/^(;|&&|\|\||\||then|#)$/.test(raw)) break;
    const t = raw.replace(/;$/, '');
    if (!t.startsWith('-')) toks.push(t);
    if (t !== raw) break;
  }
  const refspecs = toks.slice(1).map((t) => t.replace(/^['"]|['"]$/g, '').replace(/^\+/, ''));
  if (!refspecs.length) return 'own';
  let dest = 'named';
  for (const r of refspecs) {
    const d = r.includes(':') ? r.slice(r.lastIndexOf(':') + 1) : r;
    if (d === 'main' || d === 'refs/heads/main') return 'main';
    if (d === 'HEAD' || d.includes('$')) dest = 'own';
  }
  return dest;
}

export function violations(name, text) {
  const out = [];
  const onMain = canRunOnMain(text);
  let refusesMain = false;
  let sawMainTest = false;
  text.split('\n').forEach((raw, i) => {
    const where = `${name}:${i + 1}`;
    const s = raw.trim();
    if (/^-\s+(name|uses|run):/.test(s)) { refusesMain = false; sawMainTest = false; }
    if (isComment(raw)) return;
    const l = norm(raw);
    if (DEPLOY_KEY_RE.test(l)) out.push(`${where} references secrets.DEPLOY_KEY`);
    if (SSH_KEY_RE.test(l)) out.push(`${where} passes ssh-key:`);
    if (MAIN_TEST_RE.test(l) && !/!=/.test(l)) sawMainTest = true;
    if (sawMainTest && /\bexit\b/.test(l) && !PUSH_RE.test(l)) refusesMain = true;
    const dest = pushDestination(l);
    if (dest === 'main') out.push(`${where} pushes to main`);
    else if (dest === 'own' && onMain && !refusesMain) out.push(`${where} pushes the run's own branch, and this workflow can run on main`);
  });
  return out;
}

// ── 1. In-memory fixtures: the scan FAILS on each violating shape ────────────────────────────
const WF = (on, steps) => `name: t\non:\n${on}\npermissions:\n  contents: write\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
const SCHED = "  schedule:\n    - cron: '17 6 * * *'\n  workflow_dispatch:";
const DISPATCH = '  workflow_dispatch:';

// The deleted sitemap.yml, its credential and push lines verbatim.
const OLD_SITEMAP = WF(SCHED, [
  '      - name: Require DEPLOY_KEY (ruleset-bypass push credential)',
  '        env:',
  '          DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}',
  '        run: |',
  '          if [ -z "$DEPLOY_KEY" ]; then exit 1; fi',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          ssh-key: ${{ secrets.DEPLOY_KEY }}',
  '      - name: Commit if changed',
  '        run: |',
  '          git commit -m "chore: regenerate sitemap.xml from communities"',
  '          GH_TOKEN="${{ github.token }}" bash "$GITHUB_WORKSPACE/scripts/guard_bot_push.sh" "${{ github.ref_name }}" || { [ $? -eq 4 ] && exit 0; exit 1; }',
  '          git push',
].join('\n') + '\n');
{
  const v = violations('old-sitemap.yml', OLD_SITEMAP);
  ok(v.filter((x) => /DEPLOY_KEY/.test(x)).length === 2, '1a the old sitemap.yml shape: both secrets.DEPLOY_KEY references are caught', v);
  ok(v.some((x) => /ssh-key/.test(x)), '1b …and its ssh-key: checkout', v);
  ok(v.filter((x) => /pushes the run's own branch/.test(x)).length === 1 && v.length === 4, '1c …and its scheduled bare `git push` (a schedule always runs on main)', v);
}
// The old source-monitor.yml push, verbatim.
{
  const t = WF(SCHED, '      - name: Commit report\n        run: |\n          for attempt in 1 2 3 4; do\n            if git push origin "HEAD:${{ github.ref_name }}"; then\n              exit 0\n            fi\n          done\n');
  ok(violations('old-monitor.yml', t).length === 1, '1d the old source-monitor push to HEAD:${{ github.ref_name }} on a schedule is caught', violations('old-monitor.yml', t));
}
for (const [label, line] of [
  ['git push origin main', 'git push origin main'],
  ['HEAD:main', 'git push origin HEAD:main'],
  ['HEAD:refs/heads/main', 'git push origin HEAD:refs/heads/main'],
  ['forced +HEAD:main', 'git push --force origin +HEAD:main'],
  ['quoted "main"', 'git push origin "main"'],
]) {
  const t = WF('  push:\n    branches: [claude/x]', `      - run: ${line}\n`);
  ok(violations('t.yml', t).some((x) => /pushes to main/.test(x)), `1e an explicit push to main is caught even on a feature-branch trigger: ${label}`, violations('t.yml', t));
}
for (const [label, line] of [
  ['lowercase', '          K: ${{ secrets.deploy_key }}'],
  ['bracket form', "          K: ${{ secrets['DEPLOY_KEY'] }}"],
  ['inside a run line', '        run: echo "${{ secrets.DEPLOY_KEY }}" > key'],
]) {
  const t = WF(DISPATCH, `      - name: x\n        env:\n${line}\n        run: true\n`);
  ok(violations('t.yml', t).some((x) => /DEPLOY_KEY/.test(x)), `1f a DEPLOY_KEY reference is caught: ${label}`, violations('t.yml', t));
}
ok(violations('t.yml', WF('  push:\n    branches: [main]', '      - run: git push\n')).length === 1, '1g a push trigger on main with a bare push is caught');
ok(violations('t.yml', WF("  push:\n    branches:\n      - '**'", '      - run: git push\n')).length === 1, "1h branches: '**' matches main");
ok(violations('t.yml', WF(DISPATCH, '      - run: git push origin "HEAD:$BRANCH"\n')).length === 1, '1i a push to a $-variable on a dispatchable workflow counts as the run\'s own branch');
{
  // A main test in a DIFFERENT step does not protect this one.
  const t = WF(SCHED, '      - name: check\n        run: |\n          if [ "${{ github.ref_name }}" = "main" ]; then exit 1; fi\n      - name: push\n        run: git push\n');
  ok(violations('t.yml', t).length === 1, '1j the refusal must be in the same step as the push', violations('t.yml', t));
  // An inverted test is not a refusal.
  const inv = WF(SCHED, '      - name: push\n        run: |\n          if [ "${{ github.ref_name }}" != "main" ]; then exit 1; fi\n          git push\n');
  ok(violations('t.yml', inv).length === 1, '1k `!= "main"` then exit is not a refusal of main', violations('t.yml', inv));
}

// ── 2. In-memory fixtures: the scan PASSES what is allowed ───────────────────────────────────
ok(violations('t.yml', WF(SCHED, '      - name: push\n        run: |\n          if [ "${{ github.ref_name }}" = "main" ]; then\n            echo "::error::never main"\n            exit 1\n          fi\n          git push origin HEAD:${{ github.ref_name }}\n')).length === 0,
  '2a a scheduled push to the own branch passes when the same step refuses main first');
ok(violations('t.yml', WF(SCHED, '      - run: git push origin HEAD:claude/dev-tracker-zip-scope\n')).length === 0, '2b a push to a named other branch passes');
ok(violations('t.yml', WF(DISPATCH, '      - run: git push -f "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" ci-live-shots\n')).length === 0,
  '2c a push to a URL remote and a named branch passes (the URL is the remote, not a refspec)');
ok(violations('t.yml', WF('  push:\n    branches: [claude/x]', '      - run: git push\n')).length === 0, '2d a bare push on a workflow that only runs on a feature branch passes');
ok(violations('t.yml', WF(DISPATCH, '      # ssh-key: ${{ secrets.DEPLOY_KEY }} (removed 2026-10-22)\n      - uses: actions/checkout@v4\n')).length === 0, '2e a comment that names the old credential passes');
ok(violations('t.yml', WF(DISPATCH, '      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n')).length === 0, '2f a plain checkout passes');
ok(!canRunOnMain(WF("  push:\n    tags: ['v*']", '')) && canRunOnMain(WF('  push:\n    paths: [x]', '')) && canRunOnMain('on: [push]\njobs:\n'),
  '2g trigger reading: tags-only push cannot run on main; a push with no branch filter and the list form can');

// ── 3. The real workflows ────────────────────────────────────────────────────────────────────
const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort();
const all = [];
let pushLines = 0;
for (const f of files) {
  const text = readFileSync(join(wfDir, f), 'utf8');
  all.push(...violations(f, text));
  pushLines += text.split('\n').filter((l) => !isComment(l) && PUSH_RE.test(l)).length;
}
ok(files.length > 50, `3a control: the scan read the repository's workflows (${files.length} files)`);
ok(pushLines >= 4, `3b control: it finds the real pushes that remain (${pushLines} git push lines), so a zero below is not a scan that saw nothing`);
const read = (f) => readFileSync(join(wfDir, f), 'utf8');
{
  const g = read('gen-gov-notice-coverage.yml');
  ok(canRunOnMain(g) && g.split('\n').some((l) => pushDestination(l) === 'own') && violations('g', g).length === 0,
    '3c control: gen-gov-notice-coverage pushes its own branch on a schedule and passes ONLY through its main refusal (the refusal path is exercised on a real file)');
  const strip = g.replace(/\n\s*if \[ "\$\{\{ github\.ref_name \}\}" = "main" \]; then/, '\n          if false; then');
  ok(strip !== g && violations('g', strip).length > 0, '3d …and the same file without that refusal fails');
  ok(read('verify-dev-tracker.yml').split('\n').some((l) => pushDestination(l) === 'named'), '3e control: a named-branch push is read as named');
  const sm = read('source-monitor.yml');
  ok(sm.includes('node scripts/source-monitor.mjs') && canRunOnMain(sm) && !sm.split('\n').some((l) => !isComment(l) && PUSH_RE.test(l)),
    '3f source-monitor.yml still runs the monitor on a schedule, and contains no git push');
  ok(!existsSync(join(wfDir, 'sitemap.yml')), '3g sitemap.yml is deleted (its daily commit changed nothing served; see scripts/gen_sitemap.py)');
}
ok(all.length === 0, 'no workflow references secrets.DEPLOY_KEY, passes ssh-key:, or pushes to main', all);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL PASS');
