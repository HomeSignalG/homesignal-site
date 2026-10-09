// Validator for docs/brand/brand-contract.v1.json — the ONE authoritative brand/domain contract.
// stdlib only (no dependency), fail-closed: every rejection is a thrown BrandContractError whose
// message names the field. Nothing in this file is imported by shipped code; it lives under test/
// so it can never reach the Pages artifact (scripts/stage_site.py is an allowlist).
import { createHash } from 'node:crypto';

export const SUPPORTED_CONTRACT_VERSIONS = [1];
export const SUPPORTED_SCHEMA_VERSIONS = [1];
export const CONTRACT_NAME = 'homesignal-brand-contract';

const TOP_KEYS = ['contract', 'contract_version', 'schema_version', 'current_identity', 'future_identity', 'identities'];
const IDENTITY_KEYS = ['display_name', 'origin', 'state'];
const ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export class BrandContractError extends Error {}
const fail = (m) => { throw new BrandContractError(m); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A public origin: https, lowercase registrable host, no port/path/query/fragment/userinfo. */
export function assertOrigin(value, label) {
  if (typeof value !== 'string' || !value) fail(`${label}: origin must be a non-empty string`);
  let u;
  try { u = new URL(value); } catch { fail(`${label}: origin is not a URL: ${value}`); }
  if (u.protocol !== 'https:') fail(`${label}: origin must be https: ${value}`);
  if (u.username || u.password || u.port || u.search || u.hash || (u.pathname && u.pathname !== '/')) {
    fail(`${label}: origin must be a bare origin: ${value}`);
  }
  if (u.origin !== value) fail(`${label}: origin is not in canonical form (expected ${u.origin}): ${value}`);
  if (!HOST_RE.test(u.hostname)) fail(`${label}: invalid host: ${u.hostname}`);
  return u.origin;
}

export function validateContract(c) {
  if (!isObj(c)) fail('contract must be an object');
  for (const k of Object.keys(c)) if (!TOP_KEYS.includes(k)) fail(`unknown field: ${k}`);
  for (const k of TOP_KEYS) if (!(k in c)) fail(`missing required field: ${k}`);
  if (c.contract !== CONTRACT_NAME) fail(`contract name must be ${CONTRACT_NAME}`);
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(c.contract_version)) fail(`unsupported contract_version: ${c.contract_version}`);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(c.schema_version)) fail(`unsupported schema_version: ${c.schema_version}`);
  if (!isObj(c.identities)) fail('identities must be an object');
  const ids = Object.keys(c.identities);
  if (ids.length !== 2) fail(`exactly 2 identities are defined in v1, found ${ids.length}`);
  for (const id of ids) {
    if (!ID_RE.test(id)) fail(`bad identity key: ${id}`);
    const i = c.identities[id];
    if (!isObj(i)) fail(`${id}: must be an object`);
    for (const k of Object.keys(i)) if (!IDENTITY_KEYS.includes(k)) fail(`${id}: unknown field: ${k}`);
    for (const k of IDENTITY_KEYS) if (!(k in i)) fail(`${id}: missing required field: ${k}`);
    if (typeof i.display_name !== 'string' || !i.display_name.trim() || i.display_name !== i.display_name.trim()) fail(`${id}: display_name invalid`);
    assertOrigin(i.origin, id);
    if (!['active', 'inactive'].includes(i.state)) fail(`${id}: state must be active|inactive`);
  }
  if (!(c.current_identity in c.identities)) fail('current_identity does not name a defined identity');
  if (!(c.future_identity in c.identities)) fail('future_identity does not name a defined identity');
  if (c.current_identity === c.future_identity) fail('current_identity and future_identity must differ');
  if (c.identities[c.current_identity].origin === c.identities[c.future_identity].origin) fail('identities must have distinct origins');
  // Contract v1 FREEZES activation: HomeSignal is the only active identity. Activating the future
  // brand is a new contract_version plus a reviewed validator change — never a field flip.
  if (c.current_identity !== 'homesignal') fail('v1: current_identity must be homesignal');
  if (c.identities.homesignal.state !== 'active') fail('v1: homesignal must be active');
  if (c.identities.homesignal.origin !== 'https://homesignal.net') fail('v1: homesignal origin must be https://homesignal.net');
  if (c.future_identity !== 'jody') fail('v1: future_identity must be jody');
  if (c.identities.jody.state !== 'inactive') fail('v1: the future identity must be inactive');
  return c;
}

/** Deterministic serialization: recursively key-sorted, no whitespace. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const contractHash = (c) => createHash('sha256').update(canonicalJson(c)).digest('hex');

/** Compare a recorded pin (what a consumer vendors) with the contract. Version first, then hash. */
export function checkPin(contract, pin) {
  validateContract(contract);
  if (!isObj(pin) || typeof pin.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pin.sha256)) fail('pin is malformed');
  if (pin.contract_version !== contract.contract_version) {
    fail(`version mismatch: pin ${pin.contract_version} vs contract ${contract.contract_version}`);
  }
  const actual = contractHash(contract);
  if (pin.sha256 !== actual) fail(`hash mismatch: pin ${pin.sha256} vs contract ${actual}`);
  return true;
}
