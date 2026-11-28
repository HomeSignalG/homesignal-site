// The consent sentence a resident SEES beside Save alerts / Finish saving is the one RECORDED with the save.
// Run: node test/consent-copy-shown-equals-recorded.browser.test.mjs
import fs from 'node:fs';
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const js = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../partials/shell.html', import.meta.url), 'utf8');
const copy = (js.match(/const CONSENT_COPY = '([^']+)'/) || [])[1];
ok(copy === 'Email me JODY alerts for the topics I selected. Alerts start only where verified coverage exists. No spam · Unsubscribe anytime.', 'approved sentence');
ok(!/You'll be alerted about the topics/.test(js), 'old promise sentence is gone');
ok(/const CONSENT_VERSION = '2026-11-27'/.test(js), 'version bumped');
ok(/AREA_CONSENT_VERSION = '2026-07-16'/.test(js) && /topics, AREA_CONSENT_VERSION, AREA_CONSENT_COPY/.test(js), 'area opt-in keeps its own old version');
ok(/p_marketing_consent_copy: CONSENT_COPY/.test(js), 'topic save records CONSENT_COPY');
ok(/id="tmConsentCopy"/.test(html) && /tmConsentCopy[^}]*textContent = CONSENT_COPY/.test(js), 'picker note is filled from CONSENT_COPY');
ok(/id="finishConsent">' \+ HS\.esc\(CONSENT_COPY\)/.test(js), 'Finish saving box shows CONSENT_COPY');
process.exit(fails ? 1 : 0);
