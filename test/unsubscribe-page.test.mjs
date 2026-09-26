// homesignal.net/unsubscribe — the founder's text for a Map 1 sign-up (2026-09-26,
// "change the text to this"). Offline pins over the shipped page; the rendering itself is
// driven in Chromium by test/unsubscribe-page.browser.test.mjs.
//
// The page may say "those subscriptions are separate and will continue as usual" only when
// the unsubscribe function (homesignal-ingest supabase/functions/unsubscribe) answers
// maps_only: the identity it turned off carried nothing but the map sign-up. The function
// decides that with the confirmation email's own isMapsOnly rule; this page only renders it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FOUNDER_TITLE, FOUNDER_LINES, GENERAL_TITLE, GENERAL_TEXT } from './lib/unsubscribe-founder-copy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'unsubscribe.html'), 'utf8');

test("the founder's text is in the page, verbatim and in order, ending with the map link", () => {
  // The page builds two strings around the ZIP; fill it in to compare whole lines.
  const src = page.replace(/" \+ zip \+ "/g, '97702');
  let at = src.indexOf('"' + FOUNDER_TITLE + '"');
  assert.ok(at >= 0, 'title');
  for (const line of FOUNDER_LINES('97702')) {
    const next = src.indexOf('"' + line + '"', at + 1);
    assert.ok(next > at, 'missing, reworded or out of order: ' + line);
    at = next;
  }
  assert.ok(src.indexOf('cta.textContent = "Return to the 97702 map";', at) > at, 'the CTA label');
  assert.ok(page.includes('cta.href = "https://homesignal.net/homesignalmap.html?zip=" + zip;'), 'the CTA opens Map 1');
});

test('the general message and the other statuses are unchanged', () => {
  for (const s of [
    `unsubscribed:  ["${GENERAL_TITLE}", "${GENERAL_TEXT}"]`,
    `not_found:     ["Link not recognized", "This unsubscribe link is invalid or has already been used."]`,
    `missing_token: ["Invalid link", "This unsubscribe link is missing its token."]`,
    `error:         ["Something went wrong", "We couldn't process your request right now. Please try again later."]`,
    '>Go to HomeSignal</a>',
  ]) assert.ok(page.includes(s), s);
});

test('the map text needs status unsubscribed, maps_only === true and a 5-digit ZIP', () => {
  assert.ok(page.includes(
    'return !!d && d.status === "unsubscribed" && d.maps_only === true && /^\\d{5}$/.test(String(d.zip));'));
  assert.ok(page.includes('if (isMapsAnswer(d)) showMaps(String(d.zip)); else show('));
  // Text goes in through textContent, never innerHTML, so nothing in an answer is markup.
  assert.ok(!/innerHTML/.test(page));
});
