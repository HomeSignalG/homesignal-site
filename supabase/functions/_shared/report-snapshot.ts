// Durable report snapshots — the engine-agnostic half (Development Activity plan, Order F + F2).
//
// A report engine assembles content. This module turns that content into a STORED snapshot with
// two different identifiers, and keeps a customer's street address OUT of the permanent record:
//   content_hash  SHA-256 (hex) of `body`, the exact bytes of the permanent content. Deterministic, so
//                 two snapshots of unchanged data share it. An integrity / dedup fingerprint.
//   report_id     a UUID minted by the DATABASE (public.report_snapshot_issue) when the snapshot
//                 is stored. One per issuance. It is not derived from anything, and this module
//                 cannot choose it.
//
// THE PRIVACY BOUNDARY (founder decision 2026-09-29): "Permanent intelligence survives.
// Customer-entered private context does not become permanent merely because it generated that
// intelligence." So an engine hands this module TWO separate things, and they never share an object:
//   intelligence    the permanent content: project records, evidence, Type and Stage, source
//                   references, the radius and versions used. Stored immutably, hashed, kept forever.
//   privateContext  what the customer typed and what derives from it: the street address, its
//                   normalized form, the exact property coordinates, property keys that resolve to one
//                   address, an optional label. Stored in a DELETABLE table (docs/report-private-context.sql)
//                   and referenced from the snapshot only by an opaque id.
// The database refuses a snapshot whose body or engine inputs contain a private value
// (docs/report-snapshot.sql, the containment trigger) — a backstop, because it can only match values it
// was given. It CANNOT see numbers derived from the private point (distance, east and north offsets),
// which with each record's own coordinates recover the point exactly, so this module refuses those
// keys itself, and the engine must not emit them (compute them at render time while the context lives).
//
// The SQL of record is docs/report-snapshot.sql. The database enforces content_hash = sha256(body).
//
// This file names no engine, no city and no source, imports no client library, and reads no
// environment. The caller hands in `rpc`, so the module cannot reach the database by any other path.

/** Fields that describe a report but are not part of its content, so they are never hashed or stored in the body. */
export const CONTENT_HASH_EXCLUDED = ['report_id', 'generated_at', 'content_hash', 'private_context_id'] as const;

/**
 * Keys that state something measured FROM the subject property. They are derived from the private point,
 * so they cannot be kept in the permanent body: three of them plus the records' own coordinates locate
 * the property exactly. Best-effort by NAME — the primary control is that the engine does not emit them.
 */
export const SUBJECT_RELATIVE_KEY =
  /^(distance|dist)(_|$)|^(east|north|south|west)_(mi|km|m|ft)$|^bearing|^(miles|km|meters|feet)_(from|away)/i;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The exact text that is stored and hashed: the content with the identity fields removed, serialised
 * with JSON.stringify in insertion order. For an engine that used to hash "everything but report_id
 * and generated_at" this is the same string, so the hash function is unchanged (test/report-snapshot.test.mjs
 * pins that against the NYC V1 engine, which is left untouched — and whose full report is NOT issuable, because
 * it carries the typed address).
 */
export function snapshotBodyOf(report: Record<string, unknown>): string {
  const copy = JSON.parse(JSON.stringify(report));
  for (const k of CONTENT_HASH_EXCLUDED) delete copy[k];
  return JSON.stringify(copy);
}

export async function contentHashOf(report: Record<string, unknown>): Promise<string> {
  return sha256Hex(snapshotBodyOf(report));
}

/** Paths of every key in a JSON value that names a subject-relative measurement (at most 5, for a readable error). */
export function subjectRelativeKeys(value: unknown, path = '$', out: string[] = []): string[] {
  if (out.length >= 5) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => subjectRelativeKeys(v, path + '[' + i + ']', out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SUBJECT_RELATIVE_KEY.test(k)) out.push(path + '.' + k);
      subjectRelativeKeys(v, path + '.' + k, out);
    }
  }
  return out;
}

export type SnapshotRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** What the customer entered, and what derives from it. Deletable; never part of the permanent body. */
export type PrivateContext = {
  address: string;
  normalized_address?: string;
  latitude?: number;
  longitude?: number;
  property_keys?: string[];
  label?: string;
};

