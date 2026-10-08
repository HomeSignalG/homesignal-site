// Report share links — the engine-agnostic half (Development Activity plan, Order J, unit J1).
//
// A share link is an opaque, revocable, optionally expiring key to ONE stored report. The key is a random 256-bit
// token that exists only in the link its owner hands out. The DATABASE NEVER SEES THE TOKEN: this module turns it into
// its SHA-256 and only that hash is ever sent (docs/report-share.sql). So a read of the share tables yields no usable
// link, and a link that is lost cannot be recovered; it is revoked and reissued.
//
// This file does three things and nothing else:
//   newShareToken()      32 random bytes from the platform's CSPRNG, as unpadded base64url: exactly 43 characters.
//   isWellFormedToken()  is this string shaped like a token this module could have minted?
//   hashShareToken()     SHA-256, as 64 lower-case hex digits, of the token's own 43 characters.
//
// It builds no URL, accepts no address, ZIP or radius, reads no environment, imports nothing and has no way to reach a
// database or a network: the caller owns every one of those. Where a token goes in a link, and how a link is kept out of
// what is sent to a third party, are decisions of the unit that builds the link (J2), not of this primitive.
//
// WHY THE HASH IS OF THE TOKEN'S CHARACTERS AND NOT OF THE BYTES THEY ENCODE. The 43rd character carries 4 bits and 2
// padding bits, so several different 43-character strings decode to the same 32 bytes. Hashing the decoded bytes would make
// all of them resolve to one share; hashing the string makes exactly one string resolve. This is also a CONTRACT with the
// stored hashes: changing how a token is hashed would orphan every link already issued, which is why this module does NOT
// reuse the snapshot module's hash helper (a change to how report bodies are hashed must never move it).

/** Bytes of randomness in a token: 256 bits. Guessing one is not feasible. */
export const SHARE_TOKEN_BYTES = 32;
/** Characters in a token: 32 bytes as unpadded base64url is ceil(32 * 4 / 3) = 43. */
export const SHARE_TOKEN_LENGTH = 43;

const TOKEN_RE = new RegExp('^[A-Za-z0-9_-]{' + SHARE_TOKEN_LENGTH + '}$');

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new share token. Every call draws fresh bytes from the platform's CSPRNG; nothing is derived from anything. */
export function newShareToken(): string {
  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * True only for a string of exactly 43 base64url characters: no padding, no standard-alphabet '+' or '/', no whitespace.
 * A value that is not a string is never well-formed, however it would print.
 */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/**
 * The SHA-256 of the token's own characters, as 64 lower-case hex digits: the only form in which a token reaches the
 * database. Refuses a string that is not a well-formed token, so nothing but a token is ever hashed as one.
 */
export async function hashShareToken(token: string): Promise<string> {
  if (!isWellFormedToken(token)) throw new Error('hashShareToken: not a well-formed share token');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
