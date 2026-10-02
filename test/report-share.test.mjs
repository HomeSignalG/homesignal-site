// REPORT SHARE LINKS — the engine-agnostic module (Development Activity plan, Order J, unit J1).
// supabase/functions/_shared/report-share.ts mints a share token, says whether a string is shaped like one, and turns it
// into the SHA-256 that is the only form in which it ever reaches the database. The database half (the tables, the one
// decision on whether a link is usable, the lock-down) is proven in test/report_share_pg; this file proves the half that
// runs in an edge function. Every expected hash below was computed OUTSIDE the module (Python hashlib over the token's
// 43 characters), so a module that hashed the wrong thing could not agree with it by construction.
// Run: node test/report-share.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const rejects = async (fn) => { try { await fn(); return false; } catch { return true; } };

const S = await import('../supabase/functions/_shared/report-share.ts');

// ── vectors computed outside the module ─────────────────────────────────────────────────────────────────────────────
const V = [
  // bytes 0..31
  { bytes: Uint8Array.from({ length: 32 }, (_, i) => i), token: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8', hash: 'ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0', raw: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd' },
  // 32 bytes of 0xff: the standard alphabet would print this as 42 '/' and an '8'
  { bytes: new Uint8Array(32).fill(0xff), token: '__________________________________________8', hash: '225f7e75329dd45aa354975d73987319309393af3a4c6733bc13601a4f1b8796', raw: 'af9613760f72635fbdb44a5a0a63c39f12af30f950a6ee5c971be188e89c4051' },
  // 32 bytes of 0xfb: the standard alphabet would print '+/v7' repeated
  { bytes: new Uint8Array(32).fill(0xfb), token: '-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_s', hash: 'd11835ca7edbd11d612c89ccda97f8054dde4f78485ff5b589336e8bd9e35315', raw: '456a04986c2572de19b058ef2ef20b0077017bcdb15819af052eb9d5d9b8e504' },
  // bytes 224..255: both '+' and '/' in the standard alphabet
  { bytes: Uint8Array.from({ length: 32 }, (_, i) => 224 + i), token: '4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8', hash: 'd90bad97384181273203dd0f8cc30e16a817bef7a51b026eb6bf0a7fcba3312a', raw: '9432c1a7d343fcfacb164bdc44ff71c1281c004886b1c428419088d06cd3561a' },
  // 32 zero bytes
  { bytes: new Uint8Array(32), token: 'A'.repeat(43), hash: '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a', raw: '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925' },
];
const B64URL = /^[A-Za-z0-9_-]{43}$/;

// Replace the platform CSPRNG with a recorder that fills the buffer it is given with the chosen bytes.
async function withRandom(bytes, fn) {
  const calls = [];
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'getRandomValues');
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true, writable: true,
    value: (arr) => { calls.push(arr.length); for (let i = 0; i < arr.length; i++) arr[i] = bytes[i]; return arr; },
  });
  const origMath = Math.random;
  Math.random = () => { throw new Error('Math.random was used'); };
  try { return { value: await fn(), calls }; }
  catch (e) { return { value: undefined, error: String((e && e.message) || e), calls }; }
  finally {
    Math.random = origMath;
    if (original) Object.defineProperty(globalThis.crypto, 'getRandomValues', original); else delete globalThis.crypto.getRandomValues;
  }
}

// ── 0. the module is what it claims to be ───────────────────────────────────────────────────────────────────────────────
ok(Object.keys(S).sort().join(',') === 'SHARE_TOKEN_BYTES,SHARE_TOKEN_LENGTH,hashShareToken,isWellFormedToken,newShareToken',
  '0: the module exports exactly three functions and two constants, nothing that could build a URL, read a database or take an address', Object.keys(S).sort().join(','));
ok(S.SHARE_TOKEN_BYTES === 32 && S.SHARE_TOKEN_LENGTH === 43 && Math.ceil(S.SHARE_TOKEN_BYTES * 4 / 3) === S.SHARE_TOKEN_LENGTH,
  '0b: a token is 32 bytes (256 bits) and 43 characters, and the two constants agree with each other');

// ── 1. minting ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = S.newShareToken();
  ok(typeof t === 'string' && t.length === 43 && B64URL.test(t) && !/[=+/]/.test(t),
    '1: a minted token is exactly 43 base64url characters — no padding, no "+", no "/"', t);
  const decoded = Buffer.from(t, 'base64url');
  ok(decoded.length === 32 && decoded.toString('base64url') === t,
    '1b: it decodes to exactly 32 bytes (256 bits), and re-encodes to itself (the canonical form)', decoded.length);
}
for (const v of V) {
  const r = await withRandom(v.bytes, () => S.newShareToken());
  ok(r.value === v.token && r.calls.length === 1 && r.calls[0] === 32,
    '1c: the token IS the unpadded base64url of the 32 bytes the platform CSPRNG returned (one call, 32 bytes) — ' + v.token.slice(0, 12) + '…', { got: r.value, calls: r.calls });
}
{
  const r = await withRandom(V[0].bytes, () => S.newShareToken());
  ok(r.error === undefined && r.value === V[0].token,
    '1d: Math.random is never consulted (the stub installed around every call above throws if it is) — a token is never derived from a weak generator', r.error);
}
{
  const draws = Array.from({ length: 1000 }, () => S.newShareToken());
  ok(new Set(draws).size === 1000 && draws.every((t) => B64URL.test(t) && S.isWellFormedToken(t)),
    '1e: 1,000 draws are 1,000 distinct, well-formed tokens');
  const perPosition = Array.from({ length: 43 }, (_, i) => new Set(draws.map((t) => t[i])).size);
  ok(perPosition.slice(0, 42).every((c) => c >= 58) && perPosition[42] >= 14 && perPosition[42] <= 16,
    '1f: every one of the 43 positions takes (almost) every value its alphabet allows — 64 for the first 42, and the 16 that 4 bits can encode for the last — so no part of a token is constant or short of entropy', perPosition.join(','));
}