/** The envelope carries the reference to the private context, never its values. */
export type SnapshotEnvelope = {
  report_id: string;
  content_hash: string;
  report_version: string;
  generated_at: string;
  private_context_id: string | null;
  report: Record<string, unknown>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Store one report and return its envelope. Fails closed: if the database did not confirm a stored
 * row with a well-formed id (and, when a private context was supplied, a well-formed reference to it),
 * nothing is returned, so a caller can never hand out a report_id that does not exist. Issuing the same
 * report twice stores two snapshots with two ids (retry idempotency belongs with the credit ledger).
 *
 * `intelligence` is permanent and hashed. `privateContext` is customer-entered and deletable; pass null
 * for a report with no subject address. They must be separate objects: the address is sent ONLY as
 * `p_private`, never inside `p_body`.
 */
export async function issueSnapshot(
  rpc: SnapshotRpc,
  intelligence: Record<string, unknown>,
  privateContext: PrivateContext | null,
  opts: { reportVersion: string; engineInputs: Record<string, unknown> },
): Promise<SnapshotEnvelope> {
  if (!isObject(intelligence)) throw new Error('issueSnapshot: the intelligence must be an object');
  if (typeof opts.reportVersion !== 'string' || !opts.reportVersion.trim()) {
    throw new Error('issueSnapshot: reportVersion is required');
  }
  if (!isObject(opts.engineInputs)) throw new Error('issueSnapshot: engineInputs must be an object');
  if (privateContext !== null) {
    if (!isObject(privateContext) || typeof privateContext.address !== 'string' || !privateContext.address.trim()) {
      throw new Error('issueSnapshot: a private context must be an object with a non-blank address (pass null when there is none)');
    }
  }

  const body = snapshotBodyOf(intelligence);
  if (privateContext !== null) {
    const leaked = subjectRelativeKeys(JSON.parse(body));
    if (leaked.length) {
      throw new Error('issueSnapshot: the permanent body carries measurements taken from the subject property (' + leaked.join(', ')
        + '); they are derived from the private point and would locate it. Compute them at render time from the private context.');
    }
  }
  const contentHash = await sha256Hex(body);
  const { data, error } = await rpc('report_snapshot_issue', {
    p_body: body,
    p_content_hash: contentHash,
    p_report_version: opts.reportVersion,
    p_engine_inputs: opts.engineInputs,
    p_private: privateContext,
  });
  if (error) throw new Error('issueSnapshot: the snapshot was not stored: ' + error.message);

  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!isObject(row)) throw new Error('issueSnapshot: the database did not return exactly one stored snapshot');
  const reportId = row.report_id;
  const generatedAt = row.generated_at;
  const contextId = row.private_context_id ?? null;
  if (typeof reportId !== 'string' || !UUID_V4.test(reportId)) {
    throw new Error('issueSnapshot: the database returned no well-formed report_id');
  }
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('issueSnapshot: the database returned no generated_at');
  }
  if (privateContext !== null ? (typeof contextId !== 'string' || !UUID_V4.test(contextId)) : contextId !== null) {
    throw new Error('issueSnapshot: the database did not confirm the private context it was given');
  }
  return {
    report_id: reportId,
    content_hash: contentHash,
    report_version: opts.reportVersion,
    generated_at: generatedAt,
    private_context_id: contextId as string | null,
    // parsed from the stored text, so what is returned is what is stored
    report: JSON.parse(body),
  };
}

/**
 * Anyone holding an envelope can check that its content matches its content_hash: hash the report
 * as delivered. This proves the content is internally consistent, not who issued it (it is an
 * unkeyed hash, not a signature) and not that it is the stored copy (only report_id, looked up
 * server-side, says that).
 */
export async function envelopeMatchesItsHash(envelope: SnapshotEnvelope): Promise<boolean> {
  if (!envelope || !isObject(envelope.report) || typeof envelope.content_hash !== 'string') return false;
  return (await sha256Hex(JSON.stringify(envelope.report))) === envelope.content_hash;
}
