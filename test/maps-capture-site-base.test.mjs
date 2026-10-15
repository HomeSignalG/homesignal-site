// The capture job photographs the Map 1 page of ONE origin. The default stays the standing value
// (a scheduled run has no inputs), and a dispatch can name another origin, so the Jody origin can be
// proven with a dry run before the default moves.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const y = readFileSync(new URL('../.github/workflows/maps-social-image.yml', import.meta.url), 'utf8');
assert.match(y, /site_base:\n\s+description:[^\n]*\n\s+default: ''/, 'a site_base input must exist and default to empty');
assert.match(y, /BASE: \$\{\{ inputs\.site_base \|\| 'https:\/\/jodytracks\.com' \}\}/, 'BASE must come from the input, falling back to the Jody origin');
assert.equal((y.match(/^\s+BASE:/gm) || []).length, 1, 'BASE must be set in exactly one place');
console.log('maps-capture-site-base: ok');
