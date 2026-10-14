// ONE definition of the COMPOUND RECORD IDENTITY for layers whose identifier column is reused by
// unrelated features (docs/denton-workstream-b-2026-10-14.md, docs/denton-permit-identity-design-2026-10-14.md).
//
// THE RULE (a pure function of the publisher's data, so every ZIP, run and generation agrees):
//   * of the features that share one identifier value, the LOWEST OBJECTID keeps the LEGACY identity (the bare
//     identifier) - every stored key, link, post and history row it already has stays valid;
//   * every other feature that is a DIFFERENT record gets  <identifier>#<OBJECTID>;
//   * a feature that is a true publisher duplicate of an earlier one (same attributes, same place) shares that
//     earlier feature's identity, so exact-identity dedup keeps collapsing it.
// The set of non-legacy features is NOT derived at fetch time (a ZIP envelope sees only some of a reused id's
// features, so the same feature would get different keys on different pages). It comes from a GENERATED,
// fingerprinted file (scripts/gen_identity_aliases.py) that the registry names with `identity_aliases_file`.
//
// FAIL CLOSED, EVERY DIRECTION: no file, a file for another registry/column, a row without its OBJECTID, or an
// alias that does not extend the row's CURRENT identifier -> the legacy identity, exactly as before this module
// existed. The CI gate (scripts/check_identity_aliases.py) is what makes "missing" loud; this function only
// guarantees it can never mint a wrong key.
//
// scripts/identity_aliases.py::source_identity is the Python twin used by scripts/n5_shard.py. Both are pinned
// to the same cases (test/identity-alias-parity.test.mjs); neither may grow a private copy of the rule.

export interface IdentityAliasFile {
  /** schema version of this file format */
  version: 1;
  /** registry_id this file belongs to (must equal the entry that names it) */
  registry_id: string;
  /** the publisher column that carries the (reused) identifier, e.g. PermitID */
  id_field: string;
  /** the publisher's unique per-feature column, e.g. OBJECTID */
  oid_field: string;
  /** { "<OBJECTID>": "<identifier>#<representative OBJECTID>" } for every feature whose identity is not the bare identifier */
  aliases: Record<string, string>;
  /** scan facts and the two fingerprints (see scripts/identity_aliases.py) - integrity metadata, not read at fetch time */
  scan?: Record<string, unknown>;
}

export type IdentityAliasFiles = Record<string, IdentityAliasFile>;

export type AliasVerdict =
  | { ok: true; file: IdentityAliasFile }
  | { ok: false; reason: string };

/** Is `file` a usable alias file for `entry`? The reason is reported once per run, never silently dropped. */
export function aliasFileFor(
  entry: { registry_id: string; identity_aliases_file?: string; identity_fields?: string[]; column_map: { case_number?: unknown } },
  files: IdentityAliasFiles | null | undefined,
): AliasVerdict | null {
  const name = entry.identity_aliases_file;
  if (!name) return null;                                   // not opted in: the legacy ladder, untouched
  const file = files?.[name];
  if (!file) return { ok: false, reason: `identity_aliases_file ${name} is declared but not loaded by the engine` };
  if (file.version !== 1 || typeof file.aliases !== "object" || file.aliases === null) {
    return { ok: false, reason: `identity_aliases_file ${name} has an unknown shape` };
  }
  if (file.registry_id !== entry.registry_id) {
    return { ok: false, reason: `identity_aliases_file ${name} belongs to ${file.registry_id}, not ${entry.registry_id}` };
  }
  if (entry.identity_fields?.length) {
    return { ok: false, reason: "identity_fields and identity_aliases_file are mutually exclusive (a compound identity already exists)" };
  }
  const cn = entry.column_map.case_number;
  if (typeof cn !== "string" || cn !== file.id_field) {
    return { ok: false, reason: `identity_aliases_file ${name} is for column ${file.id_field}, the entry identifies by ${JSON.stringify(cn)}` };
  }
  return { ok: true, file };
}

/**
 * The identity segment for one row: the alias when the file lists this row's OBJECTID AND the alias extends the
 * row's CURRENT identifier (so a publisher that re-keyed an OBJECTID can never attach a stale alias to a new id),
 * else `base` unchanged. `base` is whatever the existing ladder produced (identity_fields / case_number / rowId).
 */
export function applyIdentityAlias(
  row: Record<string, unknown>,
  base: string | null,
  verdict: AliasVerdict | null,
): string | null {
  if (!verdict || !verdict.ok || base == null) return base;
  const f = verdict.file;
  const raw = row[f.oid_field];
  if (raw == null) return base;
  const oid = String(raw).trim();
  if (oid === "") return base;
  if (!Object.prototype.hasOwnProperty.call(f.aliases, oid)) return base;
  const alias = f.aliases[oid];
  if (typeof alias !== "string" || !alias.startsWith(base + "#")) return base;
  return alias;
}
