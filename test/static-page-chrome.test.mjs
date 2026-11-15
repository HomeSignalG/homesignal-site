// The static generated pages (guides, area hubs, city, project, project list) carry the site's
// own header, footer and page styles (founder, 2026-11-15: the guide Google showed was bare).
// Runs the SHIPPED generator's renderers. Pinned:
//   1. each family has the header from partials/shell.html, the footer, and the page <style>
//   2. Sign in returns to the page's own path; no inline script, no share box (no script runs it)
//   3. the project-count label is not drawn as app.css's dashed .quiet box
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const py = `
import json, sys
sys.path.insert(0, 'scripts')
import gen_zip_pages as g
c = {'a': dict(state='AL', place='Huntsville', slug='huntsville', count=1053, zips=['35801'])}
print(json.dumps({'guide': g.render_guide_what(c, '2026-11-15'),
                  'check': g.render_guide_check({}, {}, '2026-11-15'),
                  'body': g.static_body('city', '/city/al/huntsville/', '<main id="hs-ssr">x</main>')}))
`;
const out = JSON.parse(execFileSync('python3', ['-c', py], { cwd: root, encoding: 'utf8' }));
const shell = readFileSync(join(root, 'partials', 'shell.html'), 'utf8');

for (const [name, html] of [['what guide', out.guide], ['check guide', out.check]]) {
  ok(/<header class="hs-header" id="hs-top">/.test(html), `${name}: site header present`);
  ok(/<footer class="hs-footer" id="hs-footer">/.test(html), `${name}: site footer present`);
  ok(/<style>[\s\S]*#hs-ssr\{[^}]*max-width:860px/.test(html), `${name}: page width style present`);
  ok(/#hs-ssr \.quiet\{border:0/.test(html), `${name}: .quiet is plain text, not the dashed box`);
  ok(!/<script(?![^>]*application\/ld\+json)/.test(html), `${name}: ships no executable script`);
  ok(!/id="shareModal"/.test(html), `${name}: no share box without a script to open it`);
  ok(/script-src 'none'/.test(html), `${name}: CSP still forbids scripts`);
}
ok(/href="\/\?signin=1&amp;return=%2Fguides%2Fwhat-is-being-built-near-me%2F"/.test(out.guide),
  'Sign in returns to the guide');
ok(/return=%2Fcity%2Fal%2Fhuntsville%2F/.test(out.body), 'static_body: Sign in returns to the given path');
ok(/^<body data-nav="city">\n<header class="hs-header"/.test(out.body) && /<\/footer>\n<\/body>\n<\/html>\n$/.test(out.body),
  'static_body: header, page, footer in that order');
ok(shell.includes('class="hs-footer__links"') && out.guide.includes('class="hs-footer__links"'),
  'footer links come from partials/shell.html');

const gen = readFileSync(join(root, 'scripts', 'gen_zip_pages.py'), 'utf8');
for (const nav of ['city', 'project', 'project-list', 'guide'])
  ok(new RegExp(`static_body\\("${nav}"`).test(gen), `generator: ${nav} pages use static_body`);
ok(!/<body data-nav="(city|project|project-list|guide)">\\n\{body\}/.test(gen), 'generator: no bare <body> left for these families');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
