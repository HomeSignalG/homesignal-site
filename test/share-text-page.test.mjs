// share-text.html — the https hand-off behind the digest email's "Messages" button.
// Desktop webmail strips `sms:` links (Proton rendered the icon with no link at all), so the
// email links here and this page opens Messages. The page must never become an open relay
// for arbitrary pre-filled text, and it must actually ship.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const S = require('../lib/share-text.js');
let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || !detail ? '' : ' — ' + detail));
  if (!cond) fails++;
}

const PAGE = 'https://homesignal.net/community.html?zip=84302';
const q = (u, c) => '?' + new URLSearchParams(c == null ? { u } : { u, c }).toString();

// 1. The real email link produces the same message the email itself uses.
const m = S.model(q(PAGE, 'Box Elder County'));
check('1a valid link accepted', m.ok === true);
check('1b message matches the email share text',
  m.message === 'HomeSignal daily briefing — Box Elder County ' + PAGE, m.message);
check('1c sms href carries the encoded message',
  m.smsHref === 'sms:?&body=' + encodeURIComponent(m.message), m.smsHref);
check('1d label optional', S.model(q(PAGE)).message === 'HomeSignal daily briefing ' + PAGE);

// 2. Not an open relay: only our own https pages; no free text.
for (const bad of ['https://evil.example/x', 'http://homesignal.net/', 'javascript:alert(1)',
  'https://homesignal.net.evil.example/', 'https://user@homesignal.net/', 'https://homesignal.net:8443/', '']) {
  check('2 refuses u=' + JSON.stringify(bad), S.model(q(bad)).ok === false);
}
const spam = S.model(q(PAGE, 'WIN $$$ click http://x.y'));
check('2b a label with URL/odd chars is dropped, not relayed', spam.ok && !/WIN|http:\/\/x/.test(spam.message), spam.message);
check('2c an over-long label is dropped', S.model(q(PAGE, 'a'.repeat(81))).text === 'HomeSignal daily briefing');
check('2d real labels survive', S.model(q(PAGE, "Salt Lake City / Millcreek (84106)")).text.endsWith('Millcreek (84106)'));
check('2e no "body"/"text" param is ever read', S.model(q(PAGE) + '&body=spam&text=spam').message.indexOf('spam') === -1);

// 3. Phone detection drives the auto-open only.
check('3a iPhone is a phone', S.isPhone('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'));
check('3b Mac desktop is not', !S.isPhone('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'));

// 4. The page wires the module, is noindex, and ships.
const html = fs.readFileSync(new URL('../share-text.html', import.meta.url), 'utf8');
check('4a page loads lib/share-text.js', /<script src="lib\/share-text\.js\?v=[0-9a-f]{8}">/.test(html));
check('4b page is noindex', /<meta name="robots" content="noindex/.test(html));
check('4c page never builds a message from raw params', !/searchParams|URLSearchParams/.test(html.replace(/<!--[\s\S]*?-->/g, '')));
const robots = fs.readFileSync(new URL('../robots.txt', import.meta.url), 'utf8');
check('4d robots disallows it', robots.includes('Disallow: /share-text.html'));
const staged = execFileSync('python3', ['-c',
  'import sys; sys.path.insert(0,"scripts"); import stage_site; print("\\n".join(stage_site.staged_paths(".")))'],
  { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n');
check('4e share-text.html ships', staged.includes('share-text.html'));
check('4f lib/share-text.js ships', staged.includes('lib/share-text.js'));

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll share-text-page assertions passed.');
