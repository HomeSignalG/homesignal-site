// Tab 18 · Development Dossiers: offline contract between the page, the SQL of record and the dashboard shell.
// Run: node test/development-review.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const js = read('lib/acq-development-review.js');
const html = read('acquisition.html');
const sql = read('docs/development-review.sql');
const dossier = read('docs/development-dossier.sql');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 1. the shell
const nav = html.match(/<nav class="tabs">([\s\S]*?)<\/nav>/)[1];
const labels = [...nav.matchAll(/data-tab="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
ok(labels.length >= 18 && labels[17][0] === 'dossiers' && labels[17][1] === '18 · Development Dossiers', '1a tab 18 is "18 · Development Dossiers"');
ok(html.includes('<div class="tab" id="tab-dossiers"></div>'), '1b the tab container exists');
ok(/dossiers: function \(\) \{[\s\S]*?HS\.acqDevelopmentReview\.load\(window\.hsClient, el\)/.test(html), '1c a trusted initializer loads the module');
ok(/if\(id==='dossiers'\) return;/.test(html), '1d a snapshot refresh never overwrites the tab');
const key = createHash('sha256').update(readFileSync(new URL('../lib/acq-development-review.js', import.meta.url))).digest('hex').slice(0, 8);
ok(html.includes('<script src="lib/acq-development-review.js?v=' + key + '"></script>'), '1e the script is loaded with its content key');

// 2. the page writes only through the dossier functions
const rpcs = [...new Set([...code.matchAll(/(?:rpc|call)\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
ok(JSON.stringify(rpcs) === JSON.stringify(['development_link_decide', 'development_project_create', 'development_project_set',
  'development_publish_request', 'development_review_queue']), '2a the page calls exactly the five functions (' + rpcs.join(', ') + ')');
ok(!/\.from\(/.test(code) && !/insert|update|delete/i.test(code.replace(/development_[a-z_]+|Update the site|site update/g, '')), '2b the page touches no table directly');
for (const f of ['development_link_decide', 'development_project_create', 'development_project_set']) {
  ok(new RegExp('grant execute on function public\\.' + f + '\\([^)]*\\) to authenticated').test(dossier), '2c ' + f + ' is callable by a signed-in user (the database checks the reviewer)');
}
ok(/innerHTML = render\(/.test(code) && (code.match(/\+ (?!esc\()[a-z_.]+\.(?:object_ref|display_text|evidence_quote|evidence_label|decision_reason|proposed_by)\b/g) || []).length === 0, '2d record text is never placed unescaped');

// 3. the SQL
ok(/grant execute on function public\.development_review_queue\(\) to authenticated;/.test(sql)
  && /revoke all on function public\.development_review_queue\(\) from public, anon, authenticated;/.test(sql), '3a the queue is for signed-in users only, and checks the reviewer itself');
ok(/only a current reviewer can read the review queue/.test(sql), '3b the queue refuses a non-reviewer');
ok(/publish-development-dossiers\.yml\/dispatches/.test(sql) && /'ref', 'main'/.test(sql) && /'dry_run', 'false'/.test(sql), '3c publishing starts the ingest publisher on main');
ok(/interval '2 minutes'/.test(sql), '3d publishing can be requested at most once every 2 minutes');
ok(/revoke all on public\.development_publish_request_log from public, anon, authenticated;/.test(sql), '3e the publish log is closed to the public key');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
