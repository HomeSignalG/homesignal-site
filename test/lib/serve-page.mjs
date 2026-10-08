// A local page server for the browser suites reads the site's HTML through this readFile.
//
// WHY. Every page loads supabase-js from the CDN pinned to one exact version WITH an integrity hash (audit item,
// 2026-10-08: "lock every page to one exact, checked version"). The browser suites replace that CDN request with a stand-in
// (page.route ... route.fulfill), and a stand-in cannot match the real file's hash, so the browser would refuse it. This
// strips the integrity attribute from that ONE script tag, and only when a test serves the page to itself. The shipped
// files are untouched, and test/supabase-js-pin.test.mjs pins that every shipped page carries the exact version and hash.
import { readFile as rf } from 'node:fs/promises';
import { readFileSync as rfs } from 'node:fs';

const SRI = /(<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[0-9.]+") integrity="[^"]*" crossorigin="anonymous"(><\/script>)/g;

export async function readFile(p, ...rest) {
  const out = await rf(p, ...rest);
  if (typeof p !== 'string' || !p.endsWith('.html')) return out;
  const text = Buffer.isBuffer(out) ? out.toString('utf8') : out;
  const stripped = text.replace(SRI, '$1$2');
  return Buffer.isBuffer(out) ? Buffer.from(stripped, 'utf8') : stripped;
}

// The same for a suite that serves its pages with the synchronous reader.
export function readFileSync(p, ...rest) {
  const out = rfs(p, ...rest);
  if (typeof p !== 'string' || !p.endsWith('.html')) return out;
  const text = Buffer.isBuffer(out) ? out.toString('utf8') : out;
  const stripped = text.replace(SRI, '$1$2');
  return Buffer.isBuffer(out) ? Buffer.from(stripped, 'utf8') : stripped;
}