// ── 2. hashing ──────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const v of V) {
  const h = await S.hashShareToken(v.token);
  ok(h === v.hash && h === createHash('sha256').update(v.token, 'ascii').digest('hex') && /^[0-9a-f]{64}$/.test(h),
    '2: hashShareToken(' + v.token.slice(0, 12) + '…) is the SHA-256 of the 43 characters, as 64 lower-case hex digits, equal to a vector computed outside the module', h);
  ok(h !== v.raw, '2b: …and it is NOT the hash of the 32 bytes the token encodes (' + v.raw.slice(0, 8) + '…)', h);
}
{
  const a = 'A'.repeat(43), b = 'A'.repeat(42) + 'B';
  ok(Buffer.from(a, 'base64url').equals(Buffer.from(b, 'base64url')) && (await S.hashShareToken(a)) !== (await S.hashShareToken(b)),
    '2c: two different 43-character strings that decode to the SAME 32 bytes hash differently, so exactly one string resolves to a share (hashing the decoded bytes would have made both resolve)');
  ok((await S.hashShareToken(a)) === (await S.hashShareToken(a)), '2d: hashing is deterministic');
  ok(await rejects(() => S.hashShareToken('A'.repeat(42))) && await rejects(() => S.hashShareToken('')) && await rejects(() => S.hashShareToken('A'.repeat(42) + '=')) && await rejects(() => S.hashShareToken(null))
     && await rejects(() => S.hashShareToken(('A'.repeat(43) + '\n'))) && await rejects(() => S.hashShareToken(['A'.repeat(43)])),
    '2e: a string that is not a well-formed token — short, empty, padded, null, with a trailing newline, an array holding a token — is REFUSED, never hashed as though it were one');
}

// ── 3. well-formedness ─────────────────────────────────────────────────────────────────────────────────────────────────────
const real = S.newShareToken();
ok(S.isWellFormedToken(real) && V.every((v) => S.isWellFormedToken(v.token)),
  '3: a minted token and every vector above are well-formed');
const rejected = [
  ['one character short', 'A'.repeat(42)], ['one character long', 'A'.repeat(44)], ['empty', ''],
  ['padded to 44 with "="', 'A'.repeat(43) + '='], ['42 characters and one "="', 'A'.repeat(42) + '='],
  ['a "+" (standard alphabet)', 'A'.repeat(42) + '+'], ['a "/" (standard alphabet)', 'A'.repeat(42) + '/'],
  ['a space', 'A'.repeat(42) + ' '], ['a trailing newline', 'A'.repeat(43) + '\n'], ['a leading newline', '\n' + 'A'.repeat(42)],
  ['junk in front of a full token', '!' + real], ['junk behind a full token', real + '!'],
  ['a non-ASCII letter', 'A'.repeat(42) + 'é'], ['a Cyrillic lookalike for "A"', 'А'.repeat(43)], ['a 64-digit hash', 'a'.repeat(64)],
];
for (const [what, s] of rejected) ok(S.isWellFormedToken(s) === false, '3b: ' + what + ' is not a token');
ok([null, undefined, 0, 43, true, {}, [], [real], { toString: () => real }, new String(real), Symbol.iterator].every((x) => S.isWellFormedToken(x) === false),
  '3c: a value that is not a string is never a token — including an array holding a token, an object that prints as one and a String object');
ok(S.isWellFormedToken('a'.repeat(64)) === false && S.isWellFormedToken(real) === true && real.length !== 64,
  '3d: a token can never be mistaken for the 64-digit hash the database stores (43 characters against 64), so a raw token handed to the database is refused by its hash check');

// ── 4. parity with the database's own rule for what a stored hash looks like ─────────────────────────────────────────────────
{
  const sql = readFileSync(join(root, 'docs/report-share.sql'), 'utf8');
  const m = sql.match(/check \(token_sha256 ~ '([^']+)'\)/);
  const rule = m ? new RegExp(m[1]) : null;
  const hashes = [...V.map((v) => v.hash), ...(await Promise.all(Array.from({ length: 200 }, () => S.hashShareToken(S.newShareToken()))))];
  ok(!!rule && hashes.every((h) => rule.test(h)) && !rule.test(real),
    '4: every hash this module produces satisfies the exact CHECK the share table puts on token_sha256 (read from the SQL of record), and a token does not', m && m[1]);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
