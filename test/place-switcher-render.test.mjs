// VIEWING CHIP — the switcher must list BOTH Place types from the live function.
//
// WHY THIS FILE EXISTS. The chip used to open an Address-only list titled
// "Switch zip code", so a resident with 3 ZIP Codes and 0 Addresses (the
// production screenshot on My Places) was told they follow 0 saved places and
// offered only "+ Add Address". String pins in my-places-contract.test.mjs
// lock the wiring. This file RUNS the live HS.openSwitcher body against that
// screenshot case, so a later edit that still mentions followedCommunities
// but stops rendering ZIP rows cannot go green.
import fs from 'node:fs';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 240) : ''));
  if (!c) fails++;
};

const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
const fn = (shell.match(/HS\.openSwitcher = function \(\) \{[\s\S]*?\n  \};/) || [''])[0];
ok(fn.length > 200, 'live openSwitcher body extracted from shell.js');

function render(opts) {
  const captured = { title: '', sub: '', html: '', opened: false };
  const HS = {
    followedCommunities: () => opts.zips || [],
    esc: (s) => String(s == null ? '' : s),
    isRealHome: (p) => !!(p && p.tag === 'Your home'),
    placeDisplayTag: (p, fallback) => {
      var raw = p && (p.tag || p.label);
      if (!raw) return fallback || 'Address';
      if (/^(your home|my home|home)$/i.test(String(raw).trim())) return fallback || 'Address';
      return String(raw);
    },
    openModal: () => { captured.opened = true; }
  };
  const state = {
    properties: opts.addresses || [],
    activeProperty: opts.home || null,
    activePropId: opts.home ? opts.home.id : null,
    zip: opts.zip || '75009',
    viewLabelPrecise: false
  };
  const nodes = {
    switcherList: { set innerHTML(v) { captured.html = v; }, get innerHTML() { return captured.html; } },
    switcherTitle: { set textContent(v) { captured.title = v; }, get textContent() { return captured.title; } },
    switcherSub: { set textContent(v) { captured.sub = v; }, get textContent() { return captured.sub; } }
  };
  const $ = (id) => nodes[id] || null;
  const run = new Function('HS', 'state', '$', fn + '\nHS.openSwitcher();');
  run(HS, state, $);
  return captured;
}

const zips = [
  { zip: '75009', name: 'Celina', state: 'TX' },
  { zip: '78617', name: 'Del Valle', state: 'TX' },
  { zip: '84301', name: 'Bear River City', state: 'UT' }
];
const shot = render({ addresses: [], zips, zip: '75009' });

ok(shot.opened, 'opens the switcher modal');
ok(shot.title === 'Switch place', 'title is Switch place', shot.title);
ok(shot.sub === 'You have 3 places. Pick one to focus the app on it.',
  'screenshot case: 3 ZIP Codes count as 3 places, not 0 Addresses', shot.sub);
ok(!/You're following 0/.test(shot.sub), 'does not claim 0 followed places');
ok(/Addresses \(0\)/.test(shot.html) && /ZIP Codes \(3\)/.test(shot.html),
  'sections stay distinct — Addresses (0) and ZIP Codes (3)');
ok(/No Addresses yet/.test(shot.html), 'empty Address section is honest, not a missing list');
ok(/Celina/.test(shot.html) && /Del Valle/.test(shot.html) && /Bear River City/.test(shot.html),
  'all three followed ZIP Codes are listed');
ok(/onclick="HS\.switchZip\('75009'\)"/.test(shot.html)
  && /onclick="HS\.switchZip\('78617'\)"/.test(shot.html)
  && /onclick="HS\.switchZip\('84301'\)"/.test(shot.html),
  'ZIP rows focus via switchZip, not the Census Address writer');
ok(!/HS\.switchProperty/.test(shot.html),
  'screenshot case has no Address rows to switch');
ok(/class="swrow active" onclick="HS\.switchZip\('75009'\)"/.test(shot.html),
  'the currently viewed ZIP is the checked row');
ok(!/from\('app_properties'\)/.test(shot.html), 'render path does not write app_properties');

const mixed = render({
  zip: '78617',
  home: { id: 'h1', address: '13313 COOMES DR', city: 'Del Valle', state: 'TX', zip: '78617', tag: 'Your home', score: 82 },
  addresses: [{ id: 'h1', address: '13313 COOMES DR', city: 'Del Valle', state: 'TX', zip: '78617', tag: 'Your home', score: 82 }],
  zips
});
ok(mixed.sub === 'You have 4 places. Pick one to focus the app on it.',
  'an Address plus 3 ZIP Codes counts as 4 places', mixed.sub);
ok(/onclick="HS\.switchProperty\('h1'\)"/.test(mixed.html)
  && /onclick="HS\.switchZip\('75009'\)"/.test(mixed.html),
  'mixed case keeps Address click and ZIP click on their own writers');
ok(/class="swrow active" onclick="HS\.switchProperty\('h1'\)"/.test(mixed.html),
  'when the saved home is the current view, the Address row is checked');
ok(!/class="swrow active" onclick="HS\.switchZip\('78617'\)"/.test(mixed.html),
  '...and the ZIP Code in that same area is not also checked');
ok(!/Your home/i.test(mixed.html),
  'Fix 9: mixed HTML never labels a saved address as the user\'s home', mixed.html.slice(0, 240));

console.log(fails ? '\n' + fails + ' failed' : '\nAll place-switcher render assertions passed.');
process.exit(fails ? 1 : 0);
