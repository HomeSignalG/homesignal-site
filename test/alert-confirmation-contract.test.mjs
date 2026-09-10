// The site half of the ALERT SIGN-UP CONFIRMATION contract.
//
// The confirmation email itself is built and sent in homesignal-ingest
// (supabase/functions/confirm-alerts/* + the alert_confirmation_hook migration). It is
// NOT sent from this repo, and no page here may ever send it — email from browser code
// is forbidden.
//
// But the email reproduces three facts this repo OWNS, server-side, where it cannot call
// HS.pageHref or HS.homeAddressLine:
//
//   1. the address line format          (HS.homeAddressLine, shell.js)
//   2. the canonical ZIP page URL       (scripts/gen_zip_pages.py -> /community/<zip>/)
//   3. My Places as the manage surface  (properties.html)
//
// Change one of them here and the email drifts silently in the other repo — a resident
// gets a CTA that 404s, or an address line that no longer matches what the app shows.
// This file exists so that change fails HERE, naming the email, instead of being
// discovered in an inbox.
//
// Offline: reads source text only. No network, no DB, no browser.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; console.log('PASS —', label); }
  else { fails.push(label); console.log('FAIL —', label); }
}

// ------------------------------------------------------------------ 1. address line
const shell = read('shell.js');
const addrAt = shell.indexOf('HS.homeAddressLine = function');
// Include the doc comment above the function: the "absent parts stay absent" rule is
// stated there, and it is the half the SQL reproduces with nullif().
const addrBody = shell.slice(Math.max(0, addrAt - 400), addrAt + 400);

ok(/HS\.homeAddressLine = function/.test(shell),
   'HS.homeAddressLine is still the ONE formatter for a saved address');

// The ingest claim RPC mirrors this exact composition with concat_ws/nullif. If the
// order or the separators change here, the email stops matching the app.
ok(addrBody.includes("[p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')"),
   'address tail is still  city, "state zip"  (mirrored by alert_confirmation_claim)');
ok(addrBody.includes("[p.address, tail].filter(Boolean).join(', ')"),
   'address line is still  address, tail  (mirrored by alert_confirmation_claim)');
ok(/absent parts stay absent|never guessed/.test(addrBody),
   'the "absent parts stay absent" contract is still stated — the SQL reproduces it via nullif()');

// ------------------------------------------------------------------ 2. canonical ZIP URL
const gen = read('scripts/gen_zip_pages.py');
ok(gen.includes('canon = f"{BASE}/community/{z}/"'),
   'the canonical ZIP page is still /community/<zip>/ — the email CTA points here');
ok(gen.includes('BASE = "https://homesignal.net"'),
   'the canonical origin is still https://homesignal.net');

// The email must NOT link the legacy query URL: the generated page canonicalises away
// from it, and this repo deliberately stopped linking it internally for that reason.
ok(/canonicalises here|canonicalises away/.test(gen),
   'community.html?zip= is still documented as canonicalising to /community/<zip>/');

// ------------------------------------------------------------------ 3. My Places
ok(read('properties.html').length > 0,
   'properties.html (My Places) still exists — the email manage link targets it');

// ------------------------------------------------------------------ no email from the client
// The confirmation is sent server-side only. Nothing in this repo may call Resend or the
// confirmation function from page code.
const clientFiles = ['shell.js', 'properties.html', 'community.html', 'index.html'];
for (const f of clientFiles) {
  const src = read(f);
  ok(!/api\.resend\.com/.test(src), `${f} never calls Resend from the browser`);
  ok(!/functions\/v1\/confirm-alerts/.test(src), `${f} never invokes confirm-alerts from the browser`);
}

// ------------------------------------------------------------------ consent is unchanged
// enable_area_email_alerts remains the ONLY writer of marketing_consent, and the follow
// still leaves it false. test/email-optin.test.mjs is the full contract; this is the one
// assertion the EMAIL depends on — it must never send for a follow-only row.
const optin = read('docs/email-optin-consent.sql');
ok(/marketing_consent\s*=\s*true/.test(optin) && /ONLY writer of marketing_consent/.test(optin),
   'marketing_consent is still alert-email consent, set only by the explicit opt-in');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.error('\nFAILED:\n  ' + fails.join('\n  '));
  process.exit(1);
}
