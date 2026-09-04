// TWO HOSTS, ONE SHARED RUNTIME — they must load the same dependencies.
//
// lib/community-page.js is loaded by TWO documents: the dynamic community.html, and every
// generated /community/<zip>/ document that scripts/gen_zip_pages.py emits into the Pages
// artifact. A dependency added to one host and not the other is invisible until the exact
// data shape that reaches the new code appears at runtime.
//
// THE DEFECT THIS EXISTS TO PREVENT (2026-09-04): lib/gov-notice-copy.js was added to
// community.html only, while the shared runtime began calling HS.govNoticeCopy.build() for
// a ZIP with no notices. Every generated document therefore threw
//   TypeError: Cannot read properties of undefined (reading 'build')
// the moment a sampled ZIP had zero notices — and because that branch is data-dependent, it
// passed the Pages build gate at 20:50 and failed it at 23:27 on the same code (run
// 33929420398, ZIPs 01001 and 01002), blocking every site deployment until it was fixed.
//
// The assertion is deliberately blunt: the two hosts load the SAME scripts in the SAME
// order. Nothing here knows or cares what gov-notice-copy.js does — it catches the next
// shared dependency too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

// A leading "/" is the only legitimate difference: the generated document sits two levels
// deep and carries <base href="/">, so it names its scripts absolutely.
const norm = (u) => String(u).replace(/^\//, '');

const htmlScripts = (html) =>
  [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => norm(m[1]));

// The generator emits its script tags as Python string literals, so the same regex reads
// them out of the source — the shipped template, not a copy of it.
const genScripts = (py) =>
  [...py.matchAll(/<script src=\\?"([^"\\]+)\\?"/g)].map((m) => norm(m[1]));

const community = htmlScripts(read('community.html'));
const generated = genScripts(read('scripts/gen_zip_pages.py'));

ok(community.length >= 8, 'community.html loads the shared runtime', community);
ok(generated.length >= 8, 'the generated ZIP document loads the shared runtime', generated);

ok(community.includes('lib/community-page.js') && generated.includes('lib/community-page.js'),
  'both hosts load lib/community-page.js — that is what makes them two hosts of one runtime');

// THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT.
const missing = community.filter((s) => !generated.includes(s));
const extra = generated.filter((s) => !community.includes(s));
ok(missing.length === 0,
  'every script community.html loads is also loaded by the generated ZIP document', missing);
ok(extra.length === 0,
  'and the generated document loads nothing community.html does not', extra);
ok(JSON.stringify(community) === JSON.stringify(generated),
  'the two hosts load the same scripts in the same ORDER (a dependency must precede its consumer)',
  { community, generated });

// The specific ordering the crashed branch needs, named so a reordering is loud.
const before = (list, dep, consumer) => list.indexOf(dep) >= 0 && list.indexOf(dep) < list.indexOf(consumer);
ok(before(generated, 'lib/gov-notice-copy.js', 'lib/community-page.js'),
  'gov-notice-copy.js loads BEFORE community-page.js in the generated document', generated);
ok(before(community, 'lib/gov-notice-copy.js', 'lib/community-page.js'),
  '...and in community.html', community);

// The consumer this is protecting. If the call ever moves, this test should be re-aimed
// rather than silently protecting nothing.
const runtime = read('lib/community-page.js');
ok(/HS\.govNoticeCopy\.build\(/.test(runtime),
  'the shared runtime still calls HS.govNoticeCopy.build (the consumer this protects)');
ok(/HS\.govNoticeCopy\s*=/.test(read('lib/gov-notice-copy.js')),
  '...and lib/gov-notice-copy.js is what defines it');

// The generated document resolves relative URLs from the site root, which is what lets the
// runtime's relative fetch of the coverage artifact work two levels deep. (Checked because
// the deployment post-mortem suspected this path and it turned out to be sound — pinning it
// keeps that true.)
ok(/<base href="\/">/.test(read('scripts/gen_zip_pages.py')),
  'the generated document keeps <base href="/">, so the runtime\'s relative fetches resolve');

console.log(fails ? '\n' + fails + ' shared-runtime assertion(s) FAILED.' : '\nAll shared-runtime assertions passed.');
process.exit(fails ? 1 : 0);
